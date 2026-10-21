import { Router } from 'express';
import { plan, ALGORITHMS } from '@energy-planner/core';
import { requireUser } from '../auth.js';
import { listHouseholds, getHousehold, createHousehold, updateHousehold, deleteHousehold } from '../db/households.js';
import { listSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedule } from '../db/schedules.js';

// Ідентифікатор з адреси: ціле додатне число, інакше null (тоді відповідаємо 404).
const idParam = (value) => (/^\d{1,15}$/.test(value) ? Number(value) : null);

const notFound = (res, what = 'Домогосподарство') => res.status(404).json({ error: `${what} не знайдено` });

const badRequest = (res, err) => res.status(400).json({ error: err.message });

// Виконує запис даних користувача. Помилки перевірки (наші або PostgreSQL класів 22 і 23,
// тобто некоректне значення чи порушене обмеження) віддає як 400; повертає undefined, якщо відповідь уже надіслано.
async function withInput(res, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!err.code) return void badRequest(res, err);
    if (/^2[23]/.test(err.code)) return void res.status(400).json({ error: `Некоректні дані: ${err.message}` });
    throw err;
  }
}

export function cabinetRouter(db) {
  const router = Router();
  router.use(['/households', '/schedules', '/plans'], requireUser);

  // --- Домогосподарства ---

  router.get('/households', async (req, res) => {
    res.json(await listHouseholds(db, req.user.id));
  });

  router.post('/households', async (req, res) => {
    const id = await withInput(res, () => createHousehold(db, req.user.id, req.body));
    if (id === undefined) return;
    res.status(201).json(await getHousehold(db, req.user.id, id));
  });

  router.get('/households/:id', async (req, res) => {
    const household = await getHousehold(db, req.user.id, idParam(req.params.id));
    if (!household) return notFound(res);
    res.json(household);
  });

  router.put('/households/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const updated = await withInput(res, () => updateHousehold(db, req.user.id, id, req.body));
    if (updated === undefined) return;
    if (!updated) return notFound(res);
    res.json(await getHousehold(db, req.user.id, id));
  });

  router.delete('/households/:id', async (req, res) => {
    if (!(await deleteHousehold(db, req.user.id, idParam(req.params.id)))) return notFound(res);
    res.status(204).end();
  });

  // --- Графіки відключень ---

  router.get('/households/:id/schedules', async (req, res) => {
    const id = idParam(req.params.id);
    if (!(await getHousehold(db, req.user.id, id))) return notFound(res);
    res.json(await listSchedules(db, req.user.id, id));
  });

  router.post('/households/:id/schedules', async (req, res) => {
    const householdId = idParam(req.params.id);
    if (!(await getHousehold(db, req.user.id, householdId))) return notFound(res);
    const id = await withInput(res, () => createSchedule(db, householdId, req.body));
    if (id === undefined) return;
    res.status(201).json(await getSchedule(db, req.user.id, id));
  });

  router.get('/schedules/:id', async (req, res) => {
    const schedule = await getSchedule(db, req.user.id, idParam(req.params.id));
    if (!schedule) return notFound(res, 'Графік');
    res.json(schedule);
  });

  router.put('/schedules/:id', async (req, res) => {
    const id = idParam(req.params.id);
    if (!(await getSchedule(db, req.user.id, id))) return notFound(res, 'Графік');
    if ((await withInput(res, () => updateSchedule(db, id, req.body).then(() => true))) === undefined) return;
    res.json(await getSchedule(db, req.user.id, id));
  });

  router.delete('/schedules/:id', async (req, res) => {
    const id = idParam(req.params.id);
    if (!(await getSchedule(db, req.user.id, id))) return notFound(res, 'Графік');
    await deleteSchedule(db, id);
    res.status(204).end();
  });

  // --- Плани ---

  // Складає план для збереженого домогосподарства і графіка та зберігає його в історію.
  router.post('/households/:id/plans', async (req, res) => {
    const householdId = idParam(req.params.id);
    const household = await getHousehold(db, req.user.id, householdId);
    if (!household) return notFound(res);

    const { scheduleId = null, algorithm = 'robust-ga', uncertainty, weights } = req.body ?? {};
    if (!ALGORITHMS[algorithm]) return res.status(400).json({ error: `Невідомий метод: ${algorithm}` });

    // Графік беремо зі збережених або, якщо scheduleId не передано, з тіла запиту.
    let outages = req.body?.outages ?? [];
    let schedule = null;
    if (scheduleId != null) {
      schedule = await getSchedule(db, req.user.id, idParam(String(scheduleId)));
      if (!schedule || schedule.householdId !== householdId) return notFound(res, 'Графік');
      outages = schedule.outages;
    }

    const input = { household: { ...household, outages }, algorithm, uncertainty, weights };
    let result;
    try {
      result = plan(input.household, { algorithm, uncertainty, weights });
    } catch (err) {
      return badRequest(res, err);
    }
    const { rows } = await db.query(
      `INSERT INTO plans (household_id, schedule_id, algorithm, input, result)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [householdId, schedule?.id ?? null, algorithm, input, result],
    );
    res.status(201).json({ id: Number(rows[0].id), createdAt: rows[0].created_at, scheduleId: schedule?.id ?? null, ...result });
  });

  // Коротка історія: без повної імітації, тільки основні показники.
  router.get('/households/:id/plans', async (req, res) => {
    const id = idParam(req.params.id);
    if (!(await getHousehold(db, req.user.id, id))) return notFound(res);
    const { rows } = await db.query(
      `SELECT id, schedule_id, algorithm, created_at, result->'robustness' AS robustness, result->'schedule' AS schedule
         FROM plans WHERE household_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
      [id],
    );
    res.json(
      rows.map((r) => ({
        id: Number(r.id),
        scheduleId: r.schedule_id == null ? null : Number(r.schedule_id),
        algorithm: r.algorithm,
        algorithmName: ALGORITHMS[r.algorithm],
        createdAt: r.created_at,
        schedule: r.schedule,
        robustness: r.robustness,
      })),
    );
  });

  router.get('/plans/:id', async (req, res) => {
    const { rows } = await db.query(
      `SELECT p.* FROM plans p JOIN households h ON h.id = p.household_id
        WHERE p.id = $1 AND h.user_id = $2`,
      [idParam(req.params.id), req.user.id],
    );
    if (!rows[0]) return notFound(res, 'План');
    const p = rows[0];
    res.json({
      id: Number(p.id),
      householdId: Number(p.household_id),
      scheduleId: p.schedule_id == null ? null : Number(p.schedule_id),
      createdAt: p.created_at,
      input: p.input,
      ...p.result,
    });
  });

  router.delete('/plans/:id', async (req, res) => {
    const { rowCount } = await db.query(
      'DELETE FROM plans p USING households h WHERE h.id = p.household_id AND p.id = $1 AND h.user_id = $2',
      [idParam(req.params.id), req.user.id],
    );
    if (!rowCount) return notFound(res, 'План');
    res.status(204).end();
  });

  return router;
}

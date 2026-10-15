import { timeToSlot, SLOTS_PER_DAY } from '@energy-planner/core';
import { transaction } from './pool.js';

const hhmm = (t) => t.slice(0, 5);

function toSchedule(row, intervals) {
  return {
    id: Number(row.id),
    householdId: Number(row.household_id),
    name: row.name,
    day: row.day,
    updatedAt: row.updated_at,
    outages: intervals.map((r) => ({ from: hhmm(r.starts_at), to: hhmm(r.ends_at) })),
  };
}

function validateSchedule(data) {
  if (!data || typeof data !== 'object') throw new Error('Не передано графік відключень');
  const name = String(data.name ?? '').trim();
  if (!name) throw new Error('Вкажіть назву графіка');
  if (data.day != null && !/^\d{4}-\d{2}-\d{2}$/.test(data.day)) throw new Error('Дата графіка має бути у форматі РРРР-ММ-ДД');
  const outages = data.outages ?? [];
  if (!Array.isArray(outages)) throw new Error('Поле outages має бути списком');
  outages.forEach((o, i) => {
    const from = timeToSlot(o.from);
    if (from === timeToSlot(o.to) % SLOTS_PER_DAY) throw new Error(`Відключення №${i + 1} має нульову тривалість`);
  });
  return { name, day: data.day ?? null, outages };
}

// Графіки належать домогосподарству; доступ перевіряється через власника домогосподарства.
export async function listSchedules(db, userId, householdId) {
  const { rows } = await db.query(
    `SELECT s.* FROM outage_schedules s JOIN households h ON h.id = s.household_id
      WHERE s.household_id = $1 AND h.user_id = $2 ORDER BY s.day DESC NULLS LAST, s.id DESC`,
    [householdId, userId],
  );
  if (!rows.length) return rows;
  const { rows: intervals } = await db.query(
    'SELECT * FROM outage_intervals WHERE schedule_id = ANY($1) ORDER BY position',
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => toSchedule(r, intervals.filter((i) => i.schedule_id === r.id)));
}

export async function getSchedule(db, userId, id) {
  const { rows } = await db.query(
    `SELECT s.* FROM outage_schedules s JOIN households h ON h.id = s.household_id
      WHERE s.id = $1 AND h.user_id = $2`,
    [id, userId],
  );
  if (!rows[0]) return null;
  const { rows: intervals } = await db.query('SELECT * FROM outage_intervals WHERE schedule_id = $1 ORDER BY position', [id]);
  return toSchedule(rows[0], intervals);
}

export async function createSchedule(db, householdId, data) {
  const { name, day, outages } = validateSchedule(data);
  return transaction(db, async (client) => {
    const { rows } = await client.query(
      'INSERT INTO outage_schedules (household_id, name, day) VALUES ($1, $2, $3) RETURNING id',
      [householdId, name, day],
    );
    await writeIntervals(client, rows[0].id, outages);
    return Number(rows[0].id);
  });
}

export async function updateSchedule(db, id, data) {
  const { name, day, outages } = validateSchedule(data);
  await transaction(db, async (client) => {
    await client.query('UPDATE outage_schedules SET name = $2, day = $3, updated_at = now() WHERE id = $1', [id, name, day]);
    await client.query('DELETE FROM outage_intervals WHERE schedule_id = $1', [id]);
    await writeIntervals(client, id, outages);
  });
}

export async function deleteSchedule(db, id) {
  await db.query('DELETE FROM outage_schedules WHERE id = $1', [id]);
}

async function writeIntervals(client, scheduleId, outages) {
  for (const [i, o] of outages.entries()) {
    await client.query(
      'INSERT INTO outage_intervals (schedule_id, position, starts_at, ends_at) VALUES ($1, $2, $3, $4)',
      [scheduleId, i, o.from, o.to],
    );
  }
}

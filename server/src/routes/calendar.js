import { Router } from 'express';
import { plan, planToIcs } from '@energy-planner/core';

const CACHE_MS = 15 * 60_000;

// Дата за київським часом зі зсувом у днях: 'YYYY-MM-DD'.
function kyivDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d);
}

// Підписка на календар, що сама оновлюється: календар (Google, Apple, Outlook) періодично завантажує
// посилання, а сервер щоразу бере свіжий графік YASNO і перераховує план на сьогодні й завтра.
export function calendarRouter({ store, yasno }) {
  const router = Router();
  const cache = new Map();

  router.post('/', async (req, res) => {
    const { household, choice, token } = req.body ?? {};
    if (!household || !Array.isArray(household.appliances)) return res.status(400).json({ error: 'Потрібні дані дому' });
    const id = await store.put(token, { household, choice: choice?.source && choice?.group ? { source: choice.source, group: choice.group } : null });
    cache.delete(id);
    res.json({ token: id });
  });

  router.get('/:token.ics', async (req, res) => {
    const entry = await store.get(req.params.token);
    if (!entry) return res.status(404).type('text/plain').send('Підписку не знайдено');
    const hit = cache.get(req.params.token);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.type('text/calendar; charset=utf-8').send(hit.ics);

    let { outages = [], outagesTomorrow = null } = entry.household;
    if (entry.choice && yasno) {
      try {
        const [region, dso] = entry.choice.source.split(':').map(Number);
        const { groups } = await yasno.schedule(region, dso);
        const group = groups.find((g) => g.group === entry.choice.group);
        const applies = (d) => d && (d.status === 'ScheduleApplies' || d.status === 'NoOutages');
        if (applies(group?.today)) outages = group.today.outages;
        outagesTomorrow = applies(group?.tomorrow) ? group.tomorrow.outages : null;
      } catch {
        // Без YASNO лишається останній збережений графік.
      }
    }
    const household = { ...entry.household, outages, nextDay: { outages: outagesTomorrow ?? outages } };
    try {
      const result = plan(household, { algorithm: 'robust-ga', testScenarios: 50 });
      const ics = planToIcs(result, household, kyivDate(0));
      cache.set(req.params.token, { at: Date.now(), ics });
      res.type('text/calendar; charset=utf-8').send(ics);
    } catch (err) {
      res.status(400).type('text/plain').send(err.message);
    }
  });

  return router;
}

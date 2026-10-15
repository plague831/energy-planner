import { Router } from 'express';
import { createYasnoClient } from '../sources/yasno.js';

// Зовнішні джерела даних, які сайт не може читати напряму (немає CORS).
export function sourcesRouter({ yasno = createYasnoClient() } = {}) {
  const router = Router();

  router.get('/yasno/regions', async (req, res) => {
    try {
      res.json(await yasno.regions());
    } catch (err) {
      res.status(502).json({ error: `Не вдалося отримати список регіонів YASNO: ${err.message}` });
    }
  });

  router.get('/yasno/schedule', async (req, res) => {
    const region = Number(req.query.region);
    const dso = Number(req.query.dso);
    if (!Number.isInteger(region) || !Number.isInteger(dso) || region <= 0 || dso <= 0) {
      return res.status(400).json({ error: 'Потрібні числові параметри region і dso' });
    }
    try {
      res.json(await yasno.schedule(region, dso));
    } catch (err) {
      res.status(502).json({ error: `Не вдалося отримати графік YASNO: ${err.message}` });
    }
  });

  return router;
}

import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, ALGORITHMS, DEFAULT_WEIGHTS, DEFAULT_UNCERTAINTY } from '@energy-planner/core';
import { demoHousehold } from '@energy-planner/core/examples';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/algorithms', (req, res) => {
    res.json(Object.entries(ALGORITHMS).map(([id, name]) => ({ id, name })));
  });

  app.get('/api/defaults', (req, res) => {
    res.json({ household: demoHousehold, weights: DEFAULT_WEIGHTS, uncertainty: DEFAULT_UNCERTAINTY });
  });

  app.post('/api/plan', (req, res) => {
    const { household, algorithm = 'robust-ga', uncertainty, weights } = req.body ?? {};
    if (!ALGORITHMS[algorithm]) return res.status(400).json({ error: `Невідомий метод: ${algorithm}` });
    try {
      const result = plan(household, { algorithm, uncertainty, weights });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // У продакшені сервер також віддає зібраний клієнт.
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  return app;
}

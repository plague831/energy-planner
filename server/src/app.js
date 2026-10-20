import express from 'express';
import { sourcesRouter } from './routes/sources.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, ALGORITHMS, DEFAULT_WEIGHTS, DEFAULT_UNCERTAINTY } from '@energy-planner/core';
import { demoHousehold } from '@energy-planner/core/examples';
import { loadUser } from './auth.js';
import { authRouter } from './routes/auth.js';
import { cabinetRouter } from './routes/households.js';

// db — пул PostgreSQL. Без нього працює тільки планування без входу (/api/plan),
// а маршрути кабінету відповідають 503.
export function createApp({ db = null } = {}) {
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

  app.use('/api/sources', sourcesRouter());

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

  const accountPaths = ['/api/auth', '/api/households', '/api/schedules', '/api/plans'];
  if (db) {
    app.use(accountPaths, loadUser(db));
    app.use('/api/auth', authRouter(db));
    app.use('/api', cabinetRouter(db));
  } else {
    app.use(accountPaths, (req, res) => {
      res.status(503).json({ error: 'База даних не налаштована (не задано DATABASE_URL)' });
    });
  }

  app.use('/api', (req, res) => res.status(404).json({ error: 'Такого методу API немає' }));

  // У продакшені сервер також віддає зібраний клієнт.
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Тіло запиту не є коректним JSON' });
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status < 500 ? err.message : 'Внутрішня помилка сервера' });
  });

  return app;
}

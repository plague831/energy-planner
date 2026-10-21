import './env.js';
import { createApp } from './app.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';

const port = Number(process.env.PORT ?? 3001);
const db = createPool();

if (db) {
  await migrate(db, { log: console.log });
} else {
  console.warn('DATABASE_URL не задано: працює тільки планування без облікових записів');
}

createApp({ db }).listen(port, () => {
  console.log(`Сервер запущено: http://localhost:${port}`);
});

import '../env.js';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, transaction } from './pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

// Застосовує SQL-файли з server/migrations, які ще не виконувались, у порядку їхніх імен.
export async function migrate(pool, { log = () => {} } = {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await transaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`Застосовано міграцію ${file}`);
  }
}

// Запуск з командного рядка: npm run migrate --workspace server
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  if (!pool) {
    console.error('Не задано DATABASE_URL');
    process.exit(1);
  }
  migrate(pool, { log: console.log })
    .then(() => console.log('База даних в актуальному стані'))
    .finally(() => pool.end());
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Сховище підписок на календар: токен → дані дому і черга YASNO.
// Простий JSON-файл: підписка не потребує облікового запису, а токен у посиланні знає лише власник.
export function createCalendarStore(file) {
  let cache = null;
  const load = async () => {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      cache = {};
    }
    return cache;
  };
  const persist = async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(cache));
  };

  return {
    async get(token) {
      return (await load())[token] ?? null;
    },
    // Створює нову підписку або оновлює наявну (якщо передано існуючий токен).
    async put(token, entry) {
      const all = await load();
      const id = token && all[token] ? token : randomBytes(16).toString('hex');
      all[id] = { ...entry, updatedAt: new Date().toISOString() };
      await persist();
      return id;
    },
  };
}

// Те саме сховище в PostgreSQL (таблиця calendar_subscriptions): переживає перезапуски сервера.
export function createDbCalendarStore(db) {
  return {
    async get(token) {
      const { rows } = await db.query('SELECT household, choice, updated_at FROM calendar_subscriptions WHERE token = $1', [token]);
      return rows[0] ? { household: rows[0].household, choice: rows[0].choice, updatedAt: rows[0].updated_at.toISOString() } : null;
    },
    async put(token, entry) {
      if (token) {
        const { rowCount } = await db.query(
          'UPDATE calendar_subscriptions SET household = $2, choice = $3, updated_at = now() WHERE token = $1',
          [token, entry.household, entry.choice],
        );
        if (rowCount) return token;
      }
      const id = randomBytes(16).toString('hex');
      await db.query('INSERT INTO calendar_subscriptions (token, household, choice) VALUES ($1, $2, $3)', [id, entry.household, entry.choice]);
      return id;
    },
  };
}

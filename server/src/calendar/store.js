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

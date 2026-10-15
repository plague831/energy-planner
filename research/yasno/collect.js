// Збирає графіки планових відключень YASNO для дослідження невизначеності графіків.
// Кожен запуск завантажує графіки всіх регіонів і зберігає знімок лише тоді, коли графік змінився
// порівняно з останнім збереженим. Так видно, коли і як саме оператор змінює опублікований графік.
//
// Запуск: node research/yasno/collect.js [тека-для-знімків]
// Структура: <тека>/<регіон>-<оператор>/<дата>/<час UTC>.json, у файлі { fetchedAt, region, dso, data }.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://app.yasno.ua/api/blackout-service/public/shutdowns';
const outDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'snapshots');

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
}

// Останній збережений знімок для пари регіон-оператор (файли відсортовані за назвою = за часом).
async function latestSnapshot(dir) {
  const days = (await readdir(dir).catch(() => [])).sort();
  for (const day of days.reverse()) {
    const files = (await readdir(join(dir, day))).filter((f) => f.endsWith('.json')).sort();
    if (files.length) return JSON.parse(await readFile(join(dir, day, files.at(-1)), 'utf8'));
  }
  return null;
}

const now = new Date();
const stamp = now.toISOString();
const day = stamp.slice(0, 10);
const time = stamp.slice(11, 16).replace(':', '');

const regions = await getJson(`${BASE_URL}/addresses/v2/regions`);
let saved = 0;
let failed = 0;
for (const region of regions) {
  for (const dso of region.dsos ?? []) {
    const key = `${region.id}-${dso.id}`;
    try {
      const data = await getJson(`${BASE_URL}/regions/${region.id}/dsos/${dso.id}/planned-outages`);
      const dir = join(outDir, key);
      const last = await latestSnapshot(dir);
      if (last && JSON.stringify(last.data) === JSON.stringify(data)) {
        console.log(`${key} (${region.value}, ${dso.name}): без змін`);
        continue;
      }
      await mkdir(join(dir, day), { recursive: true });
      const snapshot = { fetchedAt: stamp, region: { id: region.id, name: region.value }, dso: { id: dso.id, name: dso.name }, data };
      await writeFile(join(dir, day, `${time}.json`), JSON.stringify(snapshot, null, 1) + '\n');
      saved++;
      console.log(`${key} (${region.value}, ${dso.name}): збережено ${day}/${time}.json`);
    } catch (err) {
      failed++;
      console.error(`${key}: помилка ${err.message}`);
    }
  }
}
console.log(`Збережено знімків: ${saved}, помилок: ${failed}`);
if (failed && !saved) process.exitCode = 1;

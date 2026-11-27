// Як часто «YASNO» змінює графік відключень після публікації (табл. 3.12 записки).
//
// Дані: знімки з гілки yasno-data (збирає research/yasno/collect.js кожні 30 хв).
//   git archive origin/yasno-data snapshots | tar -x -C /tmp/yasno
//   node docs/thesis/analysis/yasno-changes.mjs /tmp/yasno/snapshots 2026-10-15 2026-11-22
//
// Одиниця підрахунку — добовий графік однієї черги. Опублікованим вважається перший знімок,
// у якому для цієї доби діє графік (ScheduleApplies) з хоча б одним відключенням. Графік
// «змінено», якщо пізніший знімок для тієї самої доби відрізняється статусом або інтервалами.
// Зміни розкладено на чотири види:
//   аварійні — доба перейшла в стан EmergencyShutdowns (графік замінено аварійними відключеннями);
//   скасовано — відключень за графіком не лишилося;
//   зсув меж — ті самі відключення, кожна межа зсунулась не більше ніж на 90 хв;
//   інші інтервали — решта (додано чи прибрано відключення, великі зсуви).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, from = '0000-00-00', to = '9999-99-99'] = process.argv.slice(2);
if (!root) {
  console.error('Використання: node yasno-changes.mjs <тека snapshots> [від YYYY-MM-DD] [до YYYY-MM-DD]');
  process.exit(1);
}
const SHIFT_MAX = 90;
const rows = [];
for (const reg of readdirSync(root).sort()) {
  const files = readdirSync(join(root, reg)).flatMap((d) => readdirSync(join(root, reg, d)).map((f) => join(root, reg, d, f)));
  files.sort();
  const versions = new Map();
  let name = reg;
  for (const f of files) {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    name = `${s.region.name}, ${s.dso.name}`;
    for (const [queue, v] of Object.entries(s.data)) {
      for (const day of [v.today, v.tomorrow]) {
        if (!day?.date) continue;
        const key = `${queue}|${day.date.slice(0, 10)}`;
        const outages = (day.slots ?? []).filter((x) => x.type === 'Definite').map((x) => [x.start, x.end]);
        const sig = `${day.status}:${JSON.stringify(outages)}`;
        const list = versions.get(key) ?? [];
        versions.set(key, list);
        if (list.at(-1)?.sig !== sig) list.push({ status: day.status, outages, sig });
      }
    }
  }
  const r = { name, published: 0, changed: 0, emergency: 0, cancelled: 0, shift: 0, other: 0, moved: 0, bounds: 0, absShift: 0, longer: 0, shorter: 0, compared: 0 };
  const length = (xs) => xs.reduce((sum, [a, b]) => sum + b - a, 0);
  for (const [key, list] of versions) {
    const date = key.split('|')[1];
    if (date < from || date > to) continue;
    const first = list.findIndex((v) => v.status === 'ScheduleApplies' && v.outages.length);
    if (first < 0) continue;
    r.published++;
    const base = list[first];
    const later = list.slice(first + 1).filter((v) => v.status !== 'WaitingForSchedule');
    if (!later.some((v) => v.sig !== base.sig)) continue;
    r.changed++;
    if (later.some((v) => v.status === 'EmergencyShutdowns')) { r.emergency++; continue; }
    const last = later.at(-1);
    if (!last.outages.length) { r.cancelled++; continue; }
    r.compared++;
    const d = length(last.outages) - length(base.outages);
    if (d > 0) r.longer++;
    if (d < 0) r.shorter++;
    const same = last.outages.length === base.outages.length
      && last.outages.every(([a, b], j) => Math.abs(a - base.outages[j][0]) <= SHIFT_MAX && Math.abs(b - base.outages[j][1]) <= SHIFT_MAX);
    if (!same) { r.other++; continue; }
    r.shift++;
    last.outages.forEach(([a, b], j) => {
      for (const x of [a - base.outages[j][0], b - base.outages[j][1]]) {
        r.bounds++;
        if (x !== 0) { r.moved++; r.absShift += Math.abs(x); }
      }
    });
  }
  rows.push(r);
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)} %` : '–');
console.log(`Період: ${from} – ${to}\n`);
console.log('| Оператор | Опубліковано графіків | Змінено після публікації | Аварійні | Скасовано | Зсув меж | Інші інтервали |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.published} | ${r.changed} (${pct(r.changed, r.published)}) | ${r.emergency} | ${r.cancelled} | ${r.shift} | ${r.other} |`);
}
console.log('');
for (const r of rows) {
  console.log(`${r.name}: у змінах «зсув меж» зсунулось ${r.moved} з ${r.bounds} меж, середній зсув ${(r.absShift / Math.max(1, r.moved)).toFixed(0)} хв;`
    + ` серед неаварійних змін сумарна тривалість відключень зросла в ${r.longer}, зменшилась у ${r.shorter} з ${r.compared}.`);
}

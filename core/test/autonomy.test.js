import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batterySource, generatorSource, solarSource, estimateAutonomy } from '../src/index.js';

const fridge = { name: 'Холодильник', powerW: 60, priority: 5 };
const router = { name: 'Роутер', powerW: 20, priority: 4 };
const boiler = { name: 'Бойлер', powerW: 2000, priority: 3 };
const tv = { name: 'Телевізор', powerW: 100, priority: 2 };

test('станція: запас між поточним і мінімальним зарядом з урахуванням ККД', () => {
  const s = batterySource({ capacityWh: 1000, socPct: 60, minSocPct: 10, inverterMaxW: 1800 });
  // 1000 · 0.5 · 0.9 = 450 Вт·год на 90 Вт ≈ 5 год
  const [r] = estimateAutonomy([s], [fridge, router, { name: 'x', powerW: 10 }]).sources;
  assert.equal(r.loadW, 90);
  assert.ok(Math.abs(r.hours - 5) < 1e-9);
  assert.equal(r.overloaded, false);
});

test('генератор: при 50% навантаження працює заявлений час, при меншому довше', () => {
  const g = generatorSource({ ratedW: 2000, tankHoursAtHalf: 6 });
  assert.ok(Math.abs(g.hoursAt(1000) - 6) < 1e-9);
  assert.ok(g.hoursAt(200) > 6);
  assert.ok(g.hoursAt(2000) < 6);
  assert.ok(Math.abs(generatorSource({ ratedW: 2000, tankHoursAtHalf: 6, fuelPct: 50 }).hoursAt(1000) - 3) < 1e-9);
});

test('при перевантаженні вимикаються найменш важливі споживачі', () => {
  const s = batterySource({ capacityWh: 1000, socPct: 100, minSocPct: 10, inverterMaxW: 600 });
  const [r] = estimateAutonomy([s], [fridge, router, boiler, tv]).sources;
  assert.equal(r.overloaded, true);
  // Телевізор вимикається першим як найменш важливий, але повертається, бо після вимкнення бойлера вміщується.
  assert.deepEqual(
    r.drop.map((c) => c.name),
    ['Бойлер'],
  );
  assert.equal(r.fitted.loadW, 180);
  assert.equal(r.fitted.overloaded, false);
});

test('сонячні панелі: денна енергія з урахуванням втрат', () => {
  const s = solarSource({ peakW: 800, sunHours: 3 });
  assert.equal(s.energyWh, 1800);
  assert.equal(s.hoursAt(100), 18);
});

test('дрібний споживач повертається, якщо після вимкнення потужного він вміщується', () => {
  const s = batterySource({ capacityWh: 1000, socPct: 100, minSocPct: 10, inverterMaxW: 1800 });
  const lights = { name: 'Освітлення', powerW: 40, priority: 3 };
  const heater = { name: 'Бойлер', powerW: 2000, priority: 4 };
  const [r] = estimateAutonomy([s], [fridge, lights, heater]).sources;
  assert.deepEqual(r.drop.map((c) => c.name), ['Бойлер']);
  assert.deepEqual(r.keep.map((c) => c.name), ['Холодильник', 'Освітлення']);
});

test('імітація резерву: станція, потім генератор, потім нестача', async () => {
  const { simulateBackup } = await import('../src/autonomy.js');
  const r = simulateBackup({
    batteries: [{ capacityWh: 1000, socPct: 100, minSocPct: 10, inverterMaxW: 1000 }],
    generators: [{ ratedW: 1000, tankHoursAtHalf: 4, fuelPct: 50 }],
    loadW: 450,
    startMinute: 20 * 60,
  });
  // Станція: 1000 · 0.9 · 0.9 = 810 Вт·год на 450 Вт ≈ 1.8 год; генератор при 45% ≈ 2 · 0.625 / 0.5875 ≈ 2.13 год.
  assert.equal(r.phases[0].kind, 'battery');
  assert.equal(r.phases[1].kind, 'generator');
  assert.equal(r.phases.at(-1).kind, 'none');
  assert.ok(Math.abs(r.fullHours - 3.75) <= 0.25 + 1e-9);
  const servedWh = r.steps.reduce((s, x) => s + (x.batteryW + x.generatorW) * 0.25, 0);
  assert.ok(Math.abs(servedWh - 450 * (1.8 + 2.13)) < 450 * 0.15);
});

test('імітація резерву: удень сонце знімає навантаження зі станції', async () => {
  const { simulateBackup } = await import('../src/autonomy.js');
  const base = { batteries: [{ capacityWh: 1000, socPct: 100, minSocPct: 10, inverterMaxW: 1000 }], loadW: 300, startMinute: 9 * 60 };
  const night = simulateBackup(base);
  const sunny = simulateBackup({ ...base, solar: [{ peakW: 800, sunHours: 4 }] });
  assert.ok((sunny.fullHours ?? 48) > night.fullHours);
  assert.ok(sunny.steps.some((s) => s.solarW > 0));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, simulate, timeToSlot, SKIP } from '../src/index.js';

const base = {
  grid: { maxPowerW: 3000 },
  battery: { capacityWh: 1000, initialSocPct: 100, minSocPct: 10, targetEndSocPct: 0, maxChargeW: 500, inverterMaxW: 1000 },
  outages: [{ from: '10:00', to: '12:00' }],
  baseLoads: [{ id: 'fridge', name: 'Холодильник', powerW: 100, priority: 5 }],
  appliances: [{ id: 'boiler', name: 'Бойлер', powerW: 2000, durationMin: 60, earliest: '06:00', latest: '20:00', priority: 4, allowOnBattery: false }],
};

test('графік відключень перетворюється на маску', () => {
  const model = buildModel(base);
  assert.equal(model.plannedGrid[timeToSlot('09:45')], 1);
  assert.equal(model.plannedGrid[timeToSlot('10:00')], 0);
  assert.equal(model.plannedGrid[timeToSlot('11:45')], 0);
  assert.equal(model.plannedGrid[timeToSlot('12:00')], 1);
});

test('прилад, який не можна живити від станції, переривається під час відключення', () => {
  const model = buildModel(base);
  const m = simulate(model, [timeToSlot('09:30')], model.plannedGrid);
  assert.deepEqual(m.failedIds, ['boiler']);
  assert.equal(m.shedBasePoints, 0);
});

test('прилад поза відключенням відпрацьовує повністю', () => {
  const model = buildModel(base);
  const m = simulate(model, [timeToSlot('13:00')], model.plannedGrid);
  assert.deepEqual(m.completedIds, ['boiler']);
  assert.equal(m.cost, 0);
});

test('пропущений прилад штрафується з урахуванням пріоритету', () => {
  const model = buildModel(base);
  const m = simulate(model, [SKIP], model.plannedGrid, { baseShedPerHour: 1, applianceFailure: 10, preferencePerHour: 0, endShortfall: 0 });
  assert.equal(m.cost, 40);
});

test('коли станція розряджена, постійне навантаження відключається', () => {
  const model = buildModel({
    ...base,
    battery: { ...base.battery, capacityWh: 100, initialSocPct: 100, minSocPct: 10 },
    appliances: [],
  });
  const m = simulate(model, [], model.plannedGrid);
  // 90 Вт·год корисної енергії (з ККД 0.92) вистачить менше ніж на годину при 100 Вт.
  assert.ok(m.shedBasePoints > 0);
  assert.ok(m.minSocPct >= 10 - 1e-9);
});

test('станція заряджається, коли є світло', () => {
  const model = buildModel({ ...base, battery: { ...base.battery, initialSocPct: 20 }, outages: [], appliances: [] });
  const m = simulate(model, [], model.plannedGrid);
  assert.ok(m.endSocPct > 99);
});

test('перевищення ліміту мережі відключає менш важливий прилад', () => {
  const model = buildModel({
    ...base,
    outages: [],
    appliances: [
      { id: 'boiler', powerW: 2000, durationMin: 60, priority: 4 },
      { id: 'oven', powerW: 2000, durationMin: 60, priority: 2 },
    ],
  });
  const m = simulate(model, [timeToSlot('13:00'), timeToSlot('13:00')], model.plannedGrid);
  assert.deepEqual(m.failedIds, ['oven']);
});

test('прилад, що не вміщується у вікно, відхиляється при побудові моделі', () => {
  assert.throws(() =>
    buildModel({ ...base, appliances: [{ powerW: 100, durationMin: 120, earliest: '10:00', latest: '11:00' }] }),
  );
});

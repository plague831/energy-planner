import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, simulate, plan, timeToSlot, SKIP, SOLAR_DERATE } from '../src/index.js';

const boiler = { id: 'boiler', name: 'Бойлер', powerW: 2000, durationMin: 60, earliest: '06:00', latest: '20:00', priority: 4, allowOnBattery: false };
const fridge = { id: 'fridge', name: 'Холодильник', powerW: 100, priority: 5 };
const generator = { id: 'gen', kind: 'generator', name: 'Генератор', ratedW: 3000, tankHoursAtHalf: 8, fuelPct: 100 };

const noBattery = {
  grid: { maxPowerW: 5000 },
  battery: null,
  outages: [{ from: '10:00', to: '12:00' }],
  baseLoads: [fridge],
  appliances: [boiler],
};

test('без станції генератор живить потужний прилад під час відключення', () => {
  const model = buildModel({ ...noBattery, sources: [generator] });
  const withGen = simulate(model, [timeToSlot('10:00'), 0], model.plannedGrid);
  assert.deepEqual(withGen.completedIds, ['boiler']);
  assert.equal(withGen.shedBasePoints, 0);
  assert.equal(withGen.generatorHours, 2);
  assert.ok(withGen.fuelUsedTanks > 0 && withGen.fuelUsedTanks < 1);

  const off = simulate(model, [timeToSlot('10:00'), SKIP], model.plannedGrid);
  assert.deepEqual(off.failedIds, ['boiler']);
  assert.ok(off.cost > withGen.cost);
});

test('генератор вмикається лише коли заряд станції падає до порогу', () => {
  const household = {
    ...noBattery,
    battery: { capacityWh: 1000, initialSocPct: 100, minSocPct: 10, targetEndSocPct: 0, maxChargeW: 500, inverterMaxW: 1500 },
    appliances: [],
    sources: [generator],
  };
  const model = buildModel(household);
  // Поріг 30% (ген 6): холодильник за 2 години розряджає станцію лише на ~22%, генератор не потрібен.
  assert.equal(simulate(model, [6], model.plannedGrid).generatorHours, 0);
  // Поріг 100% (ген 20): генератор вмикається одразу і заряджає станцію.
  const eager = simulate(model, [20], model.plannedGrid);
  assert.ok(eager.generatorHours > 0);
  assert.ok(eager.fuelUsedTanks > 0);
});

test('пальне закінчується — генератор зупиняється', () => {
  const model = buildModel({ ...noBattery, sources: [{ ...generator, fuelPct: 5 }] });
  const m = simulate(model, [timeToSlot('10:00'), 0], model.plannedGrid);
  assert.ok(m.fuelUsedTanks <= 0.05 + 1e-9);
  assert.ok(m.generatorHours < 2);
  assert.deepEqual(m.failedIds, ['boiler']);
});

test('сонячна генерація: денна енергія відповідає параметрам панелей', () => {
  const model = buildModel({ ...noBattery, appliances: [], sources: [{ kind: 'solar', peakW: 800, sunHours: 3 }] });
  const dayWh = model.solar.reduce((s, w) => s + w * model.slotHours, 0);
  assert.ok(Math.abs(dayWh - 800 * 3 * SOLAR_DERATE) / (800 * 3 * SOLAR_DERATE) < 0.02);
  assert.ok(Math.max(...model.solar) <= 800 * SOLAR_DERATE + 1e-9);
  assert.equal(model.solar[timeToSlot('03:00')], 0);
});

test('сонце зменшує розряд станції під час денного відключення', () => {
  const household = {
    ...noBattery,
    battery: { capacityWh: 1000, initialSocPct: 100, minSocPct: 10, targetEndSocPct: 0, maxChargeW: 500, inverterMaxW: 1500 },
    appliances: [],
  };
  const without = simulate(buildModel(household), [], buildModel(household).plannedGrid);
  const model = buildModel({ ...household, sources: [{ kind: 'solar', peakW: 800, sunHours: 3 }] });
  const withSun = simulate(model, [], model.plannedGrid);
  assert.ok(withSun.batteryWh < without.batteryWh);
  assert.ok(withSun.solarWh > 0);
});

test('без генераторів і панелей результат імітації не змінюється', () => {
  const household = {
    ...noBattery,
    battery: { capacityWh: 1000, initialSocPct: 50, minSocPct: 10, targetEndSocPct: 60, maxChargeW: 500, inverterMaxW: 1500 },
  };
  const a = simulate(buildModel(household), [timeToSlot('13:00')], buildModel(household).plannedGrid);
  const b = simulate(buildModel({ ...household, sources: [] }), [timeToSlot('13:00')], buildModel(household).plannedGrid);
  assert.equal(a.cost, b.cost);
  assert.equal(a.endSocPct, b.endSocPct);
});

test('перепланування: ввімкнений прилад зафіксовано, решта не раніше поточного моменту', () => {
  const household = {
    ...noBattery,
    battery: { capacityWh: 1000, initialSocPct: 80, minSocPct: 10, targetEndSocPct: 50, maxChargeW: 500, inverterMaxW: 1500 },
    outages: [{ from: '15:00', to: '18:00' }],
    appliances: [
      { id: 'washer', name: 'Пральна машина', powerW: 500, durationMin: 90, earliest: '07:00', latest: '23:00', preferredStart: '09:00', priority: 3 },
      { ...boiler, earliest: '06:00', latest: '22:00' },
    ],
  };
  const nowSlot = timeToSlot('12:00');
  const result = plan(household, { algorithm: 'greedy', replan: { nowSlot, fixedStarts: { washer: timeToSlot('11:30') }, socPct: 40 } });
  const washer = result.schedule.find((s) => s.id === 'washer');
  const boilerPlan = result.schedule.find((s) => s.id === 'boiler');
  assert.equal(washer.start, '11:30');
  assert.ok(boilerPlan.startSlot >= nowSlot);
  assert.equal(result.fromSlot, nowSlot);
  // Імітація починається з поточного моменту і з фактичним зарядом.
  assert.equal(result.nominal.trace[0].slot, nowSlot);
});

test('план повертає правило запуску генератора', () => {
  const result = plan({ ...noBattery, sources: [generator] }, { algorithm: 'robust-ga', testScenarios: 50, ga: { generations: 30 } });
  assert.equal(result.generators.length, 1);
  assert.equal(result.generators[0].noBattery, true);
  // Без генератора бойлер у відключення не відпрацює, тому ГА має вирішити його вмикати.
  assert.notEqual(result.generators[0].thresholdPct, null);
});

test('прилад, вікно якого минуло до перепланування, не рахується провалом', () => {
  const household = {
    ...noBattery,
    outages: [],
    appliances: [{ id: 'kettle', name: 'Чайник', powerW: 1800, durationMin: 15, earliest: '07:00', latest: '09:00', priority: 3 }],
  };
  const result = plan(household, { algorithm: 'greedy', replan: { nowSlot: timeToSlot('12:00') } });
  assert.deepEqual(result.nominal.failedIds, []);
  assert.deepEqual(result.nominal.missedIds, ['kettle']);
  assert.equal(result.schedule[0].missed, true);
});

test('план на 48 год: дві доби, копії приладів і відключення завтра', () => {
  const household = {
    grid: { maxPowerW: 5000 },
    battery: { capacityWh: 1000, initialSocPct: 50, minSocPct: 10, targetEndSocPct: 20, maxChargeW: 500, inverterMaxW: 1500 },
    outages: [{ from: '18:00', to: '22:00' }],
    nextDay: { outages: [{ from: '22:00', to: '02:00' }] },
    baseLoads: [{ id: 'fridge', name: 'Холодильник', powerW: 100, priority: 5 }],
    appliances: [{ id: 'kettle', name: 'Чайник', powerW: 1800, durationMin: 15, earliest: '07:00', latest: '09:00', priority: 3 }],
  };
  const model = buildModel(household);
  assert.equal(model.T, 192);
  assert.equal(model.appliances.length, 2);
  assert.equal(model.appliances[1].id, 'kettle@2');
  assert.equal(model.plannedGrid[timeToSlot('19:00')], 0);
  assert.equal(model.plannedGrid[96 + timeToSlot('23:00')], 0);
  assert.equal(model.plannedGrid[96 + timeToSlot('12:00')], 1);
  const result = plan(household, { algorithm: 'greedy', testScenarios: 20 });
  assert.equal(result.nominal.trace.length, 192);
  const tomorrowKettle = result.schedule.find((s) => s.id === 'kettle@2');
  assert.equal(tomorrowKettle.day, 1);
  assert.ok(tomorrowKettle.startSlot >= 96);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModel,
  greedyPlan,
  generateScenarios,
  cvar,
  plan,
  solve,
  timeToSlot,
  SKIP,
} from '../src/index.js';
import { demoHousehold } from '../examples/demo-household.js';

test('сценарії відтворюються за однаковим зерном', () => {
  const model = buildModel(demoHousehold);
  const a = generateScenarios(model, { count: 5, seed: 3 });
  const b = generateScenarios(model, { count: 5, seed: 3 });
  assert.deepEqual(a, b);
});

test('без невизначеності сценарій збігається з графіком', () => {
  const model = buildModel(demoHousehold);
  const [s] = generateScenarios(model, { count: 1, shiftSdMin: 0, cancelProb: 0, extraProb: 0 });
  assert.deepEqual(s, model.plannedGrid);
});

test('CVaR дорівнює середньому серед найгірших значень', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(cvar(sorted, 0.8), 9.5);
});

test('жадібний алгоритм не ставить бойлер на час відключення', () => {
  const model = buildModel(demoHousehold);
  const starts = greedyPlan(model);
  const i = model.appliances.findIndex((a) => a.id === 'boiler');
  const s = starts[i];
  assert.notEqual(s, SKIP);
  for (let t = s; t < s + model.appliances[i].duration; t++) assert.equal(model.plannedGrid[t], 1);
});

test('усі методи повертають запуски в межах дозволених вікон', () => {
  const model = buildModel(demoHousehold);
  for (const algorithm of ['naive', 'greedy', 'ga', 'robust-ga']) {
    const { starts } = solve(model, algorithm, { ga: { generations: 20 }, trainingScenarios: 20 });
    starts.forEach((s, i) => {
      if (s === SKIP) return;
      const a = model.appliances[i];
      assert.ok(s >= a.earliest && s <= a.latestStart, `${algorithm}: ${a.id} поза вікном`);
    });
  }
});

test('стійкий ГА на тестових сценаріях кращий за ГА, що бачить лише графік', () => {
  const ga = plan(demoHousehold, { algorithm: 'ga' });
  const robust = plan(demoHousehold, { algorithm: 'robust-ga' });
  assert.ok(robust.robustness.meanCost < ga.robustness.meanCost);
  assert.ok(robust.robustness.failureProbability < ga.robustness.failureProbability);
});

test('план описується у зрозумілому вигляді', () => {
  const r = plan(demoHousehold, { algorithm: 'greedy', testScenarios: 10 });
  const boiler = r.schedule.find((s) => s.id === 'boiler');
  assert.match(boiler.start, /^\d{2}:\d{2}$/);
  assert.equal(timeToSlot(boiler.end) - timeToSlot(boiler.start), 4);
});

test('dropFailing: прилад, що за графіком обірветься відключенням, не лишається в плані', async () => {
  const { plan } = await import('../src/planner.js');
  // Без станції бойлер з вікном лише на час відключення не може відпрацювати ніяк.
  const household = {
    grid: { maxPowerW: 5000 },
    battery: null,
    outages: [{ from: '18:00', to: '22:00' }],
    baseLoads: [{ id: 'fridge', name: 'Холодильник', powerW: 60, priority: 5 }],
    appliances: [
      { id: 'boiler', name: 'Бойлер', powerW: 2000, durationMin: 60, earliest: '18:00', latest: '22:00', priority: 4, allowOnBattery: false },
      { id: 'washer', name: 'Пральна', powerW: 500, durationMin: 90, earliest: '07:00', latest: '23:00', priority: 3 },
    ],
  };
  const plain = plan(household, { algorithm: 'naive', testScenarios: 20 });
  const dropped = plan(household, { algorithm: 'naive', testScenarios: 20, dropFailing: true });
  const boiler = (r) => r.schedule.find((s) => s.id === 'boiler');
  assert.equal(boiler(plain).skipped, false, 'без обробки бойлер у плані лишається, хоч і не відпрацює');
  assert.ok(plain.nominal.failedIds.includes('boiler'));
  assert.equal(boiler(dropped).skipped, true);
  assert.equal(boiler(dropped).wontRun, true);
  // У сліді плану бойлер більше не вмикається під час відключення.
  assert.equal(dropped.nominal.trace[timeToSlot('18:00')].demandW, 60);
  // Прилад, який встигає зі світлом, не чіпаємо.
  assert.equal(dropped.schedule.find((s) => s.id === 'washer').skipped, false);
});

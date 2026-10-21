import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, simulate, solve, DEFAULT_WEIGHTS } from '../src/index.js';
import { solveNominalMilp } from '../src/milp.js';
import { demoHousehold } from '../examples/demo-household.js';

test('MILP дає нижню оцінку штрафу, яку досягає ГА на демо-задачі', async () => {
  const model = buildModel(demoHousehold);
  const milp = await solveNominalMilp(model, DEFAULT_WEIGHTS);
  assert.equal(milp.status, 'Optimal');
  const ga = simulate(model, solve(model, 'ga', { ga: { seed: 1 } }).starts, model.plannedGrid).cost;
  const greedy = simulate(model, solve(model, 'greedy').starts, model.plannedGrid).cost;
  assert.ok(milp.bound <= greedy + 1e-6);
  assert.ok(Math.abs(ga - milp.bound) < 1e-6);
  // План MILP, перевірений в імітаторі, не гірший за жадібний.
  assert.ok(simulate(model, milp.starts, model.plannedGrid).cost <= greedy + 1e-6);
});

test('MILP: потужний прилад без станції не ставиться у відключення', async () => {
  const model = buildModel({
    grid: { maxPowerW: 3000 },
    battery: null,
    outages: [{ from: '10:00', to: '14:00' }],
    baseLoads: [],
    appliances: [{ id: 'b', name: 'Бойлер', powerW: 2000, durationMin: 60, earliest: '09:00', latest: '16:00', preferredStart: '11:00', priority: 4, allowOnBattery: false }],
  });
  const milp = await solveNominalMilp(model, DEFAULT_WEIGHTS);
  const start = milp.starts[0];
  assert.ok(start + 4 <= 40 || start >= 56, `старт ${start} потрапляє у відключення`);
});

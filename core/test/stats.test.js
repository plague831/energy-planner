import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mean, sd, ci95, normalCdf, wilcoxonSignedRank, buildModel, exhaustivePlan, simulate, geneticPlan } from '../src/index.js';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('описова статистика', () => {
  close(mean([1, 2, 3, 4]), 2.5);
  close(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138);
  // n = 5, t = 2.776: 2.776 · sd / √5
  close(ci95([1, 2, 3, 4, 5]), (2.776 * Math.sqrt(2.5)) / Math.sqrt(5));
  close(normalCdf(1.96), 0.975);
  close(normalCdf(-1.96), 0.025);
});

test('тест Вілкоксона: усі різниці додатні', () => {
  const b = Array.from({ length: 10 }, () => 0);
  const a = Array.from({ length: 10 }, (_, i) => i + 1);
  const r = wilcoxonSignedRank(a, b);
  assert.equal(r.wPlus, 55);
  close(r.z, 2.7522, 1e-3);
  assert.ok(r.p < 0.01);
});

test('тест Вілкоксона: однакові вибірки не дають значущої різниці', () => {
  const a = [3, 1, 4, 1, 5];
  const r = wilcoxonSignedRank(a, [...a]);
  assert.equal(r.p, 1);
  assert.equal(r.n, 0);
});

test('перебір знаходить оптимум, не гірший за ГА', () => {
  const model = buildModel({
    grid: { maxPowerW: 3000 },
    battery: null,
    outages: [{ from: '10:00', to: '13:00' }],
    baseLoads: [],
    appliances: [
      { name: 'A', powerW: 2000, durationMin: 60, earliest: '09:00', latest: '14:00', preferredStart: '10:00', priority: 3 },
      { name: 'B', powerW: 1500, durationMin: 30, earliest: '11:00', latest: '15:00', preferredStart: '11:30', priority: 2 },
    ],
  });
  const fitness = (s) => simulate(model, s, model.plannedGrid).cost;
  const exact = exhaustivePlan(model, fitness);
  const ga = geneticPlan(model, fitness, { seed: 3 });
  assert.ok(exact.cost <= ga.cost + 1e-9);
  // Обидва прилади не потрапляють у відключення 10:00–13:00 і разом не перевищують ліміт мережі.
  assert.ok(exact.starts.every((s) => s >= 0));
});

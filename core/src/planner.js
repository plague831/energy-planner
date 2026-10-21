import { buildModel, GENERATOR_THRESHOLD_STEP } from './model.js';
import { simulate, DEFAULT_WEIGHTS, SKIP } from './simulate.js';
import { generateScenarios } from './scenarios.js';
import { robustCost, evaluatePlan, DEFAULT_RISK } from './robust.js';
import { naivePlan } from './algorithms/naive.js';
import { greedyPlan } from './algorithms/greedy.js';
import { geneticPlan } from './algorithms/genetic.js';
import { slotToTime } from './time.js';

export const ALGORITHMS = {
  naive: 'Без планування (бажаний час)',
  greedy: 'Жадібний алгоритм',
  ga: 'Генетичний алгоритм (за графіком)',
  'robust-ga': 'Стійкий генетичний алгоритм (з урахуванням невизначеності)',
};

// Обчислює хромосому плану обраним методом.
export function solve(model, algorithm, options = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const risk = { ...DEFAULT_RISK, ...options.risk };
  switch (algorithm) {
    case 'naive':
      return { starts: naivePlan(model) };
    case 'greedy':
      return { starts: greedyPlan(model, { weights }) };
    case 'ga': {
      const initial = [naivePlan(model), greedyPlan(model, { weights })];
      const fitness = (s) => simulate(model, s, model.plannedGrid, weights).cost;
      return geneticPlan(model, fitness, { ...options.ga, initial });
    }
    case 'robust-ga': {
      // Сценарії для навчання мають інше зерно, ніж сценарії для перевірки, щоб оцінка була чесною.
      const training = generateScenarios(model, {
        count: options.trainingScenarios ?? 60,
        seed: options.trainingSeed ?? 1001,
        ...options.uncertainty,
      });
      const initial = [naivePlan(model), greedyPlan(model, { weights })];
      const fitness = (s) => robustCost(model, s, training, weights, risk);
      return geneticPlan(model, fitness, { ...options.ga, initial });
    }
    default:
      throw new Error(`Невідомий метод: ${algorithm}`);
  }
}

// Повний цикл: дані форми -> план -> оцінка за графіком і на тестових сценаріях.
export function plan(household, options = {}) {
  const algorithm = options.algorithm ?? 'robust-ga';
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const risk = { ...DEFAULT_RISK, ...options.risk };
  // options.replan — перепланування з поточного моменту (див. buildModel).
  const model = buildModel(household, options.replan ?? null);

  const started = performance.now();
  const result = solve(model, algorithm, options);
  const elapsedMs = performance.now() - started;

  const nominal = simulate(model, result.starts, model.plannedGrid, weights, { trace: true });
  const testScenarios = generateScenarios(model, {
    count: options.testScenarios ?? 300,
    seed: options.testSeed ?? 7777,
    ...options.uncertainty,
  });
  const robustness = evaluatePlan(model, result.starts, testScenarios, weights, risk);

  return {
    algorithm,
    algorithmName: ALGORITHMS[algorithm],
    elapsedMs,
    schedule: describeSchedule(model, result.starts),
    generators: describeGenerators(model, result.starts),
    fromSlot: model.startSlot,
    nominal,
    robustness,
    convergence: result.history ?? null,
  };
}

export function describeSchedule(model, starts) {
  return model.appliances.map((a, i) => {
    const s = starts[i];
    const day = a.day ?? 0;
    if (s === SKIP) return { id: a.id, baseId: a.baseId ?? a.id, day, name: a.name, skipped: true, missed: Boolean(a.missed) };
    const DAY = 96;
    const end = s + a.duration;
    return {
      id: a.id,
      baseId: a.baseId ?? a.id,
      day,
      name: a.name,
      skipped: false,
      startSlot: s,
      endSlot: end,
      start: slotToTime(s % DAY),
      end: end % DAY === 0 && end > 0 ? '24:00' : slotToTime(end % DAY),
    };
  });
}

// Правило для кожного генератора: з якого заряду станції його вмикати (null — не вмикати сьогодні).
export function describeGenerators(model, starts) {
  const nA = model.appliances.length;
  return model.generators.map((g, k) => {
    const gene = starts[nA + k];
    return {
      id: g.id,
      name: g.name,
      thresholdPct: gene === SKIP || gene === undefined ? null : gene * GENERATOR_THRESHOLD_STEP,
      noBattery: !model.battery,
    };
  });
}

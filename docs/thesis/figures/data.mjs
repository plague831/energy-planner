// Дані для рисунків розділів 2 і 3: сценарії графіка, робота генератора за пороговим правилом,
// штраф планів різних методів на тестових сценаріях (рис. 3.4).
// Запуск: node docs/thesis/figures/data.mjs > дані.json
import { buildModel, generateScenarios, simulate, solve, GENERATOR_THRESHOLD_STEP } from '../../../core/src/index.js';
import { demoHousehold } from '../../../core/examples/demo-household.js';

const model = buildModel(demoHousehold);
const scenarios = generateScenarios(model, { count: 6, seed: 1001 }).map((g) => Array.from(g));

// Квартира зі станцією і генератором, довге відключення, генератор вмикається при 30%.
const household = {
  ...demoHousehold,
  outages: [{ from: '06:00', to: '16:00' }],
  appliances: [],
  sources: [{ id: 'gen', kind: 'generator', name: 'Генератор', ratedW: 2000, tankHoursAtHalf: 8, fuelPct: 100 }],
};
const genModel = buildModel(household);
const threshold = 30;
const run = simulate(genModel, [threshold / GENERATOR_THRESHOLD_STEP], genModel.plannedGrid, undefined, { trace: true });

// Рис. 3.4: штраф на тих самих 500 тестових сценаріях, що й у core/experiments/statistical.js
// (базова задача, середня невизначеність, зерно ГА 1).
const test = generateScenarios(model, { count: 500, seed: 99991 });
const penalties = Object.fromEntries(['naive', 'greedy', 'robust-ga'].map((algorithm) => {
  const { starts } = solve(model, algorithm, { ga: { seed: 1 } });
  return [algorithm, test.map((grid) => simulate(model, starts, grid).cost)];
}));

console.log(JSON.stringify({
  penalties,
  planned: Array.from(model.plannedGrid),
  scenarios,
  generator: {
    threshold,
    capacityWh: genModel.battery.capacityWh,
    initialSocPct: (genModel.battery.initialWh / genModel.battery.capacityWh) * 100,
    grid: Array.from(genModel.plannedGrid),
    trace: run.trace.map((t) => ({ socPct: (t.energyWh / genModel.battery.capacityWh) * 100, generatorW: t.generatorW, fuelPct: t.fuelPct })),
    fuelUsedTanks: run.fuelUsedTanks,
    generatorHours: run.generatorHours,
  },
}));

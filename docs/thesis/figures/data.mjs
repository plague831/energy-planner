// Дані для рисунків розділу 2: сценарії графіка і робота генератора за пороговим правилом.
// Запуск: node docs/thesis/figures/data.mjs > дані.json
import { buildModel, generateScenarios, simulate, GENERATOR_THRESHOLD_STEP } from '../../../core/src/index.js';
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

console.log(JSON.stringify({
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

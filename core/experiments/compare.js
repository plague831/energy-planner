// Експеримент: порівняння методів планування на тестових сценаріях невизначеності.
// Запуск: npm run experiment (з кореня репозиторію). Результати зберігаються в experiments/results/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, solve, generateScenarios, evaluatePlan, ALGORITHMS } from '../src/index.js';
import { demoHousehold } from '../examples/demo-household.js';

const here = dirname(fileURLToPath(import.meta.url));

const cases = {
  'Базовий (2 відключення, станція 1 кВт·год)': demoHousehold,
  '3 відключення на добу': {
    ...demoHousehold,
    outages: [
      { from: '00:00', to: '04:00' },
      { from: '08:00', to: '12:00' },
      { from: '16:00', to: '20:00' },
    ],
  },
  'Без зарядної станції': { ...demoHousehold, battery: null },
  'Станція 2 кВт·год': { ...demoHousehold, battery: { ...demoHousehold.battery, capacityWh: 2048, maxChargeW: 1000, inverterMaxW: 2400 } },
};

const uncertaintyLevels = {
  'низька': { shiftSdMin: 15, maxShiftMin: 45, cancelProb: 0.02, extraProb: 0.05 },
  'середня': {},
  'висока': { shiftSdMin: 60, maxShiftMin: 120, cancelProb: 0.1, extraProb: 0.2 },
};

const seeds = [42, 7, 2024];
const TEST_SCENARIOS = 500;

const rows = [];
for (const [caseName, household] of Object.entries(cases)) {
  const model = buildModel(household);
  for (const [levelName, uncertainty] of Object.entries(uncertaintyLevels)) {
    const test = generateScenarios(model, { count: TEST_SCENARIOS, seed: 99991, ...uncertainty });
    for (const algorithm of Object.keys(ALGORITHMS)) {
      const stochastic = algorithm === 'ga' || algorithm === 'robust-ga';
      for (const seed of stochastic ? seeds : [null]) {
        const started = performance.now();
        const { starts } = solve(model, algorithm, { uncertainty, ga: seed === null ? {} : { seed } });
        const ms = performance.now() - started;
        const r = evaluatePlan(model, starts, test);
        rows.push({ case: caseName, uncertainty: levelName, algorithm, seed, ms, ...r });
      }
    }
  }
}

// Усереднення за зернами ГА.
const groups = new Map();
for (const r of rows) {
  const key = `${r.case}|${r.uncertainty}|${r.algorithm}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const avg = (list, f) => list.reduce((s, r) => s + r[f], 0) / list.length;
const summary = [...groups.values()].map((list) => ({
  case: list[0].case,
  uncertainty: list[0].uncertainty,
  algorithm: list[0].algorithm,
  meanCost: avg(list, 'meanCost'),
  cvarCost: avg(list, 'cvarCost'),
  failureProbability: avg(list, 'failureProbability'),
  shedProbability: avg(list, 'shedProbability'),
  ms: avg(list, 'ms'),
}));

let current = '';
for (const s of summary) {
  const head = `${s.case} — невизначеність ${s.uncertainty}`;
  if (head !== current) {
    current = head;
    console.log(`\n${head}`);
    console.log('  метод        середній штраф   CVaR90   P(збій приладу)   P(вимкнення постійних навантажень)   час, мс');
  }
  console.log(
    `  ${s.algorithm.padEnd(11)} ${s.meanCost.toFixed(2).padStart(14)} ${s.cvarCost.toFixed(2).padStart(8)} ` +
      `${(s.failureProbability * 100).toFixed(1).padStart(15)}% ${(s.shedProbability * 100).toFixed(1).padStart(33)}% ${s.ms.toFixed(0).padStart(9)}`,
  );
}

const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'runs.json'), JSON.stringify(rows, null, 2));
const header = Object.keys(summary[0]);
const csv = [header.join(','), ...summary.map((s) => header.map((h) => JSON.stringify(s[h])).join(','))].join('\n');
writeFileSync(join(outDir, 'summary.csv'), csv);
console.log(`\nРезультати збережено в ${outDir}`);

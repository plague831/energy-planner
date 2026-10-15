// Аналіз чутливості: як якість планів залежить від параметрів задачі й методу.
// За замовчуванням усе як у базовій задачі із середньою невизначеністю, змінюється один параметр за раз.
// 1) ємність зарядної станції; 2) величина невизначеності графіка; 3) кількість навчальних сценаріїв
// стійкого ГА; 4) вага ризику λ у критерії «середнє + λ·CVaR».
// Запуск: npm run experiment:sensitivity. Таблиці — у core/experiments/sensitivity-report.md, дані — у results/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, solve, generateScenarios, evaluatePlan, mean, ci95, DEFAULT_UNCERTAINTY } from '../src/index.js';
import { demoHousehold } from '../examples/demo-household.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEEDS = [1, 2, 3, 4, 5];
const TEST_SCENARIOS = 500;
const TEST_SEED = 99991;
const started = performance.now();

// Оцінка одного методу на тестових сценаріях; для стійкого ГА — середнє за зернами.
function run(household, algorithm, { uncertainty = {}, trainingScenarios, risk } = {}) {
  const model = buildModel(household);
  const test = generateScenarios(model, { count: TEST_SCENARIOS, seed: TEST_SEED, ...uncertainty });
  const seeds = algorithm === 'robust-ga' || algorithm === 'ga' ? SEEDS : [null];
  const results = seeds.map((seed) => {
    const t0 = performance.now();
    const { starts } = solve(model, algorithm, { uncertainty, trainingScenarios, risk, ga: seed === null ? {} : { seed } });
    const ms = performance.now() - t0;
    // Оцінка на тестових сценаріях завжди з однаковою вагою ризику, щоб значення можна було порівнювати.
    return { ms, ...evaluatePlan(model, starts, test) };
  });
  const pick = (f) => results.map((r) => r[f]);
  return {
    meanCost: pick('meanCost'),
    cvarCost: pick('cvarCost'),
    failureProbability: pick('failureProbability'),
    shedProbability: pick('shedProbability'),
    ms: pick('ms'),
  };
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pm = (xs, d = 2) => (xs.length > 1 && ci95(xs) > 5e-3 * 10 ** -d ? `${fmt(mean(xs), d)} ± ${fmt(ci95(xs), d)}` : fmt(mean(xs), d));
const pct = (xs) => pm(xs.map((x) => x * 100), 1);
const gain = (robust, greedy) => (mean(greedy) > 0 ? `${fmt((1 - mean(robust) / mean(greedy)) * 100, 1)}%` : '—');

const data = {};
const lines = ['# Аналіз чутливості', ''];
lines.push(
  `Згенеровано скриптом \`core/experiments/sensitivity.js\`. Базова задача — демонстраційне домогосподарство із середньою невизначеністю; у кожному розділі змінюється один параметр. Стійкий ГА запускався з ${SEEDS.length} зернами, оцінка на ${TEST_SCENARIOS} тестових сценаріях. «Виграш» — на скільки відсотків середній штраф стійкого ГА менший, ніж у жадібного алгоритму.`,
  '',
);

// 1. Ємність станції.
{
  const capacities = [0, 256, 512, 1024, 2048, 3072];
  lines.push('## 1. Ємність зарядної станції', '');
  lines.push('| Ємність, Вт·год | Штраф жадібного | Штраф стійкого ГА | Виграш | P(збій приладу), жадібний / стійкий, % | P(вимкнення постійних), стійкий, % |');
  lines.push('|---|---|---|---|---|---|');
  data.capacity = [];
  for (const capacityWh of capacities) {
    const household = capacityWh === 0 ? { ...demoHousehold, battery: null } : { ...demoHousehold, battery: { ...demoHousehold.battery, capacityWh } };
    const greedy = run(household, 'greedy');
    const robust = run(household, 'robust-ga');
    data.capacity.push({ capacityWh, greedy, robust });
    lines.push(
      `| ${capacityWh === 0 ? 'немає' : capacityWh} | ${pm(greedy.meanCost)} | ${pm(robust.meanCost)} | ${gain(robust.meanCost, greedy.meanCost)} | ${pct(greedy.failureProbability)} / ${pct(robust.failureProbability)} | ${pct(robust.shedProbability)} |`,
    );
  }
  lines.push('');
  console.log('✓ ємність станції');
}

// 2. Величина невизначеності: стандартне відхилення зсуву відключення (максимальний зсув — 3σ).
{
  const sds = [0, 15, 30, 45, 60, 90];
  lines.push('## 2. Величина невизначеності графіка', '');
  lines.push('Змінюється стандартне відхилення σ зсуву початку й кінця відключень (максимальний зсув 3σ); ймовірності скасування і додаткового відключення — як у середньому рівні.', '');
  lines.push('| σ зсуву, хв | Штраф жадібного | Штраф стійкого ГА | Виграш | P(збій приладу), жадібний / стійкий, % |');
  lines.push('|---|---|---|---|---|');
  data.uncertainty = [];
  for (const sd of sds) {
    const uncertainty = { ...DEFAULT_UNCERTAINTY, shiftSdMin: sd, maxShiftMin: 3 * sd };
    const greedy = run(demoHousehold, 'greedy', { uncertainty });
    const robust = run(demoHousehold, 'robust-ga', { uncertainty });
    data.uncertainty.push({ shiftSdMin: sd, greedy, robust });
    lines.push(
      `| ${sd} | ${pm(greedy.meanCost)} | ${pm(robust.meanCost)} | ${gain(robust.meanCost, greedy.meanCost)} | ${pct(greedy.failureProbability)} / ${pct(robust.failureProbability)} |`,
    );
  }
  lines.push('');
  console.log('✓ невизначеність');
}

// 3. Кількість навчальних сценаріїв стійкого ГА.
{
  const counts = [5, 10, 20, 40, 60, 100, 200];
  lines.push('## 3. Кількість навчальних сценаріїв стійкого ГА', '');
  lines.push('| Сценаріїв | Штраф на тестових сценаріях | CVaR₉₀ | P(збій приладу), % | Час планування, мс |');
  lines.push('|---|---|---|---|---|');
  data.training = [];
  for (const trainingScenarios of counts) {
    const robust = run(demoHousehold, 'robust-ga', { trainingScenarios });
    data.training.push({ trainingScenarios, robust });
    lines.push(`| ${trainingScenarios} | ${pm(robust.meanCost)} | ${pm(robust.cvarCost)} | ${pct(robust.failureProbability)} | ${pm(robust.ms, 0)} |`);
  }
  lines.push('');
  console.log('✓ кількість сценаріїв');
}

// 4. Вага ризику λ.
{
  const lambdas = [0, 0.25, 0.5, 1, 2, 4];
  lines.push('## 4. Вага ризику λ у критерії «середнє + λ·CVaR₉₀»', '');
  lines.push('λ = 0 — оптимізується лише середній штраф; більші λ сильніше карають найгірші сценарії.', '');
  lines.push('| λ | Середній штраф | CVaR₉₀ | P(збій приладу), % | P(вимкнення постійних), % |');
  lines.push('|---|---|---|---|---|');
  data.risk = [];
  for (const lambda of lambdas) {
    const robust = run(demoHousehold, 'robust-ga', { risk: { lambda, alpha: 0.9 } });
    data.risk.push({ lambda, robust });
    lines.push(`| ${lambda} | ${pm(robust.meanCost)} | ${pm(robust.cvarCost)} | ${pct(robust.failureProbability)} | ${pct(robust.shedProbability)} |`);
  }
  lines.push('');
  console.log('✓ вага ризику');
}

lines.push(`Загальний час: ${fmt((performance.now() - started) / 1000, 1)} с.`, '');
writeFileSync(join(here, 'sensitivity-report.md'), lines.join('\n'));
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'sensitivity.json'), JSON.stringify(data, null, 1));
console.log(`\nЗвіт: ${join(here, 'sensitivity-report.md')}`);

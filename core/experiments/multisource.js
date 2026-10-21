// Експеримент для двох розширень методу:
// 1) керування генератором: чи дає оптимізація порогу запуску перевагу над типовими правилами;
// 2) перепланування протягом дня: наскільки кращий план, перебудований після зміни графіка, ніж ранковий план без змін.
// Запуск: npm run experiment:multisource. Таблиці — у core/experiments/multisource-report.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildModel,
  simulate,
  solve,
  generateScenarios,
  robustCost,
  geneticPlan,
  naivePlan,
  greedyPlan,
  withGeneratorGenes,
  timeToSlot,
  mean,
  ci95,
  wilcoxonSignedRank,
  SKIP,
  DEFAULT_WEIGHTS,
  DEFAULT_RISK,
} from '../src/index.js';
import { demoHousehold } from '../examples/demo-household.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEEDS = [1, 2, 3, 4, 5];
const TEST_SCENARIOS = 500;
const TEST_SEED = 99991;
const started = performance.now();

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pm = (xs, d = 2) => (xs.length > 1 && ci95(xs) >= 0.5 * 10 ** -d ? `${fmt(mean(xs), d)} ± ${fmt(ci95(xs), d)}` : fmt(mean(xs), d));
const pText = (p) => (p < 0.001 ? '< 0.001' : p.toFixed(3));

// Оцінка плану на тестових сценаріях: штраф і показники, зокрема витрата пального.
function evaluate(model, starts, scenarios) {
  const runs = scenarios.map((grid) => simulate(model, starts, grid));
  const costs = runs.map((r) => r.cost);
  const sorted = [...costs].sort((a, b) => a - b);
  const tail = sorted.slice(Math.floor(sorted.length * 0.9));
  return {
    costs,
    meanCost: mean(costs),
    cvarCost: mean(tail),
    failureProbability: runs.filter((r) => r.failedIds.length).length / runs.length,
    shedProbability: runs.filter((r) => r.shedBasePoints > 0).length / runs.length,
    fuelTanks: mean(runs.map((r) => r.fuelUsedTanks)),
    generatorHours: mean(runs.map((r) => r.generatorHours)),
  };
}

// Стійкий ГА лише за приладами: ген генератора зафіксовано заданим правилом.
function robustWithFixedGenerator(model, gene, seed) {
  const fixedModel = { ...model, genes: model.genes.map((g, i) => (i >= model.appliances.length ? { earliest: gene, latestStart: gene, fixed: true } : g)) };
  const training = generateScenarios(model, { count: 60, seed: 1001 });
  const initial = [withGeneratorGenes(model, naivePlan(model), gene), withGeneratorGenes(model, greedyPlan(model), gene)];
  return geneticPlan(fixedModel, (s) => robustCost(model, s, training, DEFAULT_WEIGHTS, DEFAULT_RISK), { seed, initial }).starts;
}

const lines = ['# Генератор і перепланування протягом дня', ''];
lines.push(
  `Згенеровано скриптом \`core/experiments/multisource.js\`. Стійкий ГА запускався з ${SEEDS.length} зернами, оцінка на ${TEST_SCENARIOS} тестових сценаріях невизначеності (середній рівень). Значення — середнє ± напівширина 95% довірчого інтервалу за зернами.`,
  '',
);

// ---------- 1. Керування генератором ----------
const generator = { id: 'gen', kind: 'generator', name: 'Генератор', ratedW: 2500, tankHoursAtHalf: 8, fuelPct: 100 };
const genCases = {
  'Станція 1 кВт·год + генератор, 2 довгі відключення': {
    ...demoHousehold,
    outages: [
      { from: '07:00', to: '13:00' },
      { from: '17:00', to: '23:00' },
    ],
    sources: [generator],
  },
  'Без станції, лише генератор, 2 відключення': { ...demoHousehold, battery: null, sources: [generator] },
};
const policies = {
  'Без генератора': { gene: SKIP },
  'Генератор на все відключення': { gene: 20 },
  'Правило: вмикати при 30% заряду': { gene: 6 },
  'Стійкий ГА з оптимізацією порогу': { gene: null },
};
const genRows = [];
lines.push('## 1. Керування генератором', '');
lines.push(
  'Для правил генератора час приладів підбирав той самий стійкий ГА, змінювалось лише правило запуску генератора. В останньому рядку ГА оптимізує поріг разом із часом приладів. Витрата пального — частка повного бака за добу.',
  '',
);
for (const [caseName, household] of Object.entries(genCases)) {
  const model = buildModel(household);
  const test = generateScenarios(model, { count: TEST_SCENARIOS, seed: TEST_SEED });
  lines.push(`### ${caseName}`, '');
  lines.push('| Керування генератором | Середній штраф | CVaR₉₀ | P(збій приладу), % | P(вимкнення постійних), % | Пальне, бака | Генератор, год |');
  lines.push('|---|---|---|---|---|---|---|');
  const perScenario = {};
  for (const [policyName, { gene }] of Object.entries(policies)) {
    if (!model.battery && gene !== null && gene !== SKIP && gene !== 20) continue; // без станції поріг заряду не має сенсу
    const results = SEEDS.map((seed) => {
      const starts = gene === null ? solve(model, 'robust-ga', { ga: { seed } }).starts : robustWithFixedGenerator(model, gene, seed);
      return { starts, ...evaluate(model, starts, test) };
    });
    const pick = (f) => results.map((r) => r[f]);
    perScenario[policyName] = test.map((_, k) => mean(results.map((r) => r.costs[k])));
    const thresholds =
      gene === null
        ? [...new Set(results.map((r) => r.starts[model.appliances.length]))].map((g) => (g === SKIP ? 'не вмикати' : model.battery ? `${g * 5}%` : 'з початку відключення'))
        : null;
    genRows.push({ case: caseName, policy: policyName, thresholds, ...Object.fromEntries(['meanCost', 'cvarCost', 'failureProbability', 'shedProbability', 'fuelTanks', 'generatorHours'].map((f) => [f, pick(f)])) });
    lines.push(
      `| ${policyName}${thresholds ? ` (обрано: ${[...new Set(thresholds)].join(', ')})` : ''} | ${pm(pick('meanCost'))} | ${pm(pick('cvarCost'))} | ${pm(pick('failureProbability').map((x) => x * 100), 1)} | ${pm(pick('shedProbability').map((x) => x * 100), 1)} | ${pm(pick('fuelTanks'), 2)} | ${pm(pick('generatorHours'), 1)} |`,
    );
  }
  const best = 'Стійкий ГА з оптимізацією порогу';
  lines.push('', 'Парний тест Вілкоксона: оптимізований поріг проти кожного правила.', '');
  lines.push('| Проти | Різниця середнього штрафу | z | p |');
  lines.push('|---|---|---|---|');
  for (const other of Object.keys(perScenario).filter((p) => p !== best)) {
    const w = wilcoxonSignedRank(perScenario[best], perScenario[other]);
    lines.push(`| ${other} | ${fmt(mean(perScenario[best]) - mean(perScenario[other]))} | ${fmt(w.z)} | ${pText(w.p)} |`);
  }
  lines.push('');
  console.log(`✓ генератор: ${caseName}`);
}

// ---------- 2. Перепланування протягом дня ----------
// Зранку план складено за графіком S0; о 12:00 оператор публікує новий графік S1.
// Статичний план лишається ранковим; перепланований — перебудовується з 12:00 за S1.
const TAU = timeToSlot('12:00');
const base = demoHousehold;
const changes = {
  'Вечірнє відключення зсунуто на 2 год пізніше': [
    { from: '08:00', to: '12:00' },
    { from: '20:00', to: '24:00' },
  ],
  'Вечірнє відключення подовжено на 1,5 год': [
    { from: '08:00', to: '12:00' },
    { from: '18:00', to: '23:30' },
  ],
  'Додано денне відключення 14:00–17:00': [
    { from: '08:00', to: '12:00' },
    { from: '14:00', to: '17:00' },
    { from: '18:00', to: '22:00' },
  ],
  'Вечірнє відключення скасовано': [{ from: '08:00', to: '12:00' }],
};
lines.push('## 2. Перепланування після зміни графіка', '');
lines.push(
  `Зранку план складено стійким ГА за початковим графіком (відключення 08:00–12:00 і 18:00–22:00). О ${'12:00'} графік змінюється. «Без перепланування» — ранковий план виконується далі; «З переплануванням» — план на решту дня перебудовується з урахуванням уже ввімкнених приладів і заряду станції на 12:00. Оцінка — на сценаріях невизначеності навколо нового графіка, лише для решти дня.`,
  '',
);
lines.push('| Зміна графіка | Штраф без перепланування | Штраф з переплануванням | Виграш | CVaR₉₀: без / з | P(збій приладу): без / з, % | z | p |');
lines.push('|---|---|---|---|---|---|---|---|');
const replanRows = [];
for (const [changeName, newOutages] of Object.entries(changes)) {
  const staticRuns = [];
  const replanRuns = [];
  for (const seed of SEEDS) {
    const morningModel = buildModel(base);
    const morning = solve(morningModel, 'robust-ga', { ga: { seed } }).starts;
    const morningTrace = simulate(morningModel, morning, morningModel.plannedGrid, DEFAULT_WEIGHTS, { trace: true }).trace;
    const socPct = (morningTrace[TAU - 1].energyWh / morningModel.battery.capacityWh) * 100;
    const fixedStarts = {};
    morningModel.appliances.forEach((a, i) => {
      if (morning[i] !== SKIP && morning[i] < TAU) fixedStarts[a.id] = morning[i];
    });
    const after = buildModel({ ...base, outages: newOutages }, { nowSlot: TAU, fixedStarts, socPct });
    const test = generateScenarios(after, { count: TEST_SCENARIOS, seed: TEST_SEED });
    // Ранковий план у термінах нової моделі: ще не ввімкнені прилади лишаються на ранковому часі,
    // а якщо ранковий час потрапляє в нове вікно, недоступне після 12:00, — прилад пропускається.
    const staticStarts = after.appliances.map((a, i) => (a.missed ? SKIP : morning[i]));
    const replanned = solve(after, 'robust-ga', { ga: { seed } }).starts;
    staticRuns.push(evaluate(after, staticStarts, test));
    replanRuns.push(evaluate(after, replanned, test));
  }
  const avgCosts = (runs) => runs[0].costs.map((_, k) => mean(runs.map((r) => r.costs[k])));
  const w = wilcoxonSignedRank(avgCosts(replanRuns), avgCosts(staticRuns));
  const sMean = staticRuns.map((r) => r.meanCost);
  const rMean = replanRuns.map((r) => r.meanCost);
  replanRows.push({ change: changeName, static: sMean, replanned: rMean, wilcoxon: w });
  const gain = mean(sMean) > 0 ? `${fmt((1 - mean(rMean) / mean(sMean)) * 100, 1)}%` : '—';
  lines.push(
    `| ${changeName} | ${pm(sMean)} | ${pm(rMean)} | ${gain} | ${pm(staticRuns.map((r) => r.cvarCost))} / ${pm(replanRuns.map((r) => r.cvarCost))} | ${pm(staticRuns.map((r) => r.failureProbability * 100), 1)} / ${pm(replanRuns.map((r) => r.failureProbability * 100), 1)} | ${fmt(w.z)} | ${pText(w.p)} |`,
  );
  console.log(`✓ перепланування: ${changeName}`);
}
lines.push(
  '',
  'z < 0 означає, що з переплануванням штраф менший. Перепланування оптимізує стійкий критерій «середнє + λ·CVaR» на навчальних сценаріях, а не лише середнє, тому інколи жертвує частиною середнього штрафу заради хвоста розподілу або навпаки. Коли зміна графіка майже не зачіпає план (як при подовженні вечірнього відключення), середні результати практично однакові, а різниця в кілька сотих бала статистично помітна лише через великий обсяг вибірки.',
  '',
  `Загальний час: ${fmt((performance.now() - started) / 1000, 1)} с.`,
  '',
);

writeFileSync(join(here, 'multisource-report.md'), lines.join('\n'));
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', 'multisource.json'), JSON.stringify({ generator: genRows, replanning: replanRows }, null, 1));
console.log(`\nЗвіт: ${join(here, 'multisource-report.md')}`);

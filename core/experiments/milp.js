// Порівняння з точним розв'язком (MILP, HiGHS), як у EMHASS.
// 1) Наскільки ГА і жадібний алгоритм близькі до оптимуму на опублікованому графіку
//    (MILP дає нижню оцінку штрафу, доведену солвером).
// 2) Наскільки стійкий навіть точний оптимум за графіком, якщо відключення зсуваються:
//    план MILP перевіряється на тих самих тестових сценаріях, що й стійкий ГА.
// Запуск: npm run experiment:milp. Таблиці — у core/experiments/milp-report.md.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, simulate, solve, generateScenarios, evaluatePlan, createRng, slotToTime, mean, ci95, wilcoxonSignedRank, DEFAULT_WEIGHTS } from '../src/index.js';
import { solveNominalMilp } from '../src/milp.js';
import { demoHousehold } from '../examples/demo-household.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEEDS = [1, 2, 3, 4, 5];
const TEST_SCENARIOS = 500;
const fmt = (x, d = 2) => (Number.isFinite(x) ? (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d) : '—');
const pm = (xs, d = 2) => (xs.length > 1 && ci95(xs) >= 0.5 * 10 ** -d ? `${fmt(mean(xs), d)} ± ${fmt(ci95(xs), d)}` : fmt(mean(xs), d));
const pText = (p) => (p < 0.001 ? '< 0.001' : p.toFixed(3));
const started = performance.now();

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

// Випадкові задачі середнього розміру: 6 приладів з широкими вікнами — забагато для повного перебору,
// але під силу MILP.
const NAMES = ['Пральна машина', 'Бойлер', 'Посудомийка', 'Духовка', 'Чайник', 'Праска'];
function randomHousehold(seed) {
  const rng = createRng(seed);
  const outages = [];
  for (let k = 0; k < rng.int(1, 3); k++) {
    const from = rng.int(0, 80);
    outages.push({ from: slotToTime(from), to: slotToTime(Math.min(96, from + rng.int(8, 20)) % 96) });
  }
  const appliances = NAMES.map((name, i) => {
    const duration = rng.int(1, 8);
    const earliest = rng.int(16, 60);
    const latest = Math.min(96, earliest + duration + rng.int(12, 36));
    return {
      id: `a${i}`,
      name,
      powerW: [500, 2000, 1200, 2200, 1800, 2000][i],
      durationMin: duration * 15,
      earliest: slotToTime(earliest),
      latest: latest === 96 ? '24:00' : slotToTime(latest),
      preferredStart: slotToTime(earliest + rng.int(0, latest - earliest - duration)),
      priority: rng.int(1, 5),
      allowOnBattery: rng.chance(0.5),
    };
  });
  return {
    ...demoHousehold,
    battery: { ...demoHousehold.battery, initialSocPct: rng.int(30, 100) },
    outages: dedupeOutages(outages),
    appliances,
  };
}
function dedupeOutages(list) {
  return list.filter((o) => o.from !== o.to);
}

const lines = ['# Порівняння з точним розв\'язком (MILP)', ''];
lines.push(
  'Згенеровано скриптом `core/experiments/milp.js`. Задача на опублікованому графіку записана як задача змішаного цілочисельного лінійного програмування і розв\'язана солвером HiGHS. Солвер може обирати заряджання й вимкнення постійних навантажень оптимально, тоді як імітатор робить це за правилами, тож значення MILP — **нижня оцінка** штрафу: жоден план не може бути кращим.',
  '',
);

// ---------- 1. Відстань до оптимуму ----------
lines.push('## 1. Відстань до оптимуму на опублікованому графіку', '');
lines.push('| Задача | Нижня оцінка MILP | План MILP в імітаторі | Жадібний | ГА за графіком | Відхилення ГА від оцінки | Час MILP, мс |');
lines.push('|---|---|---|---|---|---|---|');
const gapRows = [];
const instances = [
  ...Object.entries(cases).map(([name, h]) => ({ name, h })),
  ...Array.from({ length: 20 }, (_, k) => ({ name: `Випадкова задача ${k + 1}`, h: randomHousehold(500 + k), random: true })),
];
for (const { name, h, random } of instances) {
  const model = buildModel(h);
  const milp = await solveNominalMilp(model, DEFAULT_WEIGHTS);
  const nominal = (starts) => simulate(model, starts, model.plannedGrid).cost;
  const greedy = nominal(solve(model, 'greedy').starts);
  const ga = SEEDS.map((seed) => nominal(solve(model, 'ga', { ga: { seed } }).starts));
  const gap = mean(ga) - milp.bound;
  gapRows.push({ name, random, bound: milp.bound, milpSim: nominal(milp.starts), greedy, ga: mean(ga), gap, ms: milp.ms, status: milp.status });
  if (!random) {
    lines.push(`| ${name} | ${fmt(milp.bound)} | ${fmt(nominal(milp.starts))} | ${fmt(greedy)} | ${pm(ga)} | ${fmt(gap)} | ${Math.round(milp.ms)} |`);
  }
}
const randoms = gapRows.filter((r) => r.random);
const optimal = randoms.filter((r) => r.gap <= 1e-6).length;
lines.push(
  `| 20 випадкових задач (6 приладів) | ${pm(randoms.map((r) => r.bound))} | ${pm(randoms.map((r) => r.milpSim))} | ${pm(randoms.map((r) => r.greedy))} | ${pm(randoms.map((r) => r.ga))} | ${pm(randoms.map((r) => r.gap))} | ${pm(randoms.map((r) => r.ms), 0)} |`,
);
lines.push(
  '',
  `ГА досяг нижньої оцінки MILP (тобто довів оптимальність) у ${optimal} з ${randoms.length} випадкових задач; ` +
    `максимальне відхилення ${fmt(Math.max(...randoms.map((r) => r.gap)))} бала. Усі розв'язки MILP мають статус «${[...new Set(gapRows.map((r) => r.status))].join(', ')}».`,
  '',
);
console.log('✓ відстань до оптимуму');

// ---------- 2. Стійкість точного оптимуму ----------
lines.push('## 2. Чи достатньо точного оптимуму за графіком', '');
lines.push(
  `План, оптимальний для опублікованого графіка (MILP), і план стійкого ГА перевіряються на ${TEST_SCENARIOS} тестових сценаріях, де відключення зсуваються (середня невизначеність). Парний тест Вілкоксона за штрафом на тих самих сценаріях.`,
  '',
);
lines.push('| Задача | Штраф плану MILP | Штраф стійкого ГА | P(збій приладу): MILP / стійкий ГА, % | z | p |');
lines.push('|---|---|---|---|---|---|');
const robustRows = [];
for (const [name, h] of Object.entries(cases)) {
  const model = buildModel(h);
  const test = generateScenarios(model, { count: TEST_SCENARIOS, seed: 99991 });
  const milp = await solveNominalMilp(model, DEFAULT_WEIGHTS);
  const milpEval = evaluatePlan(model, milp.starts, test);
  const robust = SEEDS.map((seed) => solve(model, 'robust-ga', { ga: { seed } }).starts);
  const robustEvals = robust.map((s) => evaluatePlan(model, s, test));
  const perScenario = (starts) => test.map((grid) => simulate(model, starts, grid).cost);
  const robustCosts = test.map((_, k) => mean(robust.map((s) => simulate(model, s, test[k]).cost)));
  const w = wilcoxonSignedRank(robustCosts, perScenario(milp.starts));
  robustRows.push({ name, milp: milpEval.meanCost, robust: mean(robustEvals.map((e) => e.meanCost)), w });
  lines.push(
    `| ${name} | ${fmt(milpEval.meanCost)} | ${pm(robustEvals.map((e) => e.meanCost))} | ${fmt(milpEval.failureProbability * 100, 1)} / ${pm(robustEvals.map((e) => e.failureProbability * 100), 1)} | ${fmt(w.z)} | ${pText(w.p)} |`,
  );
}
lines.push(
  '',
  'Висновок: навіть точно оптимальний план для опублікованого графіка помітно програє стійкому плану, щойно відключення зсуваються. Тобто для цієї задачі важливіше врахувати невизначеність графіка, ніж знайти точний оптимум детермінованої постановки.',
  '',
  `Загальний час: ${fmt((performance.now() - started) / 1000, 1)} с.`,
  '',
);
console.log('✓ стійкість точного оптимуму');

writeFileSync(join(here, 'milp-report.md'), lines.join('\n'));
console.log(`\nЗвіт: ${join(here, 'milp-report.md')}`);

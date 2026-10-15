// Статистичний експеримент для розділу «Експериментальні дослідження».
// Частина 1: порівняння методів на 4 задачах × 3 рівні невизначеності, ГА запускається з 10 зернами,
//   оцінка на 500 тестових сценаріях; для кожної пари «стійкий ГА проти іншого методу» — парний тест Вілкоксона
//   за штрафом на однакових сценаріях.
// Частина 2: малі задачі, для яких точний оптимум можна знайти перебором; вимірюється відхилення ГА від оптимуму.
// Запуск: npm run experiment:stats (з кореня). Таблиці — у core/experiments/statistical-report.md, сирі дані — у results/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildModel,
  solve,
  simulate,
  generateScenarios,
  evaluatePlan,
  robustCost,
  geneticPlan,
  exhaustivePlan,
  naivePlan,
  greedyPlan,
  createRng,
  slotToTime,
  mean,
  ci95,
  wilcoxonSignedRank,
  ALGORITHMS,
  DEFAULT_WEIGHTS,
  DEFAULT_RISK,
} from '../src/index.js';
import { demoHousehold } from '../examples/demo-household.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const TEST_SCENARIOS = 500;
const TEST_SEED = 99991;
const TRAINING_SCENARIOS = 60;
const SMALL_INSTANCES = 20;

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
  низька: { shiftSdMin: 15, maxShiftMin: 45, cancelProb: 0.02, extraProb: 0.05 },
  середня: {},
  висока: { shiftSdMin: 60, maxShiftMin: 120, cancelProb: 0.1, extraProb: 0.2 },
};

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pm = (xs, d = 2) => (xs.length > 1 ? `${fmt(mean(xs), d)} ± ${fmt(ci95(xs), d)}` : fmt(xs[0], d));
const pct = (xs) => pm(xs.map((x) => x * 100), 1);
const pText = (p) => (p < 0.001 ? '< 0.001' : p.toFixed(3));

// ---------- Частина 1 ----------
const runs = [];
const significance = [];
const started = performance.now();
for (const [caseName, household] of Object.entries(cases)) {
  const model = buildModel(household);
  for (const [levelName, uncertainty] of Object.entries(uncertaintyLevels)) {
    const test = generateScenarios(model, { count: TEST_SCENARIOS, seed: TEST_SEED, ...uncertainty });
    const perScenario = {};
    for (const algorithm of Object.keys(ALGORITHMS)) {
      const stochastic = algorithm === 'ga' || algorithm === 'robust-ga';
      const costsBySeed = [];
      for (const seed of stochastic ? SEEDS : [null]) {
        const t0 = performance.now();
        const { starts } = solve(model, algorithm, { uncertainty, ga: seed === null ? {} : { seed } });
        const ms = performance.now() - t0;
        const costs = test.map((grid) => simulate(model, starts, grid).cost);
        costsBySeed.push(costs);
        runs.push({ case: caseName, uncertainty: levelName, algorithm, seed, ms, plan: starts.join(','), ...evaluatePlan(model, starts, test) });
      }
      // Для стохастичних методів штраф на сценарії усереднюється за зернами.
      perScenario[algorithm] = test.map((_, k) => mean(costsBySeed.map((c) => c[k])));
    }
    for (const other of Object.keys(ALGORITHMS).filter((a) => a !== 'robust-ga')) {
      const w = wilcoxonSignedRank(perScenario['robust-ga'], perScenario[other]);
      significance.push({
        case: caseName,
        uncertainty: levelName,
        versus: other,
        meanRobust: mean(perScenario['robust-ga']),
        meanOther: mean(perScenario[other]),
        better: perScenario['robust-ga'].filter((c, k) => c < perScenario[other][k] - 1e-9).length,
        worse: perScenario['robust-ga'].filter((c, k) => c > perScenario[other][k] + 1e-9).length,
        ...w,
      });
    }
    console.log(`✓ ${caseName}, невизначеність ${levelName}`);
  }
}

const summary = [];
for (const caseName of Object.keys(cases)) {
  for (const levelName of Object.keys(uncertaintyLevels)) {
    for (const algorithm of Object.keys(ALGORITHMS)) {
      const list = runs.filter((r) => r.case === caseName && r.uncertainty === levelName && r.algorithm === algorithm);
      summary.push({
        case: caseName,
        uncertainty: levelName,
        algorithm,
        runs: list.length,
        meanCost: list.map((r) => r.meanCost),
        cvarCost: list.map((r) => r.cvarCost),
        failureProbability: list.map((r) => r.failureProbability),
        shedProbability: list.map((r) => r.shedProbability),
        ms: list.map((r) => r.ms),
        distinctPlans: new Set(list.map((r) => r.plan)).size,
      });
    }
  }
}

// ---------- Частина 2 ----------
// Мала випадкова задача: 3 прилади з вікнами 2–4 год, 1–2 відключення, станція у половині задач.
function smallInstance(seed) {
  const rng = createRng(seed);
  const time = (slot) => slotToTime(slot);
  const outages = [];
  const count = rng.int(1, 2);
  for (let i = 0; i < count; i++) {
    const from = rng.int(24, 72);
    outages.push({ from: time(from), to: time(from + rng.int(8, 16)) });
  }
  const names = ['Пральна машина', 'Бойлер', 'Посудомийка'];
  const powers = [500, 2000, 1200];
  const appliances = names.map((name, i) => {
    const earliest = rng.int(24, 64);
    const window = rng.int(8, 16);
    const duration = [6, 4, 8][i];
    return {
      name,
      powerW: powers[i],
      durationMin: duration * 15,
      earliest: time(earliest),
      latest: time(earliest + window + duration),
      preferredStart: time(earliest + rng.int(0, window)),
      priority: rng.int(2, 4),
      allowOnBattery: powers[i] <= 1200,
    };
  });
  return {
    grid: { maxPowerW: 3000 },
    battery: rng.chance(0.5) ? { capacityWh: 1024, initialSocPct: 60, minSocPct: 10, targetEndSocPct: 50, maxChargeW: 600, inverterMaxW: 1800 } : null,
    outages,
    baseLoads: [{ name: 'Холодильник', powerW: 60, priority: 5 }],
    appliances,
  };
}

const optimality = [];
for (let i = 1; i <= SMALL_INSTANCES; i++) {
  const model = buildModel(smallInstance(1000 + i));
  const training = generateScenarios(model, { count: TRAINING_SCENARIOS, seed: 1001 });
  const objectives = {
    nominal: (s) => simulate(model, s, model.plannedGrid, DEFAULT_WEIGHTS).cost,
    robust: (s) => robustCost(model, s, training, DEFAULT_WEIGHTS, DEFAULT_RISK),
  };
  for (const [kind, fitness] of Object.entries(objectives)) {
    const t0 = performance.now();
    const exact = exhaustivePlan(model, fitness);
    const exactMs = performance.now() - t0;
    const initial = [naivePlan(model), greedyPlan(model)];
    const ga = SEEDS.map((seed) => {
      const t1 = performance.now();
      const r = geneticPlan(model, fitness, { seed, initial });
      return { cost: r.cost, evaluations: r.evaluations, ms: performance.now() - t1 };
    });
    optimality.push({
      instance: i,
      objective: kind,
      combinations: exact.evaluations,
      optimum: exact.cost,
      exactMs,
      gaCosts: ga.map((g) => g.cost),
      gaEvaluations: ga.map((g) => g.evaluations),
      gaMs: ga.map((g) => g.ms),
      greedyCost: fitness(greedyPlan(model)),
    });
  }
}
console.log(`✓ Малі задачі з точним оптимумом: ${SMALL_INSTANCES}`);

// ---------- Звіт ----------
const algoName = (a) => ALGORITHMS[a];
const lines = [];
lines.push('# Статистичний експеримент', '');
lines.push(
  `Згенеровано скриптом \`core/experiments/statistical.js\`. ГА запускався з ${SEEDS.length} зернами, оцінка на ${TEST_SCENARIOS} тестових сценаріях (зерно ${TEST_SEED}), стійкий ГА навчався на ${TRAINING_SCENARIOS} інших сценаріях.`,
  'Значення подано як середнє ± напівширина 95% довірчого інтервалу за зернами (для детермінованих методів — одне значення).',
  '',
);

lines.push('## 1. Порівняння методів', '');
for (const caseName of Object.keys(cases)) {
  lines.push(`### ${caseName}`, '');
  lines.push('| Невизначеність | Метод | Середній штраф | CVaR₉₀ | P(збій приладу), % | P(вимкнення постійних), % | Час, мс |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of summary.filter((x) => x.case === caseName)) {
    lines.push(
      `| ${s.uncertainty} | ${algoName(s.algorithm)} | ${pm(s.meanCost)} | ${pm(s.cvarCost)} | ${pct(s.failureProbability)} | ${pct(s.shedProbability)} | ${pm(s.ms, 0)} |`,
    );
  }
  lines.push('');
}

const stability = summary.filter((s) => s.runs > 1);
const stable = stability.filter((s) => s.distinctPlans === 1).length;
lines.push('### Стабільність ГА', '');
lines.push(
  `У ${stable} з ${stability.length} конфігурацій (задача × невизначеність × варіант ГА) усі ${SEEDS.length} запусків з різними зернами зійшлися до одного й того самого плану, тому довірчі інтервали штрафу нульові; відрізняється лише час роботи і кількість обчислень цільової функції.`,
);
const unstable = stability.filter((s) => s.distinctPlans > 1);
if (unstable.length) {
  lines.push('', 'Конфігурації, де запуски дали різні плани:', '');
  for (const s of unstable) lines.push(`- ${s.case}, невизначеність ${s.uncertainty}, ${algoName(s.algorithm)}: ${s.distinctPlans} різних планів`);
}
lines.push(
  '',
  `ГА за графіком дає той самий результат, що й жадібний алгоритм: жадібний план входить у початкову популяцію і для опублікованого графіка зазвичай уже оптимальний (на малих задачах розділу 3 — у ${optimality.filter((o) => o.objective === 'nominal' && o.greedyCost <= o.optimum + 1e-9).length} з ${SMALL_INSTANCES} випадків), тож без урахування невизначеності ГА не має чого покращувати.`,
  '',
);

lines.push('## 2. Значущість переваги стійкого ГА', '');
lines.push(
  'Парний знаково-ранговий тест Вілкоксона за штрафом на тих самих тестових сценаріях (H₀: розподіл різниць симетричний відносно нуля). «Краще/гірше» — кількість сценаріїв, де стійкий ГА має менший/більший штраф. r — розмір ефекту (0.1 малий, 0.3 середній, 0.5 великий).',
  '',
);
lines.push('| Задача | Невизначеність | Проти методу | Штраф стійкого ГА | Штраф іншого | Краще / гірше | z | p | r |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const s of significance) {
  lines.push(
    `| ${s.case} | ${s.uncertainty} | ${algoName(s.versus)} | ${fmt(s.meanRobust)} | ${fmt(s.meanOther)} | ${s.better} / ${s.worse} | ${fmt(s.z)} | ${pText(s.p)} | ${fmt(s.r)} |`,
  );
}
lines.push('');

lines.push('## 3. Відхилення ГА від точного оптимуму на малих задачах', '');
lines.push(
  `${SMALL_INSTANCES} випадкових задач із 3 приладами (вікна 2–4 год), оптимум знайдено повним перебором. Для кожної задачі ГА запускався з ${SEEDS.length} зернами.`,
  '',
);
for (const kind of ['nominal', 'robust']) {
  const rows = optimality.filter((o) => o.objective === kind);
  const all = rows.flatMap((o) => o.gaCosts.map((c) => ({ c, o })));
  const hits = all.filter(({ c, o }) => c <= o.optimum + 1e-9).length;
  const absGap = all.map(({ c, o }) => c - o.optimum);
  const relGap = all.filter(({ o }) => o.optimum > 1e-9).map(({ c, o }) => (c - o.optimum) / o.optimum);
  const greedyHits = rows.filter((o) => o.greedyCost <= o.optimum + 1e-9).length;
  const evalShare = rows.flatMap((o) => o.gaEvaluations.map((e) => e / o.combinations));
  lines.push(`### Критерій: ${kind === 'nominal' ? 'штраф за опублікованим графіком (ГА)' : 'стійкий критерій (стійкий ГА)'}`, '');
  lines.push('| Показник | Значення |', '|---|---|');
  lines.push(`| Запусків ГА, що знайшли оптимум | ${hits} з ${all.length} (${fmt((hits / all.length) * 100, 1)}%) |`);
  lines.push(`| Середнє абсолютне відхилення від оптимуму | ${pm(absGap, 3)} |`);
  lines.push(`| Найбільше абсолютне відхилення | ${fmt(Math.max(...absGap), 3)} |`);
  if (relGap.length) lines.push(`| Середнє відносне відхилення (задачі з ненульовим оптимумом) | ${pm(relGap.map((g) => g * 100), 2)}% |`);
  lines.push(`| Жадібний алгоритм знайшов оптимум | ${greedyHits} з ${rows.length} задач |`);
  lines.push(`| Комбінацій у переборі (медіана) | ${rows.map((o) => o.combinations).sort((a, b) => a - b)[rows.length >> 1]} |`);
  lines.push(`| Частка простору, яку переглянув ГА, % | ${pct(evalShare)} |`);
  lines.push(`| Час перебору / ГА, мс | ${pm(rows.map((o) => o.exactMs), 0)} / ${pm(rows.flatMap((o) => o.gaMs), 0)} |`);
  lines.push('');
}
lines.push(`Загальний час експерименту: ${fmt((performance.now() - started) / 1000, 1)} с.`, '');

writeFileSync(join(here, 'statistical-report.md'), lines.join('\n'));
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'statistical-runs.json'), JSON.stringify({ runs, significance, optimality }, null, 1));
console.log(`\nЗвіт: ${join(here, 'statistical-report.md')}`);

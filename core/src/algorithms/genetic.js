import { createRng } from '../random.js';
import { SKIP } from '../simulate.js';

export const DEFAULT_GA = {
  populationSize: 40,
  generations: 120,
  patience: 30, // зупинка, якщо стільки поколінь поспіль немає покращення
  tournamentSize: 3,
  crossoverRate: 0.9,
  mutationRate: null, // ймовірність мутації гена; null означає 1/n
  skipRate: 0.05, // частка генів «не запускати» у випадковій початковій популяції
  elitism: 2,
  seed: 42,
};

// Генетичний алгоритм пошуку часу запуску приладів.
// Хромосома — масив стартових слотів (або -1). fitness(starts) повертає штраф, який мінімізується.
export function geneticPlan(model, fitness, options = {}) {
  const p = { ...DEFAULT_GA, ...options };
  const rng = createRng(p.seed);
  const genes = model.appliances;
  const n = genes.length;
  if (n === 0) return { starts: [], cost: fitness([]), history: [], evaluations: 1 };
  const mutationRate = p.mutationRate ?? 1 / n;

  const cache = new Map();
  let evaluations = 0;
  const evaluate = (starts) => {
    const key = starts.join(',');
    let value = cache.get(key);
    if (value === undefined) {
      value = fitness(starts);
      cache.set(key, value);
      evaluations++;
    }
    return value;
  };

  const randomGene = (i) =>
    rng.chance(p.skipRate) ? SKIP : rng.int(genes[i].earliest, genes[i].latestStart);

  const mutateGene = (i, value) => {
    const a = genes[i];
    const r = rng.next();
    if (r < 0.5 && value !== SKIP) {
      const delta = rng.int(1, 4) * (rng.chance(0.5) ? 1 : -1);
      return Math.min(a.latestStart, Math.max(a.earliest, value + delta));
    }
    if (r < 0.9) return rng.int(a.earliest, a.latestStart);
    return value === SKIP ? rng.int(a.earliest, a.latestStart) : SKIP;
  };

  let population = (p.initial ?? []).map((c) => [...c]);
  while (population.length < p.populationSize) population.push(genes.map((_, i) => randomGene(i)));
  population = population.slice(0, p.populationSize);

  let scored = population.map((c) => ({ c, f: evaluate(c) })).sort((x, y) => x.f - y.f);
  const history = [scored[0].f];
  let stale = 0;

  const tournament = () => {
    let best = null;
    for (let k = 0; k < p.tournamentSize; k++) {
      const cand = scored[rng.int(0, scored.length - 1)];
      if (!best || cand.f < best.f) best = cand;
    }
    return best.c;
  };

  for (let g = 0; g < p.generations && stale < p.patience; g++) {
    const next = scored.slice(0, p.elitism).map((s) => s.c);
    while (next.length < p.populationSize) {
      const a = tournament();
      const b = tournament();
      let child;
      if (rng.chance(p.crossoverRate)) child = a.map((v, i) => (rng.chance(0.5) ? v : b[i]));
      else child = [...a];
      for (let i = 0; i < n; i++) if (rng.chance(mutationRate)) child[i] = mutateGene(i, child[i]);
      next.push(child);
    }
    scored = next.map((c) => ({ c, f: evaluate(c) })).sort((x, y) => x.f - y.f);
    if (scored[0].f < history[history.length - 1] - 1e-9) stale = 0;
    else stale++;
    history.push(scored[0].f);
  }

  return { starts: scored[0].c, cost: scored[0].f, history, evaluations };
}

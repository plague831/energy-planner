import { simulate, DEFAULT_WEIGHTS } from './simulate.js';

// Параметри критерію стійкості: середнє значення штрафу плюс λ·CVaR_α (середнє серед найгірших (1−α) сценаріїв).
export const DEFAULT_RISK = { lambda: 0.5, alpha: 0.9 };

export function cvar(sortedAsc, alpha) {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const tail = Math.max(1, Math.ceil(n * (1 - alpha)));
  let sum = 0;
  for (let i = n - tail; i < n; i++) sum += sortedAsc[i];
  return sum / tail;
}

// Значення критерію стійкості плану на множині сценаріїв.
export function robustCost(model, starts, scenarios, weights = DEFAULT_WEIGHTS, risk = DEFAULT_RISK) {
  const costs = new Float64Array(scenarios.length);
  let sum = 0;
  for (let k = 0; k < scenarios.length; k++) {
    const c = simulate(model, starts, scenarios[k], weights).cost;
    costs[k] = c;
    sum += c;
  }
  costs.sort();
  const mean = sum / scenarios.length;
  return mean + risk.lambda * cvar(costs, risk.alpha);
}

// Детальна оцінка плану на сценаріях (для звітів і порівняння методів).
export function evaluatePlan(model, starts, scenarios, weights = DEFAULT_WEIGHTS, risk = DEFAULT_RISK) {
  const costs = [];
  let anyFailure = 0;
  let anyShed = 0;
  let failedAppliances = 0;
  let shedHours = 0;
  let minSoc = Infinity;
  for (const grid of scenarios) {
    const m = simulate(model, starts, grid, weights);
    costs.push(m.cost);
    if (m.failedIds.length > 0) anyFailure++;
    if (m.shedBasePoints > 0) anyShed++;
    failedAppliances += m.failedIds.length;
    shedHours += m.shedBasePoints;
    if (m.minSocPct !== null && m.minSocPct < minSoc) minSoc = m.minSocPct;
  }
  const sorted = [...costs].sort((a, b) => a - b);
  const n = costs.length;
  const mean = costs.reduce((s, c) => s + c, 0) / n;
  return {
    scenarios: n,
    meanCost: mean,
    medianCost: sorted[Math.floor(n / 2)],
    p90Cost: sorted[Math.min(n - 1, Math.floor(n * 0.9))],
    cvarCost: cvar(sorted, risk.alpha),
    worstCost: sorted[n - 1],
    robustCost: mean + risk.lambda * cvar(sorted, risk.alpha),
    failureProbability: anyFailure / n,
    shedProbability: anyShed / n,
    avgFailedAppliances: failedAppliances / n,
    avgShedPoints: shedHours / n,
    worstMinSocPct: Number.isFinite(minSoc) ? minSoc : null,
  };
}

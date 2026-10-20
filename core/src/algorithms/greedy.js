import { simulate, DEFAULT_WEIGHTS, SKIP } from '../simulate.js';
import { withGeneratorGenes } from '../model.js';

// Жадібний алгоритм: прилади розставляються по черзі (спочатку важливіші й потужніші),
// кожному обирається час запуску, що найменше збільшує штраф за запланованим графіком.
export function greedyPlan(model, { weights = DEFAULT_WEIGHTS, grid = model.plannedGrid } = {}) {
  const n = model.appliances.length;
  // Генератором жадібний алгоритм не керує: він працює за типовим правилом (поріг 30%).
  const starts = withGeneratorGenes(model, new Array(n).fill(SKIP));
  const order = model.appliances
    .map((a, i) => i)
    .sort((i, j) => {
      const a = model.appliances[i];
      const b = model.appliances[j];
      return b.priority - a.priority || b.powerW * b.duration - a.powerW * a.duration;
    });

  for (const i of order) {
    const a = model.appliances[i];
    let bestStart = SKIP;
    let bestCost = simulate(model, starts, grid, weights).cost;
    for (let s = a.earliest; s <= a.latestStart; s++) {
      starts[i] = s;
      const c = simulate(model, starts, grid, weights).cost;
      if (c < bestCost - 1e-9) {
        bestCost = c;
        bestStart = s;
      }
    }
    starts[i] = bestStart;
  }
  return starts;
}

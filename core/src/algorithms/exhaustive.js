import { SKIP } from '../simulate.js';

// Точний розв'язок повним перебором усіх комбінацій часу запуску (включно з «не запускати»).
// Придатний лише для малих задач: кількість комбінацій — добуток (latestStart − earliest + 2) по приладах.
// Використовується в експерименті, щоб виміряти, наскільки ГА наближається до оптимуму.
export function exhaustivePlan(model, fitness, { maxCombinations = 2_000_000 } = {}) {
  const domains = model.appliances.map((a) => {
    const values = [SKIP];
    for (let s = a.earliest; s <= a.latestStart; s++) values.push(s);
    return values;
  });
  const combinations = domains.reduce((p, d) => p * d.length, 1);
  if (combinations > maxCombinations) {
    throw new Error(`Забагато комбінацій для перебору: ${combinations} > ${maxCombinations}`);
  }

  const n = domains.length;
  const index = new Array(n).fill(0);
  const starts = domains.map((d) => d[0]);
  let best = { starts: [...starts], cost: fitness(starts) };
  for (let k = 1; k < combinations; k++) {
    // Наступна комбінація як у лічильнику з різними основами.
    for (let i = 0; i < n; i++) {
      index[i]++;
      if (index[i] < domains[i].length) {
        starts[i] = domains[i][index[i]];
        break;
      }
      index[i] = 0;
      starts[i] = domains[i][0];
    }
    const cost = fitness(starts);
    if (cost < best.cost) best = { starts: [...starts], cost };
  }
  return { ...best, evaluations: combinations };
}

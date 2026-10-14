import { SLOT_MINUTES } from './time.js';
import { createRng } from './random.js';

// Параметри невизначеності графіка за замовчуванням.
export const DEFAULT_UNCERTAINTY = {
  shiftSdMin: 30, // стандартне відхилення зсуву початку і кінця відключення, хв
  maxShiftMin: 90, // максимальний зсув, хв
  cancelProb: 0.05, // ймовірність, що заплановане відключення не відбудеться
  extraProb: 0.1, // ймовірність додаткового позапланового відключення за добу
  extraMinMin: 60,
  extraMaxMin: 180,
};

// Генерує count сценаріїв фактичної наявності світла (маски слотів) навколо запланованого графіка.
export function generateScenarios(model, { count = 100, seed = 1, ...params } = {}) {
  const u = { ...DEFAULT_UNCERTAINTY, ...params };
  const rng = createRng(seed);
  const { T } = model;
  const sd = u.shiftSdMin / SLOT_MINUTES;
  const maxShift = Math.round(u.maxShiftMin / SLOT_MINUTES);
  const shift = () => clamp(Math.round(rng.normal(0, sd)), -maxShift, maxShift);

  const scenarios = [];
  for (let k = 0; k < count; k++) {
    const grid = new Uint8Array(T).fill(1);
    for (const o of model.outages) {
      if (rng.chance(u.cancelProb)) continue;
      const length = (o.to - o.from + T) % T || T;
      const startShift = shift();
      const endShift = shift();
      const from = (((o.from + startShift) % T) + T) % T;
      const newLength = Math.max(1, length + endShift - startShift);
      cut(grid, from, newLength);
    }
    if (rng.chance(u.extraProb)) {
      const length = rng.int(Math.round(u.extraMinMin / SLOT_MINUTES), Math.round(u.extraMaxMin / SLOT_MINUTES));
      cut(grid, rng.int(0, T - 1), length);
    }
    scenarios.push(grid);
  }
  return scenarios;
}

function cut(grid, from, length) {
  const T = grid.length;
  for (let j = 0; j < Math.min(length, T); j++) grid[(from + j) % T] = 0;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

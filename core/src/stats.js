// Статистика для експериментів: описові характеристики, довірчі інтервали і парний тест Вілкоксона.

export function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

// Вибіркове стандартне відхилення (з поправкою Бесселя).
export function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

// Двосторонні критичні значення t-розподілу для 95% довірчого інтервалу за кількістю ступенів свободи.
const T95 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

// Напівширина 95% довірчого інтервалу для середнього.
export function ci95(xs) {
  const n = xs.length;
  if (n < 2) return 0;
  const t = n - 1 < T95.length ? T95[n - 1] : 1.96;
  return (t * sd(xs)) / Math.sqrt(n);
}

// Функція розподілу стандартного нормального закону (наближення Абрамовіца–Стіган для erf, похибка < 1.5e-7).
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Парний знаково-ранговий тест Вілкоксона для вибірок a і b однакової довжини (нормальне наближення
// з поправкою на зв'язки і на неперервність). Нульові різниці відкидаються.
// Повертає медіану різниць a − b, статистику z, двосторонній p і розмір ефекту r = |z| / √n.
export function wilcoxonSignedRank(a, b) {
  if (a.length !== b.length) throw new Error('Вибірки мають бути однакової довжини');
  const diffs = a.map((x, i) => x - b[i]);
  const nonZero = diffs.filter((d) => Math.abs(d) > 1e-12);
  const n = nonZero.length;
  const sorted = [...diffs].sort((x, y) => x - y);
  const medianDiff = sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : 0;
  if (n === 0) return { n: 0, medianDiff, wPlus: 0, z: 0, p: 1, r: 0 };

  // Ранги модулів різниць; однаковим модулям — середній ранг.
  const order = nonZero.map((d, i) => ({ abs: Math.abs(d), sign: Math.sign(d), i })).sort((x, y) => x.abs - y.abs);
  const ranks = new Float64Array(n);
  let tieCorrection = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && Math.abs(order[j + 1].abs - order[i].abs) < 1e-12) j++;
    const rank = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    const t = j - i + 1;
    tieCorrection += t ** 3 - t;
    i = j + 1;
  }
  let wPlus = 0;
  for (let k = 0; k < n; k++) if (order[k].sign > 0) wPlus += ranks[k];

  const expected = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection / 48;
  if (variance <= 0) return { n, medianDiff, wPlus, z: 0, p: 1, r: 0 };
  const diff = wPlus - expected;
  const z = (diff - Math.sign(diff) * 0.5) / Math.sqrt(variance);
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  return { n, medianDiff, wPlus, z, p, r: Math.abs(z) / Math.sqrt(n) };
}

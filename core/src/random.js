// Відтворюваний генератор псевдовипадкових чисел (mulberry32), щоб експерименти давали однаковий результат.
export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    // Нормальний розподіл (метод Бокса-Мюллера).
    normal(mean = 0, sd = 1) {
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance(p) {
      return next() < p;
    },
  };
}

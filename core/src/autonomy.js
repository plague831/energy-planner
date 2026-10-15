// Швидка оцінка автономності: на скільки годин вистачить кожного джерела живлення
// для вибраного набору споживачів і чи витягне джерело їх сумарну потужність.
// Це довідковий розрахунок «на зараз» без розкладу в часі, на відміну від планувальника.

// ККД інвертора зарядної станції під час розряду.
export const INVERTER_EFFICIENCY = 0.9;
// Частка номінальної потужності сонячних панелей, яка доходить до споживачів (втрати на нагрів, кут, контролер).
export const SOLAR_DERATE = 0.75;
// Витрата пального генератора наближено лінійна від навантаження x (частка від номіналу):
// q(x) = q_ном · (FUEL_IDLE + (1 − FUEL_IDLE) · x). На холостому ходу генератор їсть приблизно чверть номінальної витрати.
export const FUEL_IDLE = 0.25;
// Рекомендоване тривале навантаження генератора і станції, щоб не працювати на межі.
export const SAFE_LOAD = 0.8;

const fuelRate = (x) => FUEL_IDLE + (1 - FUEL_IDLE) * x;

// Зарядна станція: запас енергії між поточним зарядом і мінімально допустимим, обмеження — потужність інвертора.
export function batterySource({ capacityWh, socPct, minSocPct = 10, inverterMaxW, name = 'Зарядна станція' }) {
  const usableWh = Math.max(0, (capacityWh * (socPct - minSocPct)) / 100) * INVERTER_EFFICIENCY;
  return {
    kind: 'battery',
    name,
    maxW: inverterMaxW,
    energyWh: usableWh,
    hoursAt: (loadW) => (loadW > 0 ? usableWh / loadW : Infinity),
  };
}

// Генератор: виробник зазвичай вказує, скільки годин працює повний бак при 50% навантаження.
// Час роботи при навантаженні x: t(x) = t_50 · (частка пального в баку) · q(0.5) / q(x).
export function generatorSource({ ratedW, tankHoursAtHalf, fuelPct = 100, name = 'Генератор' }) {
  const fuel = Math.max(0, Math.min(100, fuelPct)) / 100;
  return {
    kind: 'generator',
    name,
    maxW: ratedW,
    energyWh: null,
    hoursAt: (loadW) => {
      const x = Math.min(1, Math.max(0, loadW / ratedW));
      return (tankHoursAtHalf * fuel * fuelRate(0.5)) / fuelRate(x);
    },
  };
}

// Сонячні панелі: енергія за день ≈ пікова потужність × кількість «пікових сонячних годин» × коефіцієнт втрат.
// Без станції панелі живлять прилади тільки вдень, тому час роботи тут — це скільки годин такого навантаження покриє денна енергія.
export function solarSource({ peakW, sunHours, name = 'Сонячні панелі' }) {
  const energyWh = peakW * sunHours * SOLAR_DERATE;
  return {
    kind: 'solar',
    name,
    maxW: peakW * SOLAR_DERATE,
    energyWh,
    hoursAt: (loadW) => (loadW > 0 ? energyWh / loadW : Infinity),
  };
}

// consumers: [{ name, powerW, priority }] — те, що людина хоче живити одночасно.
// Для кожного джерела повертає навантаження у %, час роботи і, якщо потужності не вистачає,
// які споживачі вимкнути (від найменш важливих), щоб джерело витягнуло решту.
export function estimateAutonomy(sources, consumers) {
  const loads = consumers.filter((c) => Number(c.powerW) > 0);
  const totalW = sum(loads);
  return {
    totalW,
    sources: sources.map((source) => {
      const result = evaluate(source, loads);
      if (!result.overloaded) return { ...result, keep: loads, drop: [], fitted: null };

      // Вимикаємо найменш пріоритетні, а серед рівних — найпотужніші, поки решта не вміститься.
      const order = [...loads].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3) || b.powerW - a.powerW);
      const drop = [];
      let keep = loads;
      for (const c of order) {
        if (sum(keep) <= source.maxW) break;
        drop.push(c);
        keep = keep.filter((k) => k !== c);
      }
      // Повертаємо вимкнені раніше дрібні споживачі, якщо вони вміщуються після вимкнення потужного (від найважливіших).
      for (const c of [...drop].reverse()) {
        if (sum(keep) + Number(c.powerW) <= source.maxW) {
          keep = loads.filter((k) => k === c || keep.includes(k));
          drop.splice(drop.indexOf(c), 1);
        }
      }
      return { ...result, keep, drop, fitted: keep.length ? evaluate(source, keep) : null };
    }),
  };
}

function evaluate(source, loads) {
  const loadW = sum(loads);
  const loadPct = source.maxW > 0 ? (loadW / source.maxW) * 100 : Infinity;
  return {
    kind: source.kind,
    name: source.name,
    maxW: source.maxW,
    energyWh: source.energyWh,
    loadW,
    loadPct,
    hours: source.hoursAt(loadW),
    overloaded: loadW > source.maxW,
    heavy: loadW > source.maxW * SAFE_LOAD && loadW <= source.maxW,
  };
}

function sum(loads) {
  return loads.reduce((s, c) => s + Number(c.powerW), 0);
}

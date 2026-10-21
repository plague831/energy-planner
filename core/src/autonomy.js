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

// Сонячна потужність о певній хвилині доби: синусоїда між сходом і заходом сонця,
// площа під якою дорівнює денній енергії peakW · sunHours · SOLAR_DERATE (як у моделі планувальника).
export function solarPowerAt(panel, minuteOfDay, defaults = {}) {
  const hours = (t) => (typeof t === 'string' ? Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60 : t);
  // Схід і захід сонця з прогнозу погоди (якщо є), інакше 07:00–18:00.
  const sunrise = hours(panel.sunrise ?? defaults.sunrise ?? 7);
  const sunset = hours(panel.sunset ?? defaults.sunset ?? 18);
  const h = minuteOfDay / 60;
  if (h <= sunrise || h >= sunset) return 0;
  const energyWh = Number(panel.peakW) * Number(panel.sunHours) * SOLAR_DERATE;
  const amplitude = (energyWh * Math.PI) / (2 * (sunset - sunrise));
  return Math.min(Number(panel.peakW) * SOLAR_DERATE, amplitude * Math.sin((Math.PI * (h - sunrise)) / (sunset - sunrise)));
}

// «Що буде, якщо світло зникне зараз»: покрокова (по 15 хв) імітація роботи резервних джерел
// на постійне навантаження loadW. Порядок: спершу сонце, потім станції (разом, у межах інвертора),
// потім генератори по черзі; надлишок сонця підзаряджає станції. Повертає кроки, години й фази.
export function simulateBackup({ batteries = [], generators = [], solar = [], loadW, startMinute = 0, maxHours = 48, stepMin = 15 }) {
  const stepH = stepMin / 60;
  const capacityWh = batteries.reduce((s, b) => s + Number(b.capacityWh || 0), 0);
  const usableMaxWh = batteries.reduce((s, b) => s + (Number(b.capacityWh) * (100 - Number(b.minSocPct ?? 10))) / 100, 0) * INVERTER_EFFICIENCY;
  let usableWh = batteries.reduce((s, b) => s + Math.max(0, (Number(b.capacityWh) * (Number(b.socPct ?? 100) - Number(b.minSocPct ?? 10))) / 100), 0) * INVERTER_EFFICIENCY;
  const minWh = batteries.reduce((s, b) => s + (Number(b.capacityWh) * Number(b.minSocPct ?? 10)) / 100, 0);
  const inverterW = batteries.reduce((s, b) => s + Number(b.inverterMaxW || 0), 0);
  const fuel = generators.map((g) => Math.max(0, Math.min(100, Number(g.fuelPct ?? 100))) / 100);

  const steps = [];
  for (let k = 0; k < (maxHours * 60) / stepMin; k++) {
    const minute = startMinute + k * stepMin;
    const sun = solar.reduce((s, p) => s + solarPowerAt(p, minute % 1440), 0);
    const fromSolar = Math.min(sun, loadW);
    let rest = loadW - fromSolar;
    const fromBattery = Math.min(rest, inverterW, usableWh / stepH);
    usableWh -= fromBattery * stepH;
    rest -= fromBattery;
    let fromGenerator = 0;
    generators.forEach((g, i) => {
      if (rest <= 0 || fuel[i] <= 0) return;
      const out = Math.min(rest, Number(g.ratedW));
      const used = (stepH / Number(g.tankHoursAtHalf)) * (fuelRate(out / Number(g.ratedW)) / fuelRate(0.5));
      const share = Math.min(1, fuel[i] / used);
      fuel[i] = Math.max(0, fuel[i] - used * share);
      fromGenerator += out * share;
      rest -= out * share;
    });
    // Надлишок сонця заряджає станції.
    usableWh = Math.min(usableMaxWh, usableWh + Math.max(0, sun - fromSolar) * INVERTER_EFFICIENCY * stepH);
    steps.push({
      minute,
      solarW: fromSolar,
      batteryW: fromBattery,
      generatorW: fromGenerator,
      shortageW: Math.max(0, rest),
      socPct: capacityWh ? ((minWh + usableWh / INVERTER_EFFICIENCY) / capacityWh) * 100 : null,
      fuelPct: fuel.map((f) => f * 100),
    });
  }

  // Показуємо до години після того, як вичерпалось останнє джерело (але не менше 6 год).
  const lastServed = steps.reduce((last, s, i) => (s.solarW + s.batteryW + s.generatorW > 1 ? i : last), -1);
  const shown = steps.slice(0, Math.min(steps.length, Math.max((6 * 60) / stepMin, lastServed + 1 + 60 / stepMin)));
  const fullUntil = shown.findIndex((s) => s.shortageW > loadW * 0.01);

  return {
    loadW,
    steps: shown,
    // Скільки годин усе вибране працює без перебоїв (null — увесь показаний період).
    fullHours: fullUntil === -1 ? null : (fullUntil * stepMin) / 60,
    // Через скільки годин не лишиться жодного джерела (null — джерела ще є наприкінці горизонту).
    lastHours: lastServed === steps.length - 1 ? null : ((lastServed + 1) * stepMin) / 60,
    phases: phasesOf(shown, stepMin),
  };
}

// Послідовні відрізки часу, де основну частку навантаження дає одне джерело.
function phasesOf(steps, stepMin) {
  const kindOf = (s) => {
    const parts = { solar: s.solarW, battery: s.batteryW, generator: s.generatorW };
    const [kind, value] = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
    return value > 1 ? kind : 'none';
  };
  const phases = [];
  steps.forEach((s, i) => {
    const kind = kindOf(s);
    const last = phases.at(-1);
    if (last && last.kind === kind) last.toHour = ((i + 1) * stepMin) / 60;
    else phases.push({ kind, fromHour: (i * stepMin) / 60, toHour: ((i + 1) * stepMin) / 60 });
  });
  return phases;
}

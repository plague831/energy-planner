import { SLOTS_PER_DAY, SLOT_HOURS, SLOT_MINUTES, timeToSlot, fillInterval } from './time.js';

import { SKIP } from './simulate.js';

// Крок порогу запуску генератора: ген генератора k означає «вмикати, коли заряд станції впав до 5·k %».
export const GENERATOR_THRESHOLD_STEP = 5;
const GENERATOR_THRESHOLD_GENES = 100 / GENERATOR_THRESHOLD_STEP;

// Перетворює дані домогосподарства з форми (час у форматі "ГГ:ХХ", відсотки, хвилини)
// у внутрішню модель задачі: маски слотів, енергію в Вт·год і номери слотів.
// replan (необов'язково) — перепланування з поточного моменту протягом дня:
//   { nowSlot, fixedStarts: { id приладу: слот, у який він уже ввімкнувся }, socPct, fuelPct: { id генератора: % } }.
// household.nextDay (необов'язково) — дані на завтра { outages, sources }: тоді горизонт планування
// 48 год (сьогодні + завтра), і заряд станції наприкінці сьогодні враховує потреби завтрашнього ранку.
export function buildModel(household, replan = null) {
  if (!household || typeof household !== 'object') throw new Error('Не передано дані домогосподарства');
  const D = household.nextDay ? 2 : 1;
  const DAY = SLOTS_PER_DAY;
  const T = DAY * D;

  const gridMaxW = positive(household.grid?.maxPowerW ?? 5000, 'grid.maxPowerW');

  const plannedGrid = new Uint8Array(T).fill(1);
  const dayOutages = [household.outages ?? [], ...(D === 2 ? [household.nextDay.outages ?? household.outages ?? []] : [])];
  const outages = dayOutages.flatMap((list, d) =>
    list.map((o, i) => {
      const from = timeToSlot(o.from);
      const to = timeToSlot(o.to) % DAY;
      if (from === to) throw new Error(`Відключення №${i + 1} має нульову тривалість`);
      if (D === 1) {
        fillInterval(plannedGrid, from, to, 0);
        return { from, to };
      }
      // На 48 год слоти абсолютні: відключення через північ переходить у наступну добу (обрізається на кінці горизонту).
      const start = from + d * DAY;
      const end = Math.min(T, (to > from ? to : to + DAY) + d * DAY);
      fillInterval(plannedGrid, start, end, 0);
      return { from: start, to: end % T === start ? end - 1 : end };
    }),
  );

  const battery = household.battery ? buildBattery(household.battery) : null;
  const nowSlot = replan ? Math.max(0, Math.min(T - 1, Math.floor(replan.nowSlot ?? 0))) : 0;
  if (battery && replan && Number.isFinite(replan.socPct)) {
    battery.initialWh = Math.max(0, Math.min(battery.capacityWh, (replan.socPct / 100) * battery.capacityWh));
  }

  const sources = Array.isArray(household.sources) ? household.sources : [];
  const generators = sources
    .filter((g) => g.kind === 'generator' && Number(g.ratedW) > 0 && Number(g.tankHoursAtHalf) > 0)
    .map((g, i) => ({
      id: g.id ?? `generator-${i + 1}`,
      name: g.name ?? `Генератор ${i + 1}`,
      ratedW: Number(g.ratedW),
      tankHoursAtHalf: Number(g.tankHoursAtHalf),
      fuel: clamp(Number(replan?.fuelPct?.[g.id ?? `generator-${i + 1}`] ?? g.fuelPct ?? 100), 0, 100) / 100,
    }));
  const solar = concatDays(
    Array.from({ length: D }, (_, d) => buildSolar(((d === 1 && household.nextDay.sources) || sources).filter((p) => p.kind === 'solar'), DAY)),
  );

  const baseLoads = (household.baseLoads ?? []).map((b, i) => {
    const activeMask = new Uint8Array(T);
    const from = b.from ? timeToSlot(b.from) : 0;
    const to = b.to ? timeToSlot(b.to) % DAY : 0;
    for (let d = 0; d < D; d++) {
      const dayMask = activeMask.subarray(d * DAY, (d + 1) * DAY);
      if (from === to) dayMask.fill(1);
      else fillInterval(dayMask, from, to, 1);
    }
    return {
      id: b.id ?? `base-${i + 1}`,
      name: b.name ?? `Постійне навантаження ${i + 1}`,
      powerW: positive(b.powerW, `baseLoads[${i}].powerW`),
      priority: priority(b.priority, `baseLoads[${i}].priority`),
      activeMask,
    };
  });

  // Кожен прилад планується раз на добу: на 48 год він має дві копії, на сьогодні й на завтра.
  const appliances = Array.from({ length: D }, (_, d) => (household.appliances ?? []).map((a, i) => ({ a, i, d }))).flat().map(({ a, i, d }) => {
    const name = a.name ?? `Прилад ${i + 1}`;
    const duration = Math.max(1, Math.round(positive(a.durationMin, `appliances[${i}].durationMin`) / SLOT_MINUTES));
    const dayEarliest = a.earliest ? timeToSlot(a.earliest) : 0;
    const dayLatestEnd = a.latest ? timeToSlot(a.latest) : DAY;
    if (dayLatestEnd - duration < dayEarliest) {
      throw new Error(`Прилад "${name}" не вміщується у вікно ${a.earliest ?? '00:00'}–${a.latest ?? '24:00'}`);
    }
    const earliest = dayEarliest + d * DAY;
    const latestEnd = dayLatestEnd + d * DAY;
    const latestStart = latestEnd - duration;
    let preferred = a.preferredStart ? clamp(timeToSlot(a.preferredStart) + d * DAY, earliest, latestStart) : null;
    const baseId = a.id ?? `appliance-${i + 1}`;
    const id = d === 0 ? baseId : `${baseId}@${d + 1}`;
    // Під час перепланування вже ввімкнений прилад має фіксований старт, а решта — не раніше поточного моменту.
    let domain = { earliest, latestStart };
    if (replan) {
      const fixed = replan.fixedStarts?.[id];
      if (Number.isInteger(fixed)) domain = { earliest: fixed, latestStart: fixed, fixed: true };
      else if (latestStart < nowSlot) domain = { earliest: SKIP, latestStart: SKIP };
      else domain = { earliest: Math.max(earliest, nowSlot), latestStart };
      if (preferred !== null) preferred = domain.earliest === SKIP ? null : clamp(preferred, domain.earliest, domain.latestStart);
    }
    return {
      ...domain,
      // Під час перепланування: вікно приладу вже минуло, а він не вмикався — це не провал плану, а пропущене.
      missed: domain.earliest === SKIP,
      originalEarliest: earliest,
      id,
      baseId,
      day: d,
      name,
      powerW: positive(a.powerW, `appliances[${i}].powerW`),
      duration,
      latestEnd,
      preferred,
      priority: priority(a.priority, `appliances[${i}].priority`),
      allowOnBattery: a.allowOnBattery !== false,
    };
  });

  // Порядок обслуговування навантажень: спочатку важливіші; при рівному пріоритеті постійні раніше за прилади.
  const loadOrder = [
    ...baseLoads.map((l, index) => ({ kind: 'base', index, priority: l.priority })),
    ...appliances.map((l, index) => ({ kind: 'appliance', index, priority: l.priority })),
  ].sort((x, y) => y.priority - x.priority || (x.kind === y.kind ? 0 : x.kind === 'base' ? -1 : 1));

  // Гени хромосоми: спочатку слоти запуску приладів, потім пороги запуску генераторів (0…20 або SKIP — не вмикати).
  const genes = [
    ...appliances.map((a) => ({ earliest: a.earliest, latestStart: a.latestStart, fixed: a.fixed })),
    ...generators.map(() => ({ earliest: 0, latestStart: GENERATOR_THRESHOLD_GENES })),
  ];

  return { T, days: D, slotHours: SLOT_HOURS, startSlot: nowSlot, gridMaxW, battery, generators, solar, plannedGrid, outages, baseLoads, appliances, loadOrder, genes };
}

// Правило за замовчуванням для базових методів: вмикати генератор, коли заряд станції впав до 30%
// (без станції — одразу на початку відключення).
export const DEFAULT_GENERATOR_GENE = 30 / GENERATOR_THRESHOLD_STEP;

// Доповнює план приладів генами генераторів (для методів, які генератором не керують).
export function withGeneratorGenes(model, applianceStarts, gene = DEFAULT_GENERATOR_GENE) {
  return [...applianceStarts.slice(0, model.appliances.length), ...model.generators.map(() => gene)];
}

function concatDays(parts) {
  if (parts.every((p) => !p)) return null;
  const out = new Float64Array(parts.length * SLOTS_PER_DAY);
  parts.forEach((p, d) => p && out.set(p, d * SLOTS_PER_DAY));
  return out;
}

// Сонячна генерація за слотами: синусоїда між сходом і заходом сонця, площа під якою дорівнює
// денній енергії peakW · сонячні години · 0.75 (втрати); потужність не перевищує 0.75 · peakW.
export const SOLAR_DERATE = 0.75;
function buildSolar(panels, T) {
  if (!panels.length) return null;
  const profile = new Float64Array(T);
  for (const p of panels) {
    const peakW = Number(p.peakW) || 0;
    const energyWh = peakW * (Number(p.sunHours) || 0) * SOLAR_DERATE;
    const rise = p.sunrise ? timeToSlot(p.sunrise) * SLOT_HOURS : 7;
    const set = p.sunset ? timeToSlot(p.sunset) * SLOT_HOURS : 18;
    if (!(energyWh > 0) || set <= rise) continue;
    const amplitude = (energyWh * Math.PI) / (2 * (set - rise));
    for (let t = 0; t < T; t++) {
      const h = (t + 0.5) * SLOT_HOURS;
      if (h > rise && h < set) profile[t] += Math.min(peakW * SOLAR_DERATE, amplitude * Math.sin((Math.PI * (h - rise)) / (set - rise)));
    }
  }
  return profile;
}

function buildBattery(b) {
  const capacityWh = positive(b.capacityWh, 'battery.capacityWh');
  const pct = (value, fallback, field) => {
    const v = value ?? fallback;
    if (!(v >= 0 && v <= 100)) throw new Error(`Поле ${field} має бути від 0 до 100`);
    return (v / 100) * capacityWh;
  };
  const minWh = pct(b.minSocPct, 10, 'battery.minSocPct');
  return {
    capacityWh,
    initialWh: Math.max(minWh, pct(b.initialSocPct, 100, 'battery.initialSocPct')),
    minWh,
    targetEndWh: pct(b.targetEndSocPct, 60, 'battery.targetEndSocPct'),
    maxChargeW: positive(b.maxChargeW ?? 500, 'battery.maxChargeW'),
    inverterMaxW: positive(b.inverterMaxW ?? 1000, 'battery.inverterMaxW'),
    etaCh: b.chargeEfficiency ?? 0.95,
    etaDis: b.dischargeEfficiency ?? 0.92,
  };
}

function positive(value, field) {
  const v = Number(value);
  if (!(v > 0)) throw new Error(`Поле ${field} має бути додатним числом`);
  return v;
}

function priority(value, field) {
  const v = Number(value ?? 3);
  if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`Поле ${field} має бути цілим від 1 до 5`);
  return v;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

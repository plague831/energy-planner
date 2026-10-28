// Джерела резервного живлення домогосподарства: зарядні станції, генератори, сонячні панелі.
// Планувальник у ядрі працює з одним акумулятором, тому всі станції для нього зводяться в одну
// еквівалентну (ємності, потужності заряджання й інвертора додаються, заряд — середньозважений).
// Генератори й панелі поки враховуються лише в розрахунку резервного живлення.
import { defaultCity } from './weather.js';
import { readChoice } from './yasno.js';

export const SOURCE_KINDS = {
  battery: { icon: '🔋', label: 'Зарядна станція', add: 'Зарядна станція' },
  generator: { icon: '⛽', label: 'Генератор', add: 'Генератор' },
  solar: { icon: '☀️', label: 'Сонячні панелі', add: 'Сонячні панелі' },
};

const DEFAULTS = {
  battery: { capacityWh: 1024, initialSocPct: 70, minSocPct: 10, targetEndSocPct: 60, maxChargeW: 600, inverterMaxW: 1800 },
  generator: { ratedW: 2500, tankHoursAtHalf: 8, fuelPct: 100 },
  solar: { peakW: 800, sunHours: 3, forecast: true },
};

let counter = 0;
export function newSource(kind, overrides = {}) {
  counter += 1;
  // Нова панель одразу бере сонце з прогнозу погоди для міста, обраного в графіку відключень.
  if (kind === 'solar') {
    const city = defaultCity(readChoice().sourceLabel);
    overrides = { place: city.name, lat: city.lat, lon: city.lon, ...overrides };
  }
  return { id: `${kind}-${Date.now()}-${counter}`, kind, name: SOURCE_KINDS[kind].label, ...DEFAULTS[kind], ...overrides };
}

// Еквівалентна станція для планувальника або null, якщо станцій немає.
export function aggregateBattery(sources) {
  const list = sources.filter((s) => s.kind === 'battery' && Number(s.capacityWh) > 0);
  if (!list.length) return null;
  const capacityWh = list.reduce((sum, s) => sum + Number(s.capacityWh), 0);
  const weighted = (field, fallback) => list.reduce((sum, s) => sum + Number(s[field] ?? fallback) * Number(s.capacityWh), 0) / capacityWh;
  return {
    capacityWh,
    initialSocPct: Math.round(weighted('initialSocPct', 100)),
    minSocPct: Math.round(weighted('minSocPct', 10)),
    targetEndSocPct: Math.round(weighted('targetEndSocPct', 60)),
    maxChargeW: list.reduce((sum, s) => sum + Number(s.maxChargeW || 0), 0) || 500,
    inverterMaxW: list.reduce((sum, s) => sum + Number(s.inverterMaxW || 0), 0) || 1000,
    model: list.length === 1 ? list[0].model : undefined,
  };
}

// Оновлює список джерел і синхронізує з ним поле battery, яке читають планувальник і графіки.
export function withSources(household, sources) {
  const { generator, solar, ...rest } = household;
  return { ...rest, sources, battery: aggregateBattery(sources) };
}

// Старі збережені дані (одна станція в battery, генератор і панелі окремими полями) переводяться у список.
export function migrateHousehold(household) {
  if (!household || Array.isArray(household.sources)) return household;
  const sources = [];
  if (household.battery) {
    sources.push({ ...newSource('battery'), ...household.battery, name: household.battery.model ? `Станція ${household.battery.model}` : SOURCE_KINDS.battery.label });
  }
  if (household.generator) sources.push({ ...newSource('generator'), ...household.generator });
  if (household.solar) sources.push({ ...newSource('solar'), ...household.solar });
  return withSources(household, sources);
}

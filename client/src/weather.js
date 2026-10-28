// Прогноз сонячної енергії з Open-Meteo (безкоштовно, без ключа): денна сума сонячної радіації
// на горизонтальну поверхню, схід і захід сонця, хмарність. Сума радіації в МДж/м² ÷ 3,6 = кВт·год/м²,
// тобто кількість «пікових сонячних годин» (годин при 1 кВт/м²), яку й використовує модель панелей.
// Для похилих панелей реальна генерація зазвичай трохи вища, тож оцінка консервативна.
const CACHE_KEY = 'energy-planner:solar-forecast';
const TTL_MS = 3 * 3600_000;

export const CITIES = [
  { name: 'Київ', lat: 50.45, lon: 30.52 },
  { name: 'Дніпро', lat: 48.46, lon: 35.04 },
  { name: 'Харків', lat: 49.99, lon: 36.23 },
  { name: 'Львів', lat: 49.84, lon: 24.03 },
  { name: 'Одеса', lat: 46.48, lon: 30.72 },
  { name: 'Запоріжжя', lat: 47.84, lon: 35.14 },
  { name: 'Вінниця', lat: 49.23, lon: 28.47 },
  { name: 'Полтава', lat: 49.59, lon: 34.55 },
  { name: 'Чернігів', lat: 51.49, lon: 31.29 },
  { name: 'Суми', lat: 50.91, lon: 34.8 },
  { name: 'Житомир', lat: 50.25, lon: 28.66 },
  { name: 'Івано-Франківськ', lat: 48.92, lon: 24.71 },
];

const key = (lat, lon) => `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {
    return {};
  }
}

// { 'YYYY-MM-DD': { sunHours, sunrise: 'HH:MM', sunset: 'HH:MM', cloudPct } } на сьогодні й завтра.
export async function solarForecast(lat, lon) {
  const cache = readCache();
  const hit = cache[key(lat, lon)];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.days;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=shortwave_radiation_sum,sunrise,sunset,cloud_cover_mean&timezone=Europe%2FKyiv&forecast_days=2`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo відповів ${res.status}`);
  const { daily } = await res.json();
  const days = Object.fromEntries(
    daily.time.map((date, i) => [
      date,
      {
        sunHours: Math.round((daily.shortwave_radiation_sum[i] / 3.6) * 10) / 10,
        sunrise: daily.sunrise[i].slice(11, 16),
        sunset: daily.sunset[i].slice(11, 16),
        cloudPct: daily.cloud_cover_mean[i],
      },
    ]),
  );
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cache, [key(lat, lon)]: { at: Date.now(), days } }));
  } catch {
    // Без кешу прогноз просто завантажиться ще раз.
  }
  return days;
}

// Звичайна кількість пікових сонячних годин для України по місяцях (середня денна сума радіації
// на горизонтальну поверхню, кВт·год/м²). Береться, коли прогноз недоступний.
const TYPICAL_SUN_HOURS = [0.9, 1.6, 2.6, 3.7, 4.8, 5.1, 5.1, 4.4, 3.1, 1.8, 0.9, 0.7];
const MONTHS_LOC = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

export function typicalSunHours(date = new Date()) {
  return TYPICAL_SUN_HOURS[date.getMonth()];
}

export function monthName(date = new Date()) {
  return MONTHS_LOC[date.getMonth()];
}

// Місто для прогнозу за замовчуванням: те, що обране в графіку відключень YASNO, інакше Київ.
export function defaultCity(yasnoLabel) {
  return CITIES.find((c) => yasnoLabel?.startsWith(c.name)) ?? CITIES[0];
}

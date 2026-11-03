// Безкоштовний сервер на Render засинає без запитів і прокидається до хвилини: поки він стартує,
// проксі Netlify відповідає 502/503/504. Такі відповіді повторюємо з паузою, а не показуємо помилку одразу.
const WAKE_STATUSES = new Set([502, 503, 504]);
const WAKE_DELAYS_MS = [3000, 6000, 10000, 15000, 20000];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(path, options);
    } catch (err) {
      // Без інтернету чекати немає сенсу: одразу показуємо збережений план.
      if (attempt >= WAKE_DELAYS_MS.length || !navigator.onLine) throw err;
      await pause(WAKE_DELAYS_MS[attempt]);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    // 503 з поясненням від самого сервера (наприклад, «база не налаштована») — це відповідь, а не сон.
    if (WAKE_STATUSES.has(res.status) && !body.error && attempt < WAKE_DELAYS_MS.length) {
      await pause(WAKE_DELAYS_MS[attempt]);
      continue;
    }
    if (!res.ok) {
      const asleep = WAKE_STATUSES.has(res.status) && !body.error;
      const err = new Error(body.error ?? (asleep ? 'Сервер не відповідає. Спробуйте оновити сторінку за хвилину.' : `Помилка сервера (${res.status})`));
      err.status = res.status;
      throw err;
    }
    return body;
  }
}

export const getDefaults = () => request('/api/defaults');
export const getAlgorithms = () => request('/api/algorithms');

// replan (необов'язково) — перепланування з поточного моменту: { nowSlot, fixedStarts, socPct, fuelPct }.
export const buildPlan = (household, algorithm, replan) =>
  request('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ household, algorithm, replan }),
  });

export const getYasnoRegions = () => request('/api/sources/yasno/regions');
export const getYasnoSchedule = (region, dso) =>
  request(`/api/sources/yasno/schedule?region=${encodeURIComponent(region)}&dso=${encodeURIComponent(dso)}`);

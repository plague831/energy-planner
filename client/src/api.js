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
      if (attempt >= WAKE_DELAYS_MS.length || !navigator.onLine || (options?.method && options.method !== 'GET')) throw err;
      await pause(WAKE_DELAYS_MS[attempt]);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    // 503 з поясненням від самого сервера (наприклад, «база не налаштована») — це відповідь, а не сон.
    // Повторюємо лише читання: повторний POST лише додав би серверу роботи.
    const isGet = !options?.method || options.method === 'GET';
    if (isGet && WAKE_STATUSES.has(res.status) && !body.error && attempt < WAKE_DELAYS_MS.length) {
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

// План рахується в браузері (у фоновому потоці), а не на сервері: так швидше і не залежить від того,
// чи прокинувся сервер. replan (необов'язково) — перепланування з поточного моменту:
// { nowSlot, fixedStarts, socPct, fuelPct }.
let worker = null;
let nextId = 0;
const pending = new Map();
function planWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./planWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) {
      // Як 400 від сервера: дані некоректні, план не перераховано.
      const err = new Error(data.error);
      err.status = 400;
      job.reject(err);
    } else job.resolve(data.result);
  };
  return worker;
}

export const buildPlan = (household, algorithm = 'robust-ga', replan) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    planWorker().postMessage({ id, household, algorithm, replan });
  });

export const getYasnoRegions = () => request('/api/sources/yasno/regions');
export const getYasnoSchedule = (region, dso) =>
  request(`/api/sources/yasno/schedule?region=${encodeURIComponent(region)}&dso=${encodeURIComponent(dso)}`);

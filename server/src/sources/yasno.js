// Графіки планових відключень з відкритого API YASNO (Київ і Дніпро).
// Для інших областей відкритого джерела немає, там графік вводиться вручну.

const BASE_URL = 'https://app.yasno.ua/api/blackout-service/public/shutdowns';
const SCHEDULE_TTL_MS = 5 * 60 * 1000;
const REGIONS_TTL_MS = 24 * 60 * 60 * 1000;
const SLOT_MINUTES = 15;

export const STATUS_TEXT = {
  ScheduleApplies: 'Діє графік відключень',
  NoOutages: 'Відключень не заплановано',
  WaitingForSchedule: 'Графік на цей день ще не опубліковано',
  EmergencyShutdowns: 'Діють аварійні відключення, графік не застосовується',
};

export async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`YASNO відповів ${res.status}`);
  return res.json();
}

// Клієнт з кешем у пам'яті, щоб не звертатися до YASNO на кожне відкриття сторінки.
export function createYasnoClient({ fetchJson: get = fetchJson, now = Date.now } = {}) {
  const cache = new Map();
  const cached = async (url, ttl) => {
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = await get(url);
    cache.set(url, { at: now(), value });
    return value;
  };

  return {
    async regions() {
      const raw = await cached(`${BASE_URL}/addresses/v2/regions`, REGIONS_TTL_MS);
      return (Array.isArray(raw) ? raw : []).map((r) => ({
        id: r.id,
        name: r.value,
        dsos: (r.dsos ?? []).map((d) => ({ id: d.id, name: d.name })),
      }));
    },
    async schedule(regionId, dsoId) {
      const raw = await cached(`${BASE_URL}/regions/${regionId}/dsos/${dsoId}/planned-outages`, SCHEDULE_TTL_MS);
      return parsePlannedOutages(raw);
    },
  };
}

// Відповідь YASNO: { "1.1": { today: { slots, date, status }, tomorrow: {...}, updatedOn }, ... },
// де slots — інтервали у хвилинах від початку доби з типом Definite (відключення) або NotPlanned.
export function parsePlannedOutages(raw) {
  const groups = Object.entries(raw ?? {})
    .filter(([, value]) => value && typeof value === 'object')
    .map(([group, value]) => ({
      group,
      updatedOn: value.updatedOn ?? null,
      today: parseDay(value.today),
      tomorrow: parseDay(value.tomorrow),
    }))
    .sort((a, b) => a.group.localeCompare(b.group, 'uk', { numeric: true }));
  return { groups };
}

function parseDay(day) {
  if (!day) return null;
  const slots = Array.isArray(day.slots) ? day.slots : [];
  return {
    date: day.date ? String(day.date).slice(0, 10) : null,
    status: day.status ?? null,
    statusText: STATUS_TEXT[day.status] ?? day.status ?? 'Невідомий стан графіка',
    // Невідомий тип вважаємо відключенням: для планування безпечніше перестрахуватися.
    outages: toIntervals(slots.filter((s) => s.type !== 'NotPlanned' && !/possible/i.test(s.type ?? ''))),
    possible: toIntervals(slots.filter((s) => /possible/i.test(s.type ?? ''))),
  };
}

// Хвилини -> інтервали "ГГ:ХХ" на сітці 15 хвилин; суміжні інтервали зливаються.
function toIntervals(slots) {
  const ranges = slots
    .map((s) => [Math.floor(Number(s.start) / SLOT_MINUTES) * SLOT_MINUTES, Math.ceil(Number(s.end) / SLOT_MINUTES) * SLOT_MINUTES])
    .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from)
    .map(([from, to]) => [Math.max(0, from), Math.min(24 * 60, to)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [from, to] of ranges) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged.map(([from, to]) => ({ from: minutesToTime(from), to: minutesToTime(to) }));
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

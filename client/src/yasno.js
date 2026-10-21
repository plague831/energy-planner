import { getYasnoRegions, getYasnoSchedule } from './api.js';

// Вибір міста й черги YASNO зберігається в браузері: { source: "регіон:оператор", group, day, auto }.
const STORAGE_KEY = 'energy-planner:yasno';

export function readChoice() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveChoice(choice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Без збереження вибору все одно працює.
  }
}

// Список міст/операторів для вибору: [{ value: "25:902", label: "Київ" }, ...].
export async function loadSources() {
  const regions = await getYasnoRegions();
  return regions.flatMap((r) => r.dsos.map((d) => ({ value: `${r.id}:${d.id}`, label: r.dsos.length > 1 ? `${r.name}, ${d.name}` : r.name })));
}

export async function loadGroups(source) {
  const [region, dso] = source.split(':');
  const schedule = await getYasnoSchedule(region, dso);
  return schedule.groups.map((g) => g.group);
}

// Графік черги на сьогодні чи завтра. applies — чи можна підставляти графік у план
// (якщо діють аварійні відключення або графік ще не опубліковано, то ні).
export async function loadDay({ source, group, day = 'today' }) {
  const [region, dso] = source.split(':');
  const { groups } = await getYasnoSchedule(region, dso);
  const data = groups.find((g) => g.group === group)?.[day];
  if (!data) throw new Error(`YASNO не має даних для черги ${group}`);
  return { ...data, day, group, applies: data.status === 'ScheduleApplies' || data.status === 'NoOutages' };
}

export function countOutages(n) {
  if (n === 0) return 'відключень не заплановано';
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 >= 1 && mod10 <= 4 && !(mod100 >= 11 && mod100 <= 14) ? 'відключення' : 'відключень';
  return `${n} ${word}`;
}

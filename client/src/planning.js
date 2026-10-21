import { buildPlan } from './api.js';
import { localDate } from './exportPlan.js';

// План на сьогодні завжди будується з поточного моменту: минуле вже не змінити.
// Попередній план на цю ж дату зберігається, щоб знати, які прилади вже ввімкнено
// і який зараз (за розрахунком) заряд станції та рівень пального.
const LAST_PLAN_KEY = 'energy-planner:last-plan';
const SLOT_MIN = 15;
const T = 96;

export const currentSlot = () => {
  const d = new Date();
  return Math.min(T - 1, Math.floor((d.getHours() * 60 + d.getMinutes()) / SLOT_MIN));
};

function readLastPlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PLAN_KEY));
    return saved?.date === localDate(0) ? saved : null;
  } catch {
    return null;
  }
}

function saveLastPlan(entry) {
  try {
    localStorage.setItem(LAST_PLAN_KEY, JSON.stringify(entry));
  } catch {
    // Без сховища план просто буде будуватися щоразу з введених значень.
  }
}

// «Підпис» введених людиною поточних значень: якщо вона їх змінила, довіряємо їм, а не розрахунку.
const enteredState = (h) => JSON.stringify((h.sources ?? []).map((s) => [s.id, s.initialSocPct ?? null, s.fuelPct ?? null, s.capacityWh ?? null]));

// scheduleOutages — опублікований графік (без уточнень від людини), щоб «графік змінився» спрацьовувало
// лише на зміну графіка, а не на кнопки «світло зникло / повернулось».
// План завжди будується на 48 год від поточного моменту (household.nextDay — дані на завтра),
// тож заряд станції ввечері враховує завтрашній ранок. Повертається зріз на потрібну добу.
export async function planDay(household, algorithm, { day = 'today', scheduleOutages } = {}) {
  const scheduleKey = JSON.stringify(scheduleOutages ?? household.outages ?? []);
  const nowSlot = currentSlot();
  const prev = readLastPlan();
  const ids = new Set((household.appliances ?? []).map((a) => a.id));
  const fixedStarts = {};
  for (const s of prev?.schedule ?? []) {
    if (!s.skipped && (s.day ?? 0) === 0 && s.startSlot < nowSlot && ids.has(s.id)) fixedStarts[s.id] = s.startSlot;
  }
  const sameInputs = prev && prev.entered === enteredState(household);
  const replan = {
    nowSlot,
    fixedStarts,
    socPct: sameInputs && Number.isFinite(prev.socBySlot?.[nowSlot]) ? prev.socBySlot[nowSlot] : household.battery?.initialSocPct,
    fuelPct: sameInputs && Number.isFinite(prev.fuelBySlot?.[nowSlot])
      ? Object.fromEntries((household.sources ?? []).filter((s) => s.kind === 'generator').map((g) => [g.id, prev.fuelBySlot[nowSlot]]))
      : undefined,
  };
  // Якщо попереднього плану на сьогодні немає, минулі години доби беруться з плану на весь горизонт,
  // щоб діаграма й енергобаланс показували всю добу, а не лише решту.
  const needPast = nowSlot > 0 && !(prev?.trace?.length >= nowSlot);
  const [fresh, fullDay] = await Promise.all([buildPlan(household, algorithm, replan), needPast ? buildPlan(household, algorithm).catch(() => null) : null]);
  const full = mergeWithPast(fresh, fullDay ? { trace: fullDay.nominal.trace } : prev, household);

  // Що змінилось порівняно з попереднім планом, коли змінився графік відключень.
  const changed = prev && prev.outages !== scheduleKey ? describeChanges(prev.schedule.filter((s) => (s.day ?? 0) === 0), sliceDay(full, 0).schedule, nowSlot) : null;

  const capacity = household.battery?.capacityWh;
  saveLastPlan({
    date: localDate(0),
    entered: enteredState(household),
    outages: scheduleKey,
    schedule: full.schedule,
    socBySlot: capacity ? full.nominal.trace.map((t) => (t.energyWh / capacity) * 100) : [],
    fuelBySlot: full.nominal.trace.map((t) => t.fuelPct),
    trace: full.nominal.trace,
    result: full,
  });
  return { result: sliceDay(full, day === 'tomorrow' ? 1 : 0), changed };
}

// Зріз 48-годинного плану на одну добу: слоти й ідентифікатори приладів — як у плані на одну добу.
export function sliceDay(result, d) {
  const trace = result.nominal.trace;
  if (trace.length <= T) return d === 0 ? result : null;
  const from = d * T;
  const strip = (id) => String(id).replace(/@\d+$/, '');
  const dayIds = new Set(result.schedule.filter((x) => (x.day ?? 0) === d).map((x) => x.id));
  return {
    ...result,
    fromSlot: Math.max(0, (result.fromSlot ?? 0) - from),
    schedule: result.schedule
      .filter((x) => (x.day ?? 0) === d)
      .map((x) => ({ ...x, id: strip(x.id), day: 0, ...(x.skipped ? {} : { startSlot: x.startSlot - from, endSlot: x.endSlot - from }) })),
    nominal: {
      ...result.nominal,
      trace: trace.slice(from, from + T).map((t) => ({ ...t, slot: t.slot - from })),
      failedIds: (result.nominal.failedIds ?? []).filter((id) => dayIds.has(id)).map(strip),
      missedIds: (result.nominal.missedIds ?? []).filter((id) => dayIds.has(id)).map(strip),
    },
  };
}

// Розрахунок починається з «зараз», тож минулі слоти доби беруться з попереднього плану,
// а якщо його немає — заповнюються за графіком без навантажень, щоб діаграма і список мали всю добу.
function mergeWithPast(result, prev, household) {
  const from = result.fromSlot ?? 0;
  if (from === 0) return result;
  const first = result.nominal.trace[0];
  const outageMask = maskOf(household.outages ?? []);
  const past = Array.from({ length: from }, (_, t) => {
    const old = prev?.trace?.[t];
    if (old && old.slot === t) return { ...old, past: true };
    return { slot: t, gridOn: !outageMask[t], demandW: 0, servedW: 0, chargeW: 0, energyWh: first.energyWh, solarW: 0, generatorW: 0, fuelPct: first.fuelPct, past: true, filler: true };
  });
  return { ...result, nominal: { ...result.nominal, trace: [...past, ...result.nominal.trace] } };
}

function maskOf(outages) {
  const mask = new Array(T).fill(false);
  const slot = (t) => {
    const [h, m] = t.split(':').map(Number);
    return Math.round((h * 60 + m) / SLOT_MIN);
  };
  for (const o of outages) {
    const from = slot(o.from);
    const to = slot(o.to) % T;
    for (let t = from; t !== to; t = (t + 1) % T) mask[t] = true;
  }
  return mask;
}

function describeChanges(before, after, nowSlot) {
  const prev = new Map((before ?? []).map((s) => [s.id, s]));
  const moved = [];
  for (const s of after) {
    const old = prev.get(s.id);
    if (!old || (s.startSlot ?? -1) < nowSlot) continue;
    if (old.skipped !== s.skipped || old.start !== s.start) {
      moved.push(s.skipped ? `${s.name}: сьогодні краще не вмикати` : `${s.name}: тепер о ${s.start}${old.skipped ? '' : ` (було ${old.start})`}`);
    }
  }
  return { at: `${String(Math.floor((nowSlot * SLOT_MIN) / 60)).padStart(2, '0')}:${String((nowSlot * SLOT_MIN) % 60).padStart(2, '0')}`, moved };
}

// Останній збережений план на сьогодні — для роботи без зв'язку з сервером.
export function lastSavedResult(day = 'today') {
  const saved = readLastPlan()?.result;
  return saved ? sliceDay(saved, day === 'tomorrow' ? 1 : 0) : null;
}

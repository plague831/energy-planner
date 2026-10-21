import { localDate } from './exportPlan.js';

// Фактичні події «світло зникло / повернулось», які повідомляє людина.
// Вони (1) уточнюють графік на сьогодні, щоб план будувався від реального стану, і
// (2) зберігаються як спостереження: наскільки реальність розходиться з опублікованим графіком.
const EVENTS_KEY = 'energy-planner:actual-events';
const SLOT_MIN = 15;
const T = 96;
// Якщо світло зникло поза графіком, вважаємо, що його не буде щонайменше 2 години
// (типова тривалість аварійного відключення), доки людина не повідомить, що воно повернулось.
const UNSCHEDULED_HOURS = 2;

const toSlot = (t) => {
  const [h, m] = t.split(':').map(Number);
  return Math.round((h * 60 + m) / SLOT_MIN);
};
const toTime = (slot) => {
  const m = ((slot % T) + T) % T * SLOT_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

export function readEvents() {
  try {
    const list = JSON.parse(localStorage.getItem(EVENTS_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveEvents(list) {
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(list));
  } catch {
    // Без сховища подія діє лише до перезавантаження сторінки.
  }
}

// Додає подію і повертає оновлений список. Разом з подією зберігаємо графік, який діяв у цей момент,
// щоб пізніше порахувати розбіжність, навіть якщо графік змінять.
export function addEvent(type, household, queue) {
  const minute = nowMinutes();
  const previous = currentActual(readEvents());
  // Світло повернулось після позапланового відключення — порівнювати з кінцем запланованого нема з чим.
  const afterUnscheduled = type === 'on' && previous?.type === 'off' && previous.deviationMin === null;
  const event = {
    date: localDate(0),
    time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
    minute,
    type, // 'off' — світло зникло, 'on' — повернулось
    queue: queue ?? null,
    scheduled: household.outages ?? [],
    deviationMin: afterUnscheduled ? null : deviation(type, minute, household.outages ?? []),
  };
  const list = [...readEvents(), event].slice(-500);
  saveEvents(list);
  return list;
}

export function clearEvents() {
  saveEvents([]);
  return [];
}

// Розбіжність з графіком у хвилинах: для «зникло» — відносно найближчого запланованого початку,
// для «повернулось» — відносно найближчого запланованого кінця. Додатне — пізніше за графік.
// null — поруч (±3 год) немає відповідної межі в графіку, тобто це позапланова подія.
export function deviation(type, minute, outages) {
  const bounds = outages.map((o) => (type === 'off' ? toSlot(o.from) : toSlot(o.to)) * SLOT_MIN);
  let best = null;
  for (const b of bounds) {
    for (const candidate of [b, b - 1440, b + 1440]) {
      const d = minute - candidate;
      if (Math.abs(d) <= 180 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

// Останній фактичний стан на сьогодні: 'off', 'on' або null (людина нічого не повідомляла).
export function currentActual(events) {
  const today = events.filter((e) => e.date === localDate(0));
  return today.at(-1) ?? null;
}

// Графік на сьогодні з урахуванням повідомленого фактичного стану.
// Повертає { outages, note } — note пояснює, як саме графік уточнено.
export function applyActual(outages, event) {
  if (!event || event.date !== localDate(0)) return { outages, note: null };
  const slot = Math.floor(event.minute / SLOT_MIN);
  const ranges = outages.map((o) => {
    const from = toSlot(o.from);
    let to = toSlot(o.to);
    if (to <= from) to += T;
    return { from, to };
  });
  const covering = ranges.find((r) => (slot >= r.from && slot < r.to) || (slot + T >= r.from && slot + T < r.to));

  if (event.type === 'off') {
    if (covering) return { outages, note: null }; // відключення за графіком — нічого не уточнюємо
    // Позапланове або раніше за графік: світла немає щонайменше 2 год, а якщо в цей час починається
    // заплановане відключення, — до його кінця.
    let end = slot + UNSCHEDULED_HOURS * 4;
    const soon = ranges.filter((r) => r.from > slot && r.from <= end).sort((a, b) => a.from - b.from)[0];
    if (soon) end = soon.to;
    const merged = ranges.filter((r) => !(r.from >= slot && r.from <= end)).map((r) => ({ from: toTime(r.from), to: toTime(r.to) }));
    merged.push({ from: toTime(slot), to: toTime(Math.min(end, slot + T - 1)) });
    return {
      outages: merged,
      note: soon
        ? `Світло зникло о ${event.time}, раніше за графік. Вважаю, що його не буде до ${toTime(end)}, як заплановано.`
        : `Світло зникло о ${event.time} поза графіком. Вважаю, що його не буде щонайменше до ${toTime(end)}; натисніть «Світло вже є», коли воно з'явиться.`,
    };
  }

  // 'on': світло повернулось під час запланованого відключення — обрізаємо його на цьому моменті.
  if (!covering) return { outages, note: null };
  const adjusted = ranges
    .map((r) => (r === covering ? { from: r.from, to: slot >= r.from ? slot : slot + T } : r))
    .filter((r) => r.to > r.from)
    .map((r) => ({ from: toTime(r.from), to: toTime(r.to) }));
  return { outages: adjusted, note: `Світло повернулось о ${event.time}, раніше за графік (${toTime(covering.to)}). План перебудовано.` };
}

// Підсумок спостережень для «Детально»: середня розбіжність з графіком.
export function summarize(events) {
  const withDev = events.filter((e) => Number.isFinite(e.deviationMin));
  const avg = (list) => (list.length ? list.reduce((s, e) => s + e.deviationMin, 0) / list.length : null);
  return {
    total: events.length,
    unscheduled: events.filter((e) => e.type === 'off' && e.deviationMin === null).length,
    offAvg: avg(withDev.filter((e) => e.type === 'off')),
    onAvg: avg(withDev.filter((e) => e.type === 'on')),
  };
}

export function eventsToCsv(events) {
  const rows = [['date', 'time', 'event', 'queue', 'deviation_min', 'scheduled_outages']];
  for (const e of events) {
    rows.push([e.date, e.time, e.type === 'off' ? 'off' : 'on', e.queue ?? '', e.deviationMin ?? '', e.scheduled.map((o) => `${o.from}-${o.to}`).join(' ')]);
  }
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
}

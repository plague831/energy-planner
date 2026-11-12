// Розрахунковий стан зарядної станції для картки на «Сьогодні»: заряд зараз, скільки віддає чи
// бере, скільки віддано чи заряджено від початку поточного відрізка графіка і на скільки ще вистачить.
// Усе — за слідом імітації плану (trace, слоти по 15 хв), а не з самої станції.
const SLOT_MIN = 15;
const SLOT_H = SLOT_MIN / 60;
const ETA = 0.92; // ККД розряду й заряду станції, як у моделі

const toSlot = (t) => {
  const [h, m] = t.split(':').map(Number);
  return Math.round((h * 60 + m) / SLOT_MIN);
};

// Скільки станція віддає в цей слот: під час відключення те, що не покрили сонце й генератор.
export const dischargeW = (t) => (t.gridOn ? 0 : Math.max(0, (t.servedW ?? 0) + (t.chargeW ?? 0) - (t.solarW ?? 0) - (t.generatorW ?? 0)));

// Відрізки доби «світло є / світла немає» за графіком (з уточненнями людини), від 0 до 96 слотів.
export function daySegments(outages) {
  const off = new Uint8Array(96);
  for (const o of outages ?? []) {
    const from = toSlot(o.from);
    let to = toSlot(o.to);
    if (to <= from) to += 96;
    for (let t = from; t < Math.min(to, 96); t++) off[t] = 1;
    // Хвіст відключення через північ (22:00–02:00) — на початку доби.
    for (let t = 96; t < to; t++) off[t - 96] = 1;
  }
  const segments = [];
  for (let t = 0; t < 96; t++) {
    const last = segments.at(-1);
    if (last && last.off === Boolean(off[t])) last.to = t + 1;
    else segments.push({ from: t, to: t + 1, off: Boolean(off[t]) });
  }
  return segments;
}

// now — момент доби в слотах (може бути дробовим). null, якщо станції чи плану немає.
export function stationState(household, trace, now) {
  const battery = household.battery;
  if (!battery?.capacityWh || !trace?.length) return null;
  const capacity = battery.capacityWh;
  const minPct = battery.minSocPct ?? 10;
  const slot = Math.min(trace.length - 1, Math.floor(now));
  const pct = (wh) => Math.max(0, Math.min(100, (wh / capacity) * 100));
  const socNow = pct(trace[slot].energyWh);
  const outW = dischargeW(trace[slot]);
  const inW = trace[slot].chargeW ?? 0;

  // Поточний відрізок графіка: від його початку рахуємо «без світла» чи «світло є».
  const segments = daySegments(household.outages);
  const current = segments.find((s) => slot >= s.from && slot < s.to) ?? segments[0];
  const elapsedH = (now - current.from) * SLOT_H;

  // Підсумки (віддано, заряджено, зміна заряду) — лише за ту частину відрізка, де план теж бачив
  // той самий стан світла: якщо графік змінився посеред дня, минулі слоти лишаються від старого плану.
  // Так само, якщо план перебудовано з нового заряду (людина змінила станцію чи «Заряд зараз»):
  // минулі слоти лишаються від розрахунку з іншим зарядом, і на стику заряд стрибає.
  let floor = current.from;
  const restart = trace.findIndex((t) => !t.past);
  if (restart > current.from && restart <= slot) {
    const t = trace[restart];
    const oneSlot = (Math.max(dischargeW(t), t.chargeW ?? 0) * SLOT_H) / ETA;
    if (Math.abs(trace[restart - 1].energyWh - t.energyWh) > oneSlot + capacity * 0.03) floor = restart;
  }
  let startSlot = slot;
  while (startSlot > floor && Boolean(trace[startSlot - 1].gridOn) === Boolean(trace[slot].gridOn)) startSlot--;
  const span = trace.slice(startSlot, slot + 1);
  const statsH = Math.max(SLOT_H, (now - startSlot) * SLOT_H);
  // Заряд на початку підсумків. Якщо вони починаються з перебудови плану, попередній слот — зі
  // старого розрахунку, тож заряд «до» відновлюємо з першого нового слота.
  const first = trace[startSlot];
  const socStart =
    startSlot === restart && floor === restart
      ? pct(first.energyWh + (dischargeW(first) / ETA - (first.chargeW ?? 0) * ETA) * SLOT_H)
      : pct((trace[startSlot - 1] ?? first).energyWh);

  const given = span.reduce((sum, t) => sum + dischargeW(t) * SLOT_H, 0);
  const taken = span.reduce((sum, t) => sum + (t.chargeW ?? 0) * SLOT_H, 0);
  return {
    capacity,
    minPct,
    socNow,
    socStart,
    delta: Math.round(socNow) - Math.round(socStart),
    outW,
    inW,
    off: current.off,
    elapsedH,
    // З якого слота рахуються підсумки, якщо не з початку відрізка (інакше null).
    sinceSlot: startSlot > current.from ? startSlot : null,
    given,
    taken,
    avgOutW: given / statsH,
    avgInW: taken / statsH,
    // На скільки годин вистачить до мінімуму за нинішньої потужності; до повного заряду.
    leftH: outW > 0 ? Math.max(0, trace[slot].energyWh - (capacity * minPct) / 100) / outW : null,
    toFullH: inW > 0 ? (capacity - trace[slot].energyWh) / inW : null,
    mode: outW > 1 ? 'out' : inW > 1 ? 'in' : 'idle',
  };
}

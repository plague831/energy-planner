import { SLOTS_PER_DAY, SLOT_HOURS, SLOT_MINUTES, timeToSlot, fillInterval } from './time.js';

// Перетворює дані домогосподарства з форми (час у форматі "ГГ:ХХ", відсотки, хвилини)
// у внутрішню модель задачі: маски слотів, енергію в Вт·год і номери слотів.
export function buildModel(household) {
  if (!household || typeof household !== 'object') throw new Error('Не передано дані домогосподарства');
  const T = SLOTS_PER_DAY;

  const gridMaxW = positive(household.grid?.maxPowerW ?? 5000, 'grid.maxPowerW');

  const plannedGrid = new Uint8Array(T).fill(1);
  const outages = (household.outages ?? []).map((o, i) => {
    const from = timeToSlot(o.from);
    const to = timeToSlot(o.to) % T;
    if (from === to) throw new Error(`Відключення №${i + 1} має нульову тривалість`);
    fillInterval(plannedGrid, from, to, 0);
    return { from, to };
  });

  const battery = household.battery ? buildBattery(household.battery) : null;

  const baseLoads = (household.baseLoads ?? []).map((b, i) => {
    const activeMask = new Uint8Array(T);
    const from = b.from ? timeToSlot(b.from) : 0;
    const to = b.to ? timeToSlot(b.to) % T : 0;
    if (from === to) activeMask.fill(1);
    else fillInterval(activeMask, from, to, 1);
    return {
      id: b.id ?? `base-${i + 1}`,
      name: b.name ?? `Постійне навантаження ${i + 1}`,
      powerW: positive(b.powerW, `baseLoads[${i}].powerW`),
      priority: priority(b.priority, `baseLoads[${i}].priority`),
      activeMask,
    };
  });

  const appliances = (household.appliances ?? []).map((a, i) => {
    const name = a.name ?? `Прилад ${i + 1}`;
    const duration = Math.max(1, Math.round(positive(a.durationMin, `appliances[${i}].durationMin`) / SLOT_MINUTES));
    const earliest = a.earliest ? timeToSlot(a.earliest) : 0;
    const latestEnd = a.latest ? timeToSlot(a.latest) : T;
    const latestStart = latestEnd - duration;
    if (latestStart < earliest) {
      throw new Error(`Прилад "${name}" не вміщується у вікно ${a.earliest ?? '00:00'}–${a.latest ?? '24:00'}`);
    }
    const preferred = a.preferredStart ? clamp(timeToSlot(a.preferredStart), earliest, latestStart) : null;
    return {
      id: a.id ?? `appliance-${i + 1}`,
      name,
      powerW: positive(a.powerW, `appliances[${i}].powerW`),
      duration,
      earliest,
      latestStart,
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

  return { T, slotHours: SLOT_HOURS, gridMaxW, battery, plannedGrid, outages, baseLoads, appliances, loadOrder };
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

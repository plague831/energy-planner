// Енергобаланс по годинах за слідом імітації плану: звідки енергія (сонце, мережа, генератор,
// розряд станції) і куди (споживання, заряд станції). Спільне для енергобалансу доби й історії.
const SLOT_H = 0.25;

// Перетворює покроковий слід імітації на енергію по годинах (Вт·год).
export function hourlyBalance(trace) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, solar: 0, grid: 0, generator: 0, discharge: 0, consumption: 0, charge: 0, shortage: 0, planned: false }));
  for (const t of trace) {
    const h = hours[Math.floor(t.slot / 4)];
    if (!h) continue;
    const served = t.servedW ?? 0;
    const charge = t.chargeW ?? 0;
    const solar = t.solarW ?? 0;
    const generator = t.generatorW ?? 0;
    const grid = t.gridOn ? Math.max(0, served + charge - solar) : 0;
    const discharge = t.gridOn ? 0 : Math.max(0, served + charge - solar - generator);
    h.solar += solar * SLOT_H;
    h.grid += grid * SLOT_H;
    h.generator += generator * SLOT_H;
    h.discharge += discharge * SLOT_H;
    h.consumption += served * SLOT_H;
    h.charge += charge * SLOT_H;
    h.shortage += Math.max(0, (t.demandW ?? 0) - served) * SLOT_H;
    if (!t.past) h.planned = true;
  }
  return hours;
}

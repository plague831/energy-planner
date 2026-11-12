// Джерела резервного живлення: зарядні станції, генератори, сонячні панелі (поле sources домогосподарства).
// Планувальник працює з одним акумулятором, тож усі станції зводяться в одну еквівалентну:
// ємності, потужності заряджання й інвертора додаються, рівні заряду — середньозважені за ємністю.
// Цим користуються і сайт, і сервер (база даних зберігає кожне джерело окремо).

export const POWER_SOURCE_KINDS = ['battery', 'generator', 'solar'];

// Еквівалентна станція для планувальника або null, якщо станцій немає.
export function aggregateBattery(sources) {
  const list = sources.filter((s) => s.kind === 'battery' && Number(s.capacityWh) > 0);
  if (!list.length) return null;
  const capacityWh = list.reduce((sum, s) => sum + Number(s.capacityWh), 0);
  const weighted = (field, fallback) => list.reduce((sum, s) => sum + Number(s[field] ?? fallback) * Number(s.capacityWh), 0) / capacityWh;
  return {
    capacityWh,
    initialSocPct: Math.round(weighted('initialSocPct', 100)),
    minSocPct: Math.round(weighted('minSocPct', 10)),
    targetEndSocPct: Math.round(weighted('targetEndSocPct', 60)),
    maxChargeW: list.reduce((sum, s) => sum + Number(s.maxChargeW || 0), 0) || 500,
    inverterMaxW: list.reduce((sum, s) => sum + Number(s.inverterMaxW || 0), 0) || 1000,
    model: list.length === 1 ? list[0].model : undefined,
  };
}


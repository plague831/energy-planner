import { solarPowerAt, SOLAR_DERATE } from '@energy-planner/core/autonomy';

// Стан сонячних панелей на хвилину доби now (у слотах по 15 хв) — для картки на «Сьогодні».
// Генерація — розрахункова: та сама синусоїда між сходом і заходом сонця, що й у планувальнику,
// з денною енергією з прогнозу погоди або заданих вручну сонячних годин.
const SLOT_MIN = 15;
const minutesOf = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
const isPanel = (s) => s.kind === 'solar' && Number(s.peakW) > 0;

export function solarState(household, trace, now) {
  const panels = (household.sources ?? []).filter(isPanel);
  if (!panels.length) return null;
  const minute = now * SLOT_MIN;
  const powerAt = (m) => panels.reduce((sum, p) => sum + solarPowerAt(p, m), 0);
  // Енергія між двома моментами доби (Вт·год), крок 5 хв.
  const energyBetween = (fromMin, toMin) => {
    let wh = 0;
    for (let m = fromMin; m < toMin; m += 5) wh += (powerAt(m + 2.5) * Math.min(5, toMin - m)) / 60;
    return wh;
  };
  const rise = Math.min(...panels.map((p) => minutesOf(p.sunrise) ?? 7 * 60));
  const set = Math.max(...panels.map((p) => minutesOf(p.sunset) ?? 18 * 60));
  const tomorrow = (household.nextDay?.sources ?? []).filter(isPanel);
  const nextRises = tomorrow.map((p) => minutesOf(p.sunrise)).filter((m) => m !== null);

  // Куди йде сонце за планом: спершу в дім, решта — на заряд станції.
  const t = trace?.[Math.min(trace.length - 1, Math.floor(now))];
  const used = t?.solarW ?? 0;
  const toHome = t ? Math.min(used, t.servedW ?? 0) : null;

  return {
    name: panels.length === 1 ? panels[0].name : `Сонячні панелі (${panels.length})`,
    peakW: panels.reduce((sum, p) => sum + Number(p.peakW), 0),
    source: panels.some((p) => p.typical) ? 'звичайне для місяця' : panels.some((p) => p.forecast) ? 'за прогнозом погоди' : 'за вашими даними',
    cloud: panels.find((p) => Number.isFinite(p.cloudPct))?.cloudPct,
    rise,
    set,
    nextRise: nextRises.length ? Math.min(...nextRises) : null,
    isDay: minute > rise && minute < set,
    beforeSunrise: minute <= rise,
    nowW: powerAt(minute),
    produced: energyBetween(rise, Math.min(Math.max(minute, rise), set)),
    total: energyBetween(rise, set),
    tomorrowWh: tomorrow.reduce((sum, p) => sum + Number(p.peakW) * (Number(p.sunHours) || 0) * SOLAR_DERATE, 0),
    toHome,
    toCharge: t ? Math.max(0, used - toHome) : null,
  };
}

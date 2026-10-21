import { hourlyBalance } from './components/EnergyBalance.jsx';

// Історія по днях (як у застосунках інверторів): підсумок енергобалансу кожного дня за планом.
// Зберігається в браузері останні 62 дні; запис дня оновлюється з кожним перерахунком плану.
const HISTORY_KEY = 'energy-planner:history';
const KEEP_DAYS = 62;

export function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function recordDay(result, date, extra = {}) {
  if (!result?.nominal?.trace?.length) return;
  const hours = hourlyBalance(result.nominal.trace);
  const sum = (k) => Math.round(hours.reduce((s, h) => s + h[k], 0));
  const entry = {
    solar: sum('solar'),
    grid: sum('grid'),
    generator: sum('generator'),
    discharge: sum('discharge'),
    consumption: sum('consumption'),
    charge: sum('charge'),
    shortage: sum('shortage'),
    outageHours: result.nominal.trace.filter((t) => !t.gridOn).length / 4,
    failed: result.nominal.failedIds?.length ?? 0,
    ...extra,
  };
  const all = readHistory();
  all[date] = entry;
  const keep = Object.keys(all).sort().slice(-KEEP_DAYS);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(Object.fromEntries(keep.map((d) => [d, all[d]]))));
  } catch {
    // Без сховища історія не зберігається.
  }
}

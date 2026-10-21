import { iconFor } from '../icons.js';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('uk-UA');

// «На що йде енергія»: частка кожного вибраного споживача в сумарній потужності.
// Одна серія, тож один колір і підписи значень прямо біля стовпчиків.
export function EnergyBreakdown({ consumers, hours }) {
  const total = consumers.reduce((s, c) => s + c.powerW, 0);
  if (!total) return null;
  const rows = [...consumers].sort((a, b) => b.powerW - a.powerW);
  const max = rows[0].powerW;
  const showRun = Number.isFinite(hours) && hours > 0 && hours < 48;
  return (
    <div className="breakdown">
      <h3>На що йде енергія</h3>
      <p className="hint">
        Разом {fmt(total)} Вт, тобто {fmt(total)} Вт·год щогодини{showRun ? `, а за ${hoursText(hours)} роботи першого джерела — ${fmt(total * hours)} Вт·год` : ''}.
      </p>
      <ul className="breakdown-rows">
        {rows.map((c, i) => {
          const share = (c.powerW / total) * 100;
          return (
            <li key={`${c.name}-${i}`} title={`${c.name}: ${fmt(c.powerW)} Вт, ${share.toFixed(0)}% усього споживання`}>
              <span className="breakdown-name">
                <span aria-hidden="true">{iconFor(c.name)}</span> {c.name}
              </span>
              <span className="breakdown-track">
                <span className="breakdown-bar" style={{ width: `${Math.max(1.5, (c.powerW / max) * 100)}%` }} />
              </span>
              <span className="breakdown-value">
                {fmt(c.powerW)} Вт · <strong>{share < 1 ? '<1' : share.toFixed(0)}%</strong>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Час доби через hours годин від from; оцінка наближена, тож округлюємо до 10 хвилин.
export function clock(from, hours, short = false) {
  const d = new Date(from.getTime() + hours * 3600_000);
  d.setMinutes(Math.round(d.getMinutes() / 10) * 10, 0, 0);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (short || d.toDateString() === from.toDateString()) return t;
  const tomorrow = new Date(from.getTime() + 86400_000).toDateString() === d.toDateString();
  return `${t} ${tomorrow ? 'завтра' : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`}`;
}

export function hoursText(hours) {
  const total = Math.max(0, Math.round((hours * 60) / 10) * 10);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} хв`;
  return m ? `${h} год ${m} хв` : `${h} год`;
}

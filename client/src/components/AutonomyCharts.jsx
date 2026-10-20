import { useRef, useState } from 'react';
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

const W = 640;
const H = 260;
const M = { top: 16, right: 20, bottom: 40, left: 44 };

// «Як розряджається джерело»: залишок заряду станції чи пального генератора від цього моменту.
// Одна вісь у відсотках, наведення показує значення всіх джерел у вибраний момент.
export function DischargeChart({ series }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  if (!series.length) return null;
  const maxHours = Math.min(48, Math.max(...series.map((s) => s.hours)) * 1.08 || 1);
  const step = maxHours <= 6 ? 1 : maxHours <= 12 ? 2 : maxHours <= 24 ? 4 : 8;
  const px = (h) => M.left + (h / maxHours) * (W - M.left - M.right);
  const py = (p) => M.top + (1 - p / 100) * (H - M.top - M.bottom);
  const valueAt = (s, h) => Math.max(0, s.startPct - (s.startPct - s.endPct) * Math.min(1, h / s.hours));
  const now = new Date();

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const h = Math.max(0, Math.min(maxHours, ((x - M.left) / (W - M.left - M.right)) * maxHours));
    setHover(h);
  };

  return (
    <div className="discharge">
      <h3>Як розряджається джерело</h3>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: `var(${s.color})` }} /> {s.name}
          </span>
        ))}
      </div>
      <div className="chart-wrap">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Залишок заряду або пального з часом" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {[0, 25, 50, 75, 100].map((p) => (
            <g key={p}>
              <line className={p === 0 ? 'chart-base' : 'chart-grid'} x1={M.left} x2={W - M.right} y1={py(p)} y2={py(p)} />
              <text className="chart-tick" x={M.left - 8} y={py(p) + 4} textAnchor="end">
                {p}%
              </text>
            </g>
          ))}
          {Array.from({ length: Math.floor(maxHours / step) + 1 }, (_, i) => i * step).map((h) => (
            <text key={h} className="chart-tick" x={px(h)} y={H - M.bottom + 18} textAnchor="middle">
              {clock(now, h, true)}
            </text>
          ))}
          {series.map((s) => (
            <g key={s.name} style={{ color: `var(${s.color})` }}>
              <polyline className="chart-line" points={`${px(0)},${py(s.startPct)} ${px(Math.min(s.hours, maxHours))},${py(valueAt(s, Math.min(s.hours, maxHours)))}`} />
              <circle className="chart-dot" cx={px(0)} cy={py(s.startPct)} r={4.5} />
              {s.hours <= maxHours && <circle className="chart-dot" cx={px(s.hours)} cy={py(s.endPct)} r={4.5} />}
              {s.hours <= maxHours && (
                <text className="chart-label" x={Math.min(px(s.hours), W - M.right - 4)} y={py(s.endPct) - 10} textAnchor="end">
                  до {clock(now, s.hours)}
                </text>
              )}
            </g>
          ))}
          {hover !== null && <line className="chart-cross" x1={px(hover)} x2={px(hover)} y1={M.top} y2={H - M.bottom} />}
          <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" />
        </svg>
        {hover !== null && (
          <div className="chart-tooltip" style={{ left: `${(px(hover) / W) * 100}%` }}>
            <div className="chart-tooltip-time">{clock(now, hover)}</div>
            {series.map((s) => (
              <div key={s.name}>
                <i style={{ background: `var(${s.color})` }} /> {s.name}: <strong>{hover >= s.hours ? 'вичерпано' : `${Math.round(valueAt(s, hover))}%`}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="hint chart-caption">По горизонталі — час доби, якщо світло зникне зараз; по вертикалі — залишок заряду станції або пального в генераторі.</p>
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

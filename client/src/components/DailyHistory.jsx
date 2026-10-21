import { useRef, useState } from 'react';
import { readHistory } from '../history.js';

// Історія по днях місяця (як «Energy Profile» у застосунках інверторів): над нулем — звідки енергія,
// під нулем — куди йде. Дані — підсумки плану кожного дня, збережені в цьому браузері.
const SOURCES = [
  { key: 'solar', label: 'Сонце', color: '--flow-solar' },
  { key: 'grid', label: 'Мережа', color: '--flow-grid' },
  { key: 'generator', label: 'Генератор', color: '--flow-generator' },
  { key: 'discharge', label: 'Розряд станції', color: '--flow-discharge' },
];
const SINKS = [
  { key: 'consumption', label: 'Споживання', color: '--flow-consumption' },
  { key: 'charge', label: 'Заряд станції', color: '--flow-charge' },
];
const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const kwh = (wh) => (wh / 1000).toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function DailyHistory() {
  const today = new Date();
  const [month, setMonth] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const history = readHistory();
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${month.y}-${String(month.m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    return { day: i + 1, date, data: history[date] ?? null };
  });
  const withData = days.filter((d) => d.data);
  const total = (k) => withData.reduce((s, d) => s + d.data[k], 0);
  const supplied = total('solar') + total('grid') + total('generator') + total('discharge');
  const shift = (delta) => setMonth(({ y, m }) => ({ y: m + delta < 0 ? y - 1 : m + delta > 11 ? y + 1 : y, m: (m + delta + 12) % 12 }));

  const W = 640;
  const H = 220;
  const M = { top: 10, right: 6, bottom: 22, left: 40 };
  const plotH = H - M.top - M.bottom;
  const zero = M.top + plotH / 2;
  const top = Math.max(1000, ...withData.map((d) => Math.max(d.data.solar + d.data.grid + d.data.generator + d.data.discharge, d.data.consumption + d.data.charge)));
  const scale = (wh) => (wh / top) * (plotH / 2);
  const band = (W - M.left - M.right) / daysInMonth;
  const barW = Math.max(3, band - 4);

  return (
    <section className="card">
      <h2>Історія по днях</h2>
      <p className="hint">Підсумки плану за кожен день, коли ви відкривали сайт: звідки бралась енергія (над лінією) і на що йшла (під лінією).</p>
      <div className="history-nav">
        <button type="button" className="icon-button" onClick={() => shift(-1)} aria-label="Попередній місяць">
          ‹
        </button>
        <strong>
          {MONTHS[month.m]} {month.y}
        </strong>
        <button type="button" className="icon-button" onClick={() => shift(1)} aria-label="Наступний місяць">
          ›
        </button>
      </div>

      {withData.length === 0 ? (
        <p className="muted">За цей місяць ще немає даних. Історія збирається щодня, коли ви відкриваєте план.</p>
      ) : (
        <>
          <div className="balance-tiles">
            <div className="balance-tile">
              <div className="balance-tile-label">Днів з даними</div>
              <div className="balance-tile-value">{withData.length}</div>
            </div>
            <div className="balance-tile">
              <div className="balance-tile-label">Споживання за місяць</div>
              <div className="balance-tile-value">
                {kwh(total('consumption'))} <span>кВт·год</span>
              </div>
            </div>
            <div className="balance-tile">
              <div className="balance-tile-label">Без світла за графіком</div>
              <div className="balance-tile-value">
                {Math.round(total('outageHours'))} <span>год</span>
              </div>
            </div>
            <div className="balance-tile">
              <div className="balance-tile-label">Покрито власними джерелами</div>
              <div className="balance-tile-value">{supplied ? Math.round(((supplied - total('grid')) / supplied) * 100) : 0}%</div>
            </div>
          </div>
          <div className="chart-legend">
            {[...SOURCES, ...SINKS]
              .filter((s) => total(s.key) > 0)
              .map((s) => (
                <span key={s.key}>
                  <i style={{ background: `var(${s.color})` }} /> {s.label}
                </span>
              ))}
          </div>
          <div className="chart-wrap">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label="Енергобаланс по днях місяця"
              onPointerMove={(e) => {
                const r = svgRef.current.getBoundingClientRect();
                const i = Math.floor((((e.clientX - r.left) / r.width) * W - M.left) / band);
                setHover(i >= 0 && i < daysInMonth && days[i].data ? i : null);
              }}
              onPointerLeave={() => setHover(null)}
            >
              {[-1, 0, 1].map((f) => (
                <g key={f}>
                  <line className={f === 0 ? 'chart-base' : 'chart-grid'} x1={M.left} x2={W - M.right} y1={zero - f * (plotH / 2)} y2={zero - f * (plotH / 2)} />
                  <text className="chart-tick" x={M.left - 6} y={zero - f * (plotH / 2) + 4} textAnchor="end">
                    {kwh(Math.abs(top * f))}
                  </text>
                </g>
              ))}
              {days.map((d, i) => {
                const x = M.left + i * band + (band - barW) / 2;
                let up = zero;
                let down = zero;
                return (
                  <g key={d.date}>
                    {d.data &&
                      SOURCES.map((s) => {
                        const h = scale(d.data[s.key]);
                        if (h < 0.5) return null;
                        up -= h;
                        return <rect key={s.key} x={x} y={up + 1} width={barW} height={Math.max(0, h - 2)} rx={2} style={{ fill: `var(${s.color})` }} />;
                      })}
                    {d.data &&
                      SINKS.map((s) => {
                        const h = scale(d.data[s.key]);
                        if (h < 0.5) return null;
                        const y = down;
                        down += h;
                        return <rect key={s.key} x={x} y={y + 1} width={barW} height={Math.max(0, h - 2)} rx={2} style={{ fill: `var(${s.color})` }} />;
                      })}
                    {(d.day === 1 || d.day % 5 === 0) && (
                      <text className="chart-tick" x={M.left + (i + 0.5) * band} y={H - 6} textAnchor="middle">
                        {d.day}
                      </text>
                    )}
                  </g>
                );
              })}
              {hover !== null && <rect className="balance-hover" x={M.left + hover * band} y={M.top} width={band} height={plotH} />}
            </svg>
            {hover !== null && (
              <div className="chart-tooltip" style={{ left: `${((M.left + (hover + 0.5) * band) / W) * 100}%` }}>
                <div className="chart-tooltip-time">
                  {days[hover].day} {MONTHS_GEN[month.m]}
                </div>
                {[...SOURCES, ...SINKS].map((s) =>
                  days[hover].data[s.key] > 0 ? (
                    <div key={s.key}>
                      <i style={{ background: `var(${s.color})` }} /> {s.label}: <strong>{kwh(days[hover].data[s.key])} кВт·год</strong>
                    </div>
                  ) : null,
                )}
                <div className="muted">Без світла за графіком: {days[hover].data.outageHours} год</div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

import { useRef, useState } from 'react';

// Енергобаланс доби за планом: по годинах, звідки береться енергія (над нулем) і куди йде (під нулем),
// і підсумок за добу. Як у застосунках інверторів, але за розрахунком плану, а не за вимірюваннями.
const SLOT_H = 0.25;
const kwh = (wh) => wh / 1000;
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toLocaleString('uk-UA', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

// Порядок у стовпчику знизу вгору; кольори закріплені за потоком енергії.
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

export default function EnergyBalance({ result }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const hours = hourlyBalance(result.nominal.trace);
  const total = (k) => hours.reduce((s, h) => s + h[k], 0);
  const totals = Object.fromEntries([...SOURCES, ...SINKS, { key: 'shortage' }].map((s) => [s.key, total(s.key)]));
  const consumption = totals.consumption;
  const supplied = totals.solar + totals.grid + totals.generator + totals.discharge;
  const ownShare = supplied > 0 ? ((supplied - totals.grid) / supplied) * 100 : 0;
  const hasData = supplied > 0;

  // Симетрична шкала, щоб нуль був посередині, а висота стовпчиків порівнювалась чесно.
  const maxUp = Math.max(...hours.map((h) => h.solar + h.grid + h.generator + h.discharge));
  const maxDown = Math.max(...hours.map((h) => h.consumption + h.charge));
  const top = niceMax(Math.max(maxUp, maxDown, 1));
  const W = 640;
  const H = 260;
  const M = { top: 12, right: 8, bottom: 26, left: 46 };
  const plotH = H - M.top - M.bottom;
  const zero = M.top + plotH / 2;
  const scale = (wh) => (wh / top) * (plotH / 2);
  const band = (W - M.left - M.right) / 24;
  const barW = Math.max(6, band - 6);
  const visible = (list) => list.filter((s) => totals[s.key] > 0.5);

  return (
    <section className="card energy-balance">
      <h2>Енергобаланс доби</h2>
      <p className="hint">
        Звідки ваш дім братиме електроенергію протягом доби і на що вона піде, якщо дотримуватися плану. Тут видно, коли станція заряджається від мережі, а коли
        сама живить прилади під час відключення, і скільки енергії за день дадуть власні джерела.
      </p>
      <ul className="balance-howto">
        <li>
          <strong>Над лінією</strong> — звідки енергія: мережа, станція, генератор, сонце.
        </li>
        <li>
          <strong>Під лінією</strong> — куди вона йде: на прилади або на заряд станції.
        </li>
        <li>Кожен стовпчик — година; ті, що вже минули, бліді. Наведіть на стовпчик, щоб побачити кВт·год.</li>
      </ul>

      {!hasData ? (
        <p className="muted">Немає даних для розрахунку.</p>
      ) : (
        <>
          <div className="balance-tiles">
            <Tile label="Споживання" value={kwh(consumption)} />
            <Tile label="З мережі" value={kwh(totals.grid)} />
            {totals.solar > 0.5 && <Tile label="Від сонця" value={kwh(totals.solar)} />}
            {totals.generator > 0.5 && <Tile label="Від генератора" value={kwh(totals.generator)} />}
            {totals.charge > 0.5 && <Tile label="Заряджено станцію" value={kwh(totals.charge)} />}
            {totals.discharge > 0.5 && <Tile label="Віддала станція" value={kwh(totals.discharge)} />}
            {totals.shortage > 0.5 && <Tile label="Не вистачило" value={kwh(totals.shortage)} warn />}
          </div>

          <div className="chart-legend">
            {[...visible(SOURCES), ...visible(SINKS)].map((s) => (
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
              aria-label="Енергобаланс по годинах"
              onPointerMove={(e) => {
                const r = svgRef.current.getBoundingClientRect();
                const i = Math.floor((((e.clientX - r.left) / r.width) * W - M.left) / band);
                setHover(i >= 0 && i < 24 ? i : null);
              }}
              onPointerLeave={() => setHover(null)}
            >
              {[-1, -0.5, 0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line className={f === 0 ? 'chart-base' : 'chart-grid'} x1={M.left} x2={W - M.right} y1={zero - f * (plotH / 2)} y2={zero - f * (plotH / 2)} />
                  <text className="chart-tick" x={M.left - 6} y={zero - f * (plotH / 2) + 4} textAnchor="end">
                    {fmt(Math.abs(kwh(top * f)), Number.isInteger(Math.abs(kwh(top * f))) ? 0 : 1)}
                  </text>
                </g>
              ))}
              {hours.map((h, i) => {
                const x = M.left + i * band + (band - barW) / 2;
                let up = zero;
                let down = zero;
                return (
                  <g key={h.hour} className={h.planned ? '' : 'balance-past'}>
                    {SOURCES.map((s) => {
                      const height = scale(h[s.key]);
                      if (height < 0.5) return null;
                      up -= height;
                      return <rect key={s.key} x={x} y={up + 1} width={barW} height={Math.max(0, height - 2)} rx={2} style={{ fill: `var(${s.color})` }} />;
                    })}
                    {SINKS.map((s) => {
                      const height = scale(h[s.key]);
                      if (height < 0.5) return null;
                      const y = down;
                      down += height;
                      return <rect key={s.key} x={x} y={y + 1} width={barW} height={Math.max(0, height - 2)} rx={2} style={{ fill: `var(${s.color})` }} />;
                    })}
                    {i % 3 === 0 && (
                      <text className="chart-tick" x={M.left + i * band + band / 2} y={H - 8} textAnchor="middle">
                        {String(h.hour).padStart(2, '0')}
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
                  {String(hover).padStart(2, '0')}:00–{String(hover + 1).padStart(2, '0')}:00
                </div>
                {[...SOURCES, ...SINKS].map((s) =>
                  hours[hover][s.key] > 0.5 ? (
                    <div key={s.key}>
                      <i style={{ background: `var(${s.color})` }} /> {s.label}: <strong>{fmt(kwh(hours[hover][s.key]), 2)} кВт·год</strong>
                    </div>
                  ) : null,
                )}
                {hours[hover].shortage > 0.5 && <div>Не вистачило: {fmt(kwh(hours[hover].shortage), 2)} кВт·год</div>}
              </div>
            )}
          </div>

          <div className="balance-share">
            <div className="balance-share-head">
              <span>Звідки енергія за добу</span>
              <strong>{fmt(kwh(supplied))} кВт·год</strong>
            </div>
            <ShareBar parts={visible(SOURCES).map((s) => ({ ...s, value: totals[s.key] }))} total={supplied} />
            <p className="hint">
              Власними джерелами (станція, сонце, генератор) покрито <strong>{Math.round(ownShare)}%</strong> енергії доби.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, warn }) {
  return (
    <div className={`balance-tile ${warn ? 'warn' : ''}`}>
      <div className="balance-tile-label">{label}</div>
      <div className="balance-tile-value">
        {fmt(value, 1)} <span>кВт·год</span>
      </div>
    </div>
  );
}

function ShareBar({ parts, total }) {
  return (
    <>
      <div className="share-bar" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: `var(${p.color})` }} />
        ))}
      </div>
      <div className="share-labels">
        {parts.map((p) => (
          <span key={p.key}>
            <i style={{ background: `var(${p.color})` }} /> {p.label} <strong>{Math.round((p.value / total) * 100)}%</strong> · {fmt(kwh(p.value), 1)} кВт·год
          </span>
        ))}
      </div>
    </>
  );
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

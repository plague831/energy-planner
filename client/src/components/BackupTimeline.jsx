import { useRef, useState } from 'react';
import { simulateBackup } from '@energy-planner/core/autonomy';
import { clock, hoursText } from './AutonomyCharts.jsx';

// «Якщо світло зникне зараз»: по годинах видно, яке джерело живить дім, і коли енергії перестане вистачати.
// Кольори потоків ті самі, що в енергобалансі доби на «Сьогодні».
const FLOWS = [
  { key: 'solarW', label: 'Сонце', color: '--flow-solar' },
  { key: 'batteryW', label: 'Станція', color: '--flow-discharge' },
  { key: 'generatorW', label: 'Генератор', color: '--flow-generator' },
];
const PHASE_TEXT = { battery: 'працює від станції', generator: 'працює від генератора', solar: 'працює від сонця', none: 'енергії немає' };
const PHASE_COLOR = { battery: '--flow-discharge', generator: '--flow-generator', solar: '--flow-solar', none: '--bad' };

export default function BackupTimeline({ sources, consumers }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const loadW = consumers.reduce((s, c) => s + c.powerW, 0);
  const now = new Date();
  const startMinute = now.getHours() * 60 + now.getMinutes();
  const sim = simulateBackup({
    batteries: sources.filter((s) => s.kind === 'battery').map((s) => ({ capacityWh: s.capacityWh, socPct: s.initialSocPct ?? 100, minSocPct: s.minSocPct ?? 10, inverterMaxW: s.inverterMaxW })),
    generators: sources.filter((s) => s.kind === 'generator'),
    solar: sources.filter((s) => s.kind === 'solar'),
    loadW,
    startMinute,
  });
  if (!loadW || !sim.steps.length) return null;

  // Години від «зараз»: по 4 кроки по 15 хв.
  const hours = [];
  for (let i = 0; i < sim.steps.length; i += 4) {
    const chunk = sim.steps.slice(i, i + 4);
    const sum = (k) => chunk.reduce((s, x) => s + x[k] * 0.25, 0);
    const lastStep = chunk.at(-1);
    hours.push({ offset: i / 4, solarW: sum('solarW'), batteryW: sum('batteryW'), generatorW: sum('generatorW'), shortageW: sum('shortageW'), socPct: lastStep.socPct, fuelPct: lastStep.fuelPct });
  }

  const W = 640;
  const H = 230;
  const M = { top: 12, right: 8, bottom: 26, left: 40 };
  const plotH = H - M.top - M.bottom;
  const band = (W - M.left - M.right) / hours.length;
  const barW = Math.max(3, band - Math.min(6, band * 0.3));
  const top = loadW; // кожна година — це повне навантаження: живлення від джерел плюс нестача
  const y = (wh) => (wh / top) * plotH;
  const labelEvery = Math.ceil(hours.length / 8);
  const shownFlows = FLOWS.filter((f) => hours.some((h) => h[f.key] > 0.5));
  const hasShortage = hours.some((h) => h.shortageW > 0.5);

  return (
    <div className="backup-timeline">
      <h3>Хто живитиме дім, якщо світло зникне зараз</h3>
      <Headline sim={sim} now={now} consumers={consumers} />

      <div className="phase-strip" aria-hidden="true">
        {sim.phases.map((p) => (
          <span
            key={p.fromHour}
            className="phase-bar"
            style={{ flexGrow: p.toHour - p.fromHour, background: p.kind === 'none' ? undefined : `var(${PHASE_COLOR[p.kind]})` }}
            data-none={p.kind === 'none' || undefined}
          />
        ))}
      </div>
      <ol className="phase-list">
        {sim.phases.map((p) => (
          <li key={p.fromHour}>
            <i
              className={p.kind === 'none' ? 'swatch-shortage' : undefined}
              style={p.kind === 'none' ? undefined : { background: `var(${PHASE_COLOR[p.kind]})` }}
            />
            <span className="phase-time">
              {clock(now, p.fromHour)} – {p.toHour >= 48 ? '…' : clock(now, p.toHour)}
            </span>{' '}
            {PHASE_TEXT[p.kind]} ({hoursText(p.toHour - p.fromHour)})
          </li>
        ))}
      </ol>

      <div className="chart-legend">
        {shownFlows.map((f) => (
          <span key={f.key}>
            <i style={{ background: `var(${f.color})` }} /> {f.label}
          </span>
        ))}
        {hasShortage && (
          <span>
            <i className="swatch-shortage" /> Не вистачає енергії
          </span>
        )}
      </div>

      <div className="chart-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Живлення дому по годинах після відключення"
          onPointerMove={(e) => {
            const r = svgRef.current.getBoundingClientRect();
            const i = Math.floor((((e.clientX - r.left) / r.width) * W - M.left) / band);
            setHover(i >= 0 && i < hours.length ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <pattern id="shortage-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="shortage-line" />
            </pattern>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line className={f === 0 ? 'chart-base' : 'chart-grid'} x1={M.left} x2={W - M.right} y1={M.top + plotH - f * plotH} y2={M.top + plotH - f * plotH} />
              <text className="chart-tick" x={M.left - 6} y={M.top + plotH - f * plotH + 4} textAnchor="end">
                {f * 100}%
              </text>
            </g>
          ))}
          {hours.map((h, i) => {
            const x = M.left + i * band + (band - barW) / 2;
            let base = M.top + plotH;
            const rects = [...FLOWS, { key: 'shortageW', shortage: true }].map((f) => {
              const height = y(h[f.key]);
              if (height < 0.5) return null;
              base -= height;
              return (
                <rect
                  key={f.key}
                  x={x}
                  y={base + 1}
                  width={barW}
                  height={Math.max(0, height - 2)}
                  rx={2}
                  className={f.shortage ? 'shortage-bar' : undefined}
                  style={f.shortage ? undefined : { fill: `var(${f.color})` }}
                />
              );
            });
            return (
              <g key={h.offset}>
                {rects}
                {i % labelEvery === 0 && (
                  <text className="chart-tick" x={M.left + (i + 0.5) * band} y={H - 8} textAnchor="middle">
                    {clock(now, h.offset, true)}
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
              {clock(now, hours[hover].offset)}–{clock(now, hours[hover].offset + 1)}
            </div>
            {FLOWS.map((f) =>
              hours[hover][f.key] > 0.5 ? (
                <div key={f.key}>
                  <i style={{ background: `var(${f.color})` }} /> {f.label}: <strong>{Math.round((hours[hover][f.key] / loadW) * 100)}%</strong> потреби
                </div>
              ) : null,
            )}
            {hours[hover].shortageW > 0.5 && (
              <div>
                <i className="swatch-shortage" /> Не вистачає: <strong>{Math.round((hours[hover].shortageW / loadW) * 100)}%</strong>
              </div>
            )}
            {hours[hover].socPct !== null && <div className="muted">Заряд станції: {Math.round(hours[hover].socPct)}%</div>}
            {hours[hover].fuelPct.map((f, k) => (
              <div key={k} className="muted">
                Пальне{hours[hover].fuelPct.length > 1 ? ` (генератор ${k + 1})` : ''}: {Math.round(f)}%
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="hint chart-caption">
        Кожен стовпчик — одна година. Висота 100% — уся потреба вибраних приладів ({loadW.toLocaleString('uk-UA')} Вт); колір показує, яке джерело її покриває, а штриховка — частку, на яку енергії не вистачає.
      </p>
    </div>
  );
}

function Headline({ sim, now, consumers }) {
  const what = consumers.length === 1 ? consumers[0].name.toLowerCase() : `усе вибране (${consumers.length} шт.)`;
  if (sim.fullHours === null) {
    return <p className="backup-headline">Енергії вистачить на {what} щонайменше на {hoursText(sim.steps.length / 4)}, до {clock(now, sim.steps.length / 4)}.</p>;
  }
  if (sim.fullHours === 0) {
    return <p className="backup-headline bad">Джерела не витягнуть {what} навіть зараз: потрібно більше потужності. Зніміть частину приладів.</p>;
  }
  return (
    <p className="backup-headline">
      Усе вибране працюватиме <strong>{hoursText(sim.fullHours)}</strong>, до <strong>{clock(now, sim.fullHours)}</strong>
      {sim.lastHours !== null && sim.lastHours > sim.fullHours + 0.25 ? `; частково — до ${clock(now, sim.lastHours)}` : ''}.
    </p>
  );
}

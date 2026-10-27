const SLOTS = 96;
const SLOT_W = 10;
const LABEL_W = 190;
const RIGHT_PAD = 16;
const ROW_H = 36;
const CHART_H = 110;
const WIDTH = LABEL_W + SLOTS * SLOT_W + RIGHT_PAD;
const CHAR_W = 8; // приблизна ширина символу підпису (14px), щоб підписи не налазили один на одного

// Часова діаграма плану: світло за графіком, запуски приладів, генератор, сонце і заряд станції протягом доби.
// nowSlot (необов'язково) — позначка «зараз» для плану на сьогодні.
export default function Timeline({ result, household, nowSlot = null }) {
  const trace = result.nominal.trace;
  const failed = new Set(result.nominal.failedIds);
  const rows = result.schedule;
  const top = 30;
  const gridRowY = top;
  const appliancesY = gridRowY + ROW_H + 8;
  const hasGenerator = (result.generators ?? []).length > 0;
  const hasSolar = trace.some((t) => (t.solarW ?? 0) > 0);
  const extraY = appliancesY + rows.length * ROW_H;
  const generatorY = extraY;
  const solarY = extraY + (hasGenerator ? ROW_H : 0);
  const maxSolar = Math.max(1, ...trace.map((t) => t.solarW ?? 0));
  const chartY = extraY + (hasGenerator ? ROW_H : 0) + (hasSolar ? ROW_H : 0) + 20;
  const capacity = household.battery?.capacityWh;
  const height = chartY + (capacity ? CHART_H + 28 : 0);
  const outageRuns = runs(trace.map((t) => !t.gridOn));
  const genRuns = mergeClose(runs(trace.map((t) => (t.generatorW ?? 0) > 0)), 2);
  const possible = (household.possibleOutages ?? []).map((o) => [toSlot(o.from), toSlot(o.to)]);
  const minSoc = household.battery?.minSocPct ?? 10;
  const socY = (pct) => chartY + CHART_H - (pct / 100) * (CHART_H - 4);

  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Часова діаграма плану на добу">
        <defs>
          <pattern id="possible-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" className="grid-possible-bg" />
            <line x1="0" y1="0" x2="0" y2="8" className="grid-possible-line" />
          </pattern>
        </defs>

        {Array.from({ length: 25 }, (_, h) => (
          <g key={h}>
            <line className="tick" x1={x(h * 4)} x2={x(h * 4)} y1={top - 4} y2={height - 24} />
            {h % 2 === 0 && (
              <text className="axis" x={x(h * 4)} y={18} textAnchor={h === 24 ? 'end' : h === 0 ? 'start' : 'middle'}>
                {String(h).padStart(2, '0')}
              </text>
            )}
          </g>
        ))}

        <text className="row-label" x={8} y={gridRowY + 23}>
          Світло за графіком
        </text>
        <rect className="grid-on" x={x(0)} y={gridRowY + 4} width={SLOTS * SLOT_W} height={ROW_H - 8} rx={4} />
        {outageRuns.map(([from, to]) => (
          <rect key={from} className="grid-off" x={x(from)} y={gridRowY + 4} width={(to - from) * SLOT_W} height={ROW_H - 8} rx={4}>
            <title>
              Відключення {slotTime(from)}–{slotTime(to)}
            </title>
          </rect>
        ))}
        {possible.map(([from, to]) => (
          <rect key={`p${from}`} className="grid-possible" x={x(from)} y={gridRowY + 4} width={(to - from) * SLOT_W} height={ROW_H - 8} rx={4}>
            <title>
              Можливе відключення {slotTime(from)}–{slotTime(to)}
            </title>
          </rect>
        ))}

        {rows.map((r, i) => {
          const y = appliancesY + i * ROW_H;
          const text = r.skipped ? null : `${r.start}–${r.end}`;
          return (
            <g key={r.id}>
              <text className="row-label" x={8} y={y + 23}>
                {r.name}
              </text>
              {outageRuns.map(([from, to]) => (
                <rect key={from} className="outage-shade" x={x(from)} y={y + 2} width={(to - from) * SLOT_W} height={ROW_H - 4} />
              ))}
              {r.skipped ? (
                <text className="skipped" x={x(0) + 6} y={y + 23}>
                  {r.missed ? 'час для нього вже минув' : 'сьогодні краще не вмикати'}
                </text>
              ) : (
                <g>
                  <rect className={failed.has(r.id) ? 'bar bar-failed' : 'bar'} x={x(r.startSlot)} y={y + 5} width={(r.endSlot - r.startSlot) * SLOT_W} height={ROW_H - 10} rx={4}>
                    <title>
                      {r.name}: {text}
                      {failed.has(r.id) ? ' — може не відпрацювати' : ''}
                    </title>
                  </rect>
                  <BarLabel from={r.startSlot} to={r.endSlot} y={y + 23} text={text} />
                </g>
              )}
            </g>
          );
        })}

        {hasGenerator && (
          <g>
            <text className="row-label" x={8} y={generatorY + 23}>
              Генератор
            </text>
            {genRuns.map(([from, to], k) => (
              <g key={`g${from}`}>
                <rect className="bar bar-generator" x={x(from)} y={generatorY + 5} width={(to - from) * SLOT_W} height={ROW_H - 10} rx={4}>
                  <title>
                    Генератор {slotTime(from)}–{slotTime(to)}
                  </title>
                </rect>
                <BarLabel from={from} to={to} y={generatorY + 23} text={`${slotTime(from)}–${slotTime(to)}`} limit={genRuns[k + 1]?.[0]} />
              </g>
            ))}
            {!genRuns.length && (
              <text className="skipped" x={x(0) + 6} y={generatorY + 23}>
                сьогодні не знадобиться
              </text>
            )}
          </g>
        )}

        {hasSolar && (
          <g>
            <text className="row-label" x={8} y={solarY + 23}>
              Сонце
            </text>
            {trace.map((t, i) =>
              (t.solarW ?? 0) > 0 ? (
                <rect key={`s${i}`} className="bar-solar" x={x(i)} y={solarY + 5 + (ROW_H - 10) * (1 - t.solarW / maxSolar)} width={SLOT_W} height={(ROW_H - 10) * (t.solarW / maxSolar)}>
                  <title>
                    {slotTime(i)}: сонце {Math.round(t.solarW)} Вт
                  </title>
                </rect>
              ) : null,
            )}
            <text className="axis" x={x(SLOTS) - 4} y={solarY + 23} textAnchor="end">
              до {Math.round(maxSolar).toLocaleString('uk-UA')} Вт
            </text>
          </g>
        )}

        {capacity && (
          <g>
            <text className="row-label" x={8} y={chartY + 18}>
              Заряд станції
            </text>
            {[100, 50, 0].map((p) => (
              <g key={p}>
                <line className={p === 0 ? 'tick strong' : 'tick'} x1={x(0)} x2={x(SLOTS)} y1={socY(p)} y2={socY(p)} />
                <text className="axis" x={x(0) - 6} y={socY(p) + 5} textAnchor="end">
                  {p}%
                </text>
              </g>
            ))}
            <line className="soc-min" x1={x(0)} x2={x(SLOTS)} y1={socY(minSoc)} y2={socY(minSoc)} />
            <text className="axis soc-min-label" x={x(SLOTS) - 4} y={socY(minSoc) - 5} textAnchor="end">
              мінімум {minSoc}%
            </text>
            <polygon
              className="soc-area"
              points={`${x(0)},${socY(0)} ${trace.map((t, i) => `${x(i + 1)},${socY((t.energyWh / capacity) * 100)}`).join(' ')} ${x(trace.length)},${socY(0)}`}
            />
            <polyline className="soc-line" points={trace.map((t, i) => `${x(i + 1)},${socY((t.energyWh / capacity) * 100)}`).join(' ')} />
          </g>
        )}

        {nowSlot !== null && (
          <g className="now-line">
            <line x1={x(nowSlot)} x2={x(nowSlot)} y1={top - 4} y2={height - 24} />
            <text x={x(nowSlot)} y={height - 8} textAnchor="middle">
              зараз
            </text>
          </g>
        )}
      </svg>
      <div className="timeline-legend">
        <span>
          <i className="lg-grid-on" /> світло є
        </span>
        <span>
          <i className="lg-grid-off" /> відключення
        </span>
        <span>
          <i className="lg-bar" /> прилад працює
        </span>
        <span>
          <i className="lg-failed" /> може не відпрацювати
        </span>
        {hasGenerator && (
          <span>
            <i className="lg-generator" /> генератор
          </span>
        )}
        {hasSolar && (
          <span>
            <i className="lg-solar" /> сонце
          </span>
        )}
        {capacity && (
          <span>
            <i className="lg-soc" /> заряд станції
          </span>
        )}
      </div>
    </div>
  );
}

// Підпис часу біля смуги: всередині, якщо вміщується; праворуч, якщо є місце до наступної смуги
// й до краю; інакше ліворуч від смуги.
function BarLabel({ from, to, y, text, limit }) {
  const w = text.length * CHAR_W;
  const barW = (to - from) * SLOT_W;
  if (barW >= w + 10) {
    return (
      <text className="bar-label inside" x={x(from) + barW / 2} y={y} textAnchor="middle">
        {text}
      </text>
    );
  }
  const rightEdge = limit !== undefined ? x(limit) - 6 : WIDTH - 4;
  if (x(to) + 6 + w <= rightEdge) {
    return (
      <text className="bar-label" x={x(to) + 6} y={y}>
        {text}
      </text>
    );
  }
  if (x(from) - 6 - w >= LABEL_W) {
    return (
      <text className="bar-label" x={x(from) - 6} y={y} textAnchor="end">
        {text}
      </text>
    );
  }
  return null;
}

// Об'єднує відрізки з проміжком не більше gap слотів (короткі перерви генератора — це одне вмикання).
function mergeClose(list, gap) {
  const out = [];
  for (const [from, to] of list) {
    const last = out.at(-1);
    if (last && from - last[1] <= gap) last[1] = to;
    else out.push([from, to]);
  }
  return out;
}

function toSlot(time) {
  const [h, m] = time.split(':').map(Number);
  return Math.round((h * 60 + m) / 15);
}

function slotTime(slot) {
  const m = slot * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function x(slot) {
  return LABEL_W + slot * SLOT_W;
}

// Неперервні відрізки, де flags[t] істинне: [[from, to), ...].
function runs(flags) {
  const out = [];
  let start = null;
  flags.forEach((f, t) => {
    if (f && start === null) start = t;
    if (!f && start !== null) {
      out.push([start, t]);
      start = null;
    }
  });
  if (start !== null) out.push([start, flags.length]);
  return out;
}

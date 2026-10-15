const SLOTS = 96;
const SLOT_W = 10;
const LABEL_W = 210;
const ROW_H = 36;
const CHART_H = 110;
const WIDTH = LABEL_W + SLOTS * SLOT_W;

// Часова діаграма плану: світло за графіком, запуски приладів і заряд станції протягом доби.
export default function Timeline({ result, household }) {
  const trace = result.nominal.trace;
  const failed = new Set(result.nominal.failedIds);
  const rows = result.schedule;
  const top = 30;
  const gridRowY = top;
  const appliancesY = gridRowY + ROW_H + 8;
  const chartY = appliancesY + rows.length * ROW_H + 16;
  const height = chartY + (household.battery ? CHART_H + 24 : 0);

  const outageRuns = runs(trace.map((t) => !t.gridOn));
  const capacity = household.battery?.capacityWh;
  // Можливі відключення з YASNO: показуються штриховкою, але в розрахунку плану не враховуються.
  const possible = (household.possibleOutages ?? []).map((o) => [toSlot(o.from), toSlot(o.to)]);

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
            <line className="tick" x1={x(h * 4)} x2={x(h * 4)} y1={top - 4} y2={height - 20} />
            {h % 2 === 0 && (
              <text className="axis" x={x(h * 4)} y={18} textAnchor="middle">
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
          <rect key={from} className="grid-off" x={x(from)} y={gridRowY + 4} width={(to - from) * SLOT_W} height={ROW_H - 8} rx={4} />
        ))}

        {possible.map(([from, to]) => (
          <rect key={`p${from}`} className="grid-possible" x={x(from)} y={gridRowY + 4} width={(to - from) * SLOT_W} height={ROW_H - 8} rx={4} />
        ))}

        {rows.map((r, i) => {
          const y = appliancesY + i * ROW_H;
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
                  не вмикати сьогодні
                </text>
              ) : (
                <g>
                  <rect
                    className={failed.has(r.id) ? 'bar bar-failed' : 'bar'}
                    x={x(r.startSlot)}
                    y={y + 5}
                    width={(r.endSlot - r.startSlot) * SLOT_W}
                    height={ROW_H - 10}
                    rx={4}
                  />
                  <text className="bar-label" x={x(r.endSlot) + 6} y={y + 23}>
                    {r.start}–{r.end}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {capacity && (
          <g>
            <text className="row-label" x={8} y={chartY + 16}>
              Заряд станції
            </text>
            <text className="axis" x={LABEL_W - 8} y={chartY + 8} textAnchor="end">
              100%
            </text>
            <text className="axis" x={LABEL_W - 8} y={chartY + CHART_H} textAnchor="end">
              0%
            </text>
            <line className="tick" x1={x(0)} x2={x(SLOTS)} y1={chartY + CHART_H} y2={chartY + CHART_H} />
            <polyline
              className="soc-line"
              points={trace
                .map((t, i) => `${x(i + 1)},${chartY + CHART_H - (t.energyWh / capacity) * (CHART_H - 4)}`)
                .join(' ')}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

function toSlot(time) {
  const [h, m] = time.split(':').map(Number);
  return Math.round((h * 60 + m) / 15);
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

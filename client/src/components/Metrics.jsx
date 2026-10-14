const pct = (v) => `${(v * 100).toFixed(1)}%`;

export default function Metrics({ result }) {
  const r = result.robustness;
  const items = [
    { label: 'Ймовірність, що прилад не відпрацює', value: pct(r.failureProbability), tone: tone(r.failureProbability) },
    { label: 'Ймовірність вимкнути постійні навантаження', value: pct(r.shedProbability), tone: tone(r.shedProbability) },
    { label: 'Середній штраф на сценаріях', value: r.meanCost.toFixed(1) },
    { label: 'Штраф у 10% найгірших випадків', value: r.cvarCost.toFixed(1) },
    { label: 'Мінімальний заряд (найгірший сценарій)', value: r.worstMinSocPct === null ? '—' : `${r.worstMinSocPct.toFixed(0)}%` },
    { label: 'Час розрахунку', value: `${result.elapsedMs.toFixed(0)} мс` },
  ];
  return (
    <div className="metrics">
      {items.map((m) => (
        <div key={m.label} className={`metric ${m.tone ?? ''}`}>
          <div className="metric-value">{m.value}</div>
          <div className="metric-label">{m.label}</div>
        </div>
      ))}
      <p className="hint metrics-note">
        Оцінка на {r.scenarios} випадкових сценаріях, де відключення починаються й закінчуються раніше чи пізніше за графік.
      </p>
    </div>
  );
}

function tone(p) {
  if (p < 0.1) return 'good';
  if (p < 0.4) return 'warn';
  return 'bad';
}

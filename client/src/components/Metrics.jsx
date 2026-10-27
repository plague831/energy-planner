const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

// Надійність плану: як він поводиться, якщо відключення зсуваються відносно графіка.
export default function Metrics({ result }) {
  const r = result.robustness;
  const items = [
    { label: 'Шанс, що якийсь прилад не відпрацює до кінця', value: pct(r.failureProbability), tone: tone(r.failureProbability) },
    { label: 'Шанс, що доведеться вимкнути холодильник чи інше постійне', value: pct(r.shedProbability), tone: tone(r.shedProbability) },
    { label: 'Найнижчий заряд станції в найгіршому випадку', value: r.worstMinSocPct === null ? '—' : `${r.worstMinSocPct.toFixed(0)}%` },
    { label: 'Середній «штраф» плану', value: r.meanCost.toFixed(1).replace('.', ',') },
    { label: '«Штраф» у 10% найгірших випадків', value: r.cvarCost.toFixed(1).replace('.', ',') },
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
        Перевірено на {r.scenarios} варіантах доби, де відключення починаються й закінчуються раніше чи пізніше за графік. «Штраф» — умовні бали
        незручності: кожна година без постійного приладу дає стільки балів, який у нього пріоритет, прилад, що не відпрацював, — 10 × пріоритет, а зсув
        від бажаного часу — 0,3 × пріоритет за годину. Що менше, то краще.
      </p>
    </div>
  );
}

function tone(p) {
  if (p < 0.1) return 'good';
  if (p < 0.4) return 'warn';
  return 'bad';
}

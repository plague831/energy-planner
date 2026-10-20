import Timeline from '../components/Timeline.jsx';
import Metrics from '../components/Metrics.jsx';
import Comparison from '../components/Comparison.jsx';

// «Детально»: метод планування, діаграма доби, показники надійності й порівняння методів —
// для тих, хто хоче розібратися глибше.
export default function Details({ household, result, comparison, algorithms, algorithm, onAlgorithm, busy, error, onPlan, onCompare, onReset, canReset }) {
  return (
    <div className="page-stack">
      <section className="card controls">
        <label className="field">
          <span>Метод планування</span>
          <select value={algorithm} onChange={(e) => onAlgorithm(e.target.value)}>
            {algorithms.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="buttons">
          <button type="button" onClick={onPlan} disabled={busy}>
            {busy ? 'Рахую…' : 'Перерахувати план'}
          </button>
          <button type="button" className="secondary" onClick={onCompare} disabled={busy}>
            Порівняти всі методи
          </button>
          <button type="button" className="secondary" onClick={onReset} disabled={busy || !canReset}>
            Скинути до прикладу
          </button>
        </div>
        <p className="hint">
          За замовчуванням використовується стійкий генетичний алгоритм: він враховує, що відключення можуть початися раніше чи закінчитися пізніше за
          графік.
        </p>
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <section className="card">
          <h2>Діаграма доби</h2>
          <p className="hint">{result.algorithmName}</p>
          <Timeline result={result} household={household} />
          <h3 className="timeline-title">Надійність плану</h3>
          <Metrics result={result} />
        </section>
      )}

      {comparison && (
        <section className="card no-print">
          <h2>Порівняння методів</h2>
          <Comparison rows={comparison} />
        </section>
      )}
    </div>
  );
}

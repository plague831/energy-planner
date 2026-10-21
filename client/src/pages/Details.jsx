import Timeline from '../components/Timeline.jsx';
import Metrics from '../components/Metrics.jsx';
import Comparison from '../components/Comparison.jsx';
import { summarize, eventsToCsv } from '../actual.js';
import DailyHistory from '../components/DailyHistory.jsx';

// «Детально»: метод планування, діаграма доби, показники надійності й порівняння методів —
// для тих, хто хоче розібратися глибше.
export default function Details({ household, result, comparison, algorithms, algorithm, onAlgorithm, busy, error, onPlan, onCompare, onReset, canReset, events = [], onClearEvents }) {
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

      <DailyHistory />

      <Observations events={events} onClear={onClearEvents} />

      {comparison && (
        <section className="card no-print">
          <h2>Порівняння методів</h2>
          <Comparison rows={comparison} />
        </section>
      )}
    </div>
  );
}

const fmtDev = (m) => (m === null ? 'поза графіком' : m === 0 ? 'точно за графіком' : `на ${Math.abs(Math.round(m))} хв ${m > 0 ? 'пізніше' : 'раніше'}`);

// Спостереження «світло зникло / повернулось»: наскільки реальність розходиться з графіком.
// Ці дані можна вивантажити в CSV і використати для оцінки моделі невизначеності.
function Observations({ events, onClear }) {
  const s = summarize(events);
  const download = () => {
    const url = URL.createObjectURL(new Blob([eventsToCsv(events)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'observations.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="card">
      <h2>Ваші спостереження</h2>
      <p className="hint">
        Щоразу, коли ви натискаєте «Світла немає» або «Світло вже є» на екрані «Сьогодні», тут зберігається, наскільки реальність розійшлася з
        графіком.
      </p>
      {s.total === 0 ? (
        <p className="muted">Поки немає жодного спостереження.</p>
      ) : (
        <>
          <div className="balance-tiles">
            <div className="balance-tile">
              <div className="balance-tile-label">Спостережень</div>
              <div className="balance-tile-value">{s.total}</div>
            </div>
            {s.offAvg !== null && (
              <div className="balance-tile">
                <div className="balance-tile-label">Світло зникає в середньому</div>
                <div className="balance-tile-value">{fmtDev(s.offAvg)}</div>
              </div>
            )}
            {s.onAvg !== null && (
              <div className="balance-tile">
                <div className="balance-tile-label">Світло повертається в середньому</div>
                <div className="balance-tile-value">{fmtDev(s.onAvg)}</div>
              </div>
            )}
            {s.unscheduled > 0 && (
              <div className="balance-tile warn">
                <div className="balance-tile-label">Відключень поза графіком</div>
                <div className="balance-tile-value">{s.unscheduled}</div>
              </div>
            )}
          </div>
          <table className="observations">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Час</th>
                <th>Подія</th>
                <th>Відносно графіка</th>
              </tr>
            </thead>
            <tbody>
              {events
                .slice(-10)
                .reverse()
                .map((e, i) => (
                  <tr key={`${e.date}-${e.time}-${i}`}>
                    <td>{e.date.slice(8, 10)}.{e.date.slice(5, 7)}</td>
                    <td>{e.time}</td>
                    <td>{e.type === 'off' ? '🌑 зникло' : '💡 повернулось'}</td>
                    <td>{fmtDev(e.deviationMin)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="buttons">
            <button type="button" className="secondary" onClick={download}>
              Завантажити всі (CSV)
            </button>
            <button type="button" className="secondary" onClick={() => window.confirm('Видалити всі спостереження?') && onClear()}>
              Очистити
            </button>
          </div>
        </>
      )}
    </section>
  );
}

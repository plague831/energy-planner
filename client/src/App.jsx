import { useEffect, useState } from 'react';
import { getDefaults, getAlgorithms, buildPlan } from './api.js';
import HouseholdForm from './components/HouseholdForm.jsx';
import Timeline from './components/Timeline.jsx';
import Metrics from './components/Metrics.jsx';
import Comparison from './components/Comparison.jsx';
import Autonomy from './components/Autonomy.jsx';
import { useToast } from './components/Toasts.jsx';

export default function App() {
  const [household, setHousehold] = useState(null);
  const [algorithms, setAlgorithms] = useState([]);
  const [algorithm, setAlgorithm] = useState('robust-ga');
  const [result, setResult] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const notify = useToast();

  useEffect(() => {
    Promise.all([getDefaults(), getAlgorithms()])
      .then(([defaults, list]) => {
        setHousehold(defaults.household);
        setAlgorithms(list);
      })
      .catch((e) => setError(e.message));
  }, []);

  const run = async (task) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e.message);
      notify('error', e.message);
    } finally {
      setBusy(false);
    }
  };

  const makePlan = () =>
    run(async () => {
      const plan = await buildPlan(household, algorithm);
      setResult(plan);
      notify('success', `План складено: ${plan.algorithmName}`);
    });

  const compareAll = () =>
    run(async () => {
      const rows = [];
      for (const a of algorithms) rows.push(await buildPlan(household, a.id));
      setComparison(rows);
      notify('success', `Порівняно методів: ${rows.length}`);
    });

  if (!household) {
    return <main className="page">{error ? <p className="error">{error}</p> : <p>Завантаження…</p>}</main>;
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Планувальник енергоспоживання</h1>
        <p>Складає план роботи приладів і заряджання станції на добу з урахуванням того, що відключення можуть зсуватися.</p>
      </header>

      <div className="layout">
        <HouseholdForm household={household} onChange={setHousehold} />

        <div className="results">
          <section className="card controls">
            <label className="field">
              <span>Метод планування</span>
              <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>
                {algorithms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="buttons">
              <button type="button" onClick={makePlan} disabled={busy}>
                {busy ? 'Рахую…' : 'Скласти план'}
              </button>
              <button type="button" className="secondary" onClick={compareAll} disabled={busy}>
                Порівняти всі методи
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </section>

          {result && (
            <section className="card">
              <h2>План на добу: {result.algorithmName}</h2>
              <Timeline result={result} household={household} />
              <Metrics result={result} />
            </section>
          )}

          {comparison && (
            <section className="card">
              <h2>Порівняння методів</h2>
              <Comparison rows={comparison} />
            </section>
          )}

          <Autonomy household={household} onChange={setHousehold} />
        </div>
      </div>
    </main>
  );
}

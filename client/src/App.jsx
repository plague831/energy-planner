import { useEffect, useRef, useState } from 'react';
import { getDefaults, getAlgorithms, buildPlan } from './api.js';
import { readChoice, saveChoice, loadDay } from './yasno.js';
import { planToIcs, downloadIcs, localDate } from './exportPlan.js';
import { useToast } from './components/Toasts.jsx';
import Onboarding from './components/Onboarding.jsx';
import Autonomy from './components/Autonomy.jsx';
import Today from './pages/Today.jsx';
import MyHome from './pages/MyHome.jsx';
import Details from './pages/Details.jsx';
import Help from './pages/Help.jsx';

const STORAGE_KEY = 'energy-planner:household';
const ONBOARDED_KEY = 'energy-planner:onboarded';

const PAGES = [
  { id: 'today', icon: '☀️', label: 'Сьогодні' },
  { id: 'home', icon: '🏠', label: 'Мій дім' },
  { id: 'autonomy', icon: '🔋', label: 'Скільки протримається', short: 'Запас' },
  { id: 'details', icon: '📊', label: 'Детально' },
  { id: 'help', icon: '❓', label: 'Як це працює', short: 'Довідка' },
];

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Без сховища сайт працює, просто не пам'ятає дані.
    }
  },
};

// Дані домогосподарства зберігаються в браузері, щоб не вводити їх щоразу.
function readSaved() {
  try {
    const saved = JSON.parse(storage.get(STORAGE_KEY));
    return saved && Array.isArray(saved.appliances) && Array.isArray(saved.baseLoads) ? saved : null;
  } catch {
    return null;
  }
}

const routeFromHash = () => {
  const id = window.location.hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.id === id) ? id : 'today';
};

export default function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [household, setHousehold] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [algorithms, setAlgorithms] = useState([]);
  const [algorithm, setAlgorithm] = useState('robust-ga');
  const [result, setResult] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Для якого дня складено графік (сьогодні / завтра), щоб показувати позначку «зараз» лише для сьогодні.
  const [planDay, setPlanDay] = useState(null);
  const [scheduleNote, setScheduleNote] = useState(null);
  // Людина, яка вже має збережені дані, вважається такою, що пройшла майстер.
  const [onboarded, setOnboarded] = useState(() => Boolean(storage.get(ONBOARDED_KEY) || readSaved()));
  const [hasQueue, setHasQueue] = useState(() => Boolean(readChoice().source && readChoice().group));
  const planRequest = useRef(0);
  const notify = useToast();

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    Promise.all([getDefaults(), getAlgorithms()])
      .then(([d, list]) => {
        setDefaults(d.household);
        setHousehold(readSaved() ?? d.household);
        setAlgorithms(list);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (household) storage.set(STORAGE_KEY, JSON.stringify(household));
  }, [household]);

  // Графік з YASNO підставляється в дані; якщо графік не діє (аварійні відключення, ще не опублікований), лишається попередній.
  const applyDay = (day) => {
    setPlanDay({ day: day.day, date: day.date });
    if (day.applies) {
      setHousehold((h) => ({ ...h, outages: day.outages, possibleOutages: day.possible ?? [] }));
      setScheduleNote(null);
    } else {
      setScheduleNote(`Черга ${day.group}: ${day.statusText.charAt(0).toLowerCase()}${day.statusText.slice(1)}. План складено за останнім відомим графіком.`);
    }
  };

  const loadSchedule = async (day = 'today', { silent = false } = {}) => {
    const choice = readChoice();
    if (!choice.source || !choice.group) {
      setPlanDay({ day });
      return;
    }
    try {
      applyDay(await loadDay({ ...choice, day }));
    } catch {
      if (!silent) notify('error', 'Не вдалося оновити графік з YASNO, показую останній відомий');
      setPlanDay({ day });
    }
  };

  // При відкритті сайту свіжий графік підтягується сам, якщо людина обрала чергу.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!household || autoLoaded.current || !onboarded) return;
    autoLoaded.current = true;
    if (readChoice().auto !== false) loadSchedule('today', { silent: true });
  }, [household, onboarded]);

  // План перераховується сам після кожної зміни даних (з невеликою затримкою, поки людина вводить).
  useEffect(() => {
    if (!household || !onboarded) return;
    const id = ++planRequest.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const plan = await buildPlan(household, algorithm);
        if (id === planRequest.current) {
          setResult(plan);
          setError(null);
        }
      } catch (e) {
        if (id === planRequest.current) setError(e.message);
      } finally {
        if (id === planRequest.current) setBusy(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [household, algorithm, onboarded]);

  const onOutagesLoaded = (outages, meta) => {
    setPlanDay({ day: meta.day, date: meta.date });
    setScheduleNote(null);
    setHasQueue(true);
    setHousehold((h) => ({ ...h, outages, possibleOutages: meta.possible ?? [] }));
  };

  const finishOnboarding = ({ household: h, choice }) => {
    if (choice) saveChoice(choice);
    setHasQueue(Boolean(choice));
    storage.set(ONBOARDED_KEY, '1');
    setHousehold(h);
    setOnboarded(true);
    autoLoaded.current = true;
    if (choice) loadSchedule('today');
    window.location.hash = '#/today';
    notify('success', 'Готово! Ось ваш план на сьогодні');
  };

  const skipOnboarding = () => {
    storage.set(ONBOARDED_KEY, '1');
    setOnboarded(true);
  };

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

  const resetToDemo = () => {
    setHousehold(defaults);
    setComparison(null);
    notify('info', 'Дані замінено демонстраційним прикладом');
  };

  const exportCalendar = () => {
    const date = planDay?.date?.slice(0, 10) ?? localDate(planDay?.day === 'tomorrow' ? 1 : 0);
    downloadIcs(planToIcs(result, household, date), `plan-${date}.ics`);
    notify('success', 'Файл календаря збережено: відкрийте його, щоб додати нагадування');
  };

  if (!household) {
    return <main className="page">{error ? <p className="error">{error}</p> : <p>Завантаження…</p>}</main>;
  }

  if (!onboarded) {
    return (
      <main className="page narrow">
        <header className="page-header">
          <h1>Планувальник енергоспоживання</h1>
        </header>
        <Onboarding onFinish={finishOnboarding} onSkip={skipOnboarding} />
      </main>
    );
  }

  const current = PAGES.find((p) => p.id === route);

  return (
    <>
      <header className="app-header no-print">
        <div className="app-header-inner">
          <a className="brand" href="#/today">
            ⚡ Планувальник енергоспоживання
          </a>
          <nav className="nav-top" aria-label="Розділи">
            {PAGES.map((p) => (
              <a key={p.id} href={`#/${p.id}`} className={p.id === route ? 'active' : ''} aria-current={p.id === route ? 'page' : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="page narrow">
        <h1 className="page-title">
          <span aria-hidden="true">{current.icon}</span> {current.label}
        </h1>

        {route === 'today' && (
          <Today
            household={household}
            result={result}
            busy={busy}
            planDay={planDay}
            scheduleNote={scheduleNote}
            hasQueue={hasQueue}
            onSelectDay={(day) => loadSchedule(day)}
            onExportCalendar={exportCalendar}
          />
        )}
        {route === 'home' && <MyHome household={household} onChange={setHousehold} onOutagesLoaded={onOutagesLoaded} />}
        {route === 'autonomy' && <Autonomy household={household} onChange={setHousehold} />}
        {route === 'details' && (
          <Details
            household={household}
            result={result}
            comparison={comparison}
            algorithms={algorithms}
            algorithm={algorithm}
            onAlgorithm={setAlgorithm}
            busy={busy}
            error={error}
            onPlan={makePlan}
            onCompare={compareAll}
            onReset={resetToDemo}
            canReset={Boolean(defaults)}
          />
        )}
        {route === 'help' && <Help />}
      </main>

      <nav className="nav-bottom no-print" aria-label="Розділи">
        {PAGES.map((p) => (
          <a key={p.id} href={`#/${p.id}`} className={p.id === route ? 'active' : ''} aria-current={p.id === route ? 'page' : undefined}>
            <span aria-hidden="true">{p.icon}</span>
            {p.short ?? p.label}
          </a>
        ))}
      </nav>
    </>
  );
}

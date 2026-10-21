import { useEffect, useMemo, useRef, useState } from 'react';
import { getDefaults, getAlgorithms, buildPlan } from './api.js';
import { readChoice, saveChoice, loadDay } from './yasno.js';
import { migrateHousehold, withSources } from './sources.js';
import { planDay as computePlan } from './planning.js';
import { readEvents, addEvent, clearEvents, currentActual, applyActual } from './actual.js';
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
  { id: 'backup', icon: '🔋', label: 'Резервне живлення', short: 'Резерв' },
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
    return saved && Array.isArray(saved.appliances) && Array.isArray(saved.baseLoads) ? migrateHousehold(saved) : null;
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
  // Що змінилось у плані після оновлення графіка протягом дня.
  const [replanNote, setReplanNote] = useState(null);
  // Людина, яка вже має збережені дані, вважається такою, що пройшла майстер.
  const [onboarded, setOnboarded] = useState(() => Boolean(storage.get(ONBOARDED_KEY) || readSaved()));
  // Зміни в «Мій дім» спершу потрапляють у чернетку і застосовуються кнопкою «Зберегти».
  const [draft, setDraft] = useState(null);
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
        const demo = migrateHousehold(d.household);
        setDefaults(demo);
        setHousehold(readSaved() ?? demo);
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
  // План на сьогодні будується з поточного моменту; якщо змінився графік, людина бачить, що саме перенесено.
  const day = planDay?.day ?? 'today';

  // Фактичний стан світла, який повідомила людина, уточнює графік на сьогодні.
  const [actualEvents, setActualEvents] = useState(readEvents);
  const actual = currentActual(actualEvents);
  const { effectiveHousehold, actualNote } = useMemo(() => {
    if (!household || day !== 'today') return { effectiveHousehold: household, actualNote: null };
    const { outages, note } = applyActual(household.outages ?? [], actual);
    return { effectiveHousehold: outages === household.outages ? household : { ...household, outages }, actualNote: note };
  }, [household, day, actual]);

  const reportActual = (type) => {
    const choice = readChoice();
    setActualEvents(addEvent(type, household, choice.group ? `${choice.source} ${choice.group}` : null));
    notify('success', type === 'off' ? 'Зафіксовано: світла немає. План перебудовано' : 'Зафіксовано: світло є. План перебудовано');
  };

  useEffect(() => {
    if (!effectiveHousehold || !onboarded) return;
    const id = ++planRequest.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const { result: plan, changed } = await computePlan(effectiveHousehold, algorithm, { day, scheduleOutages: household.outages });
        if (id === planRequest.current) {
          setResult(plan);
          setError(null);
          if (changed) {
            setReplanNote(changed);
            notify('info', `Графік змінився, план на решту дня перебудовано з ${changed.at}`);
          }
        }
      } catch (e) {
        if (id === planRequest.current) setError(e.message);
      } finally {
        if (id === planRequest.current) setBusy(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [effectiveHousehold, algorithm, onboarded, day]);

  // Поки сторінка відкрита, графік на сьогодні перевіряється кожні 10 хвилин,
  // а план на решту дня оновлюється з поточного моменту.
  useEffect(() => {
    if (!onboarded || day !== 'today') return;
    const id = setInterval(() => {
      if (readChoice().auto !== false) loadSchedule('today', { silent: true });
      else setHousehold((h) => ({ ...h }));
    }, 10 * 60_000);
    return () => clearInterval(id);
  }, [onboarded, day]);

  const onOutagesLoaded = (outages, meta) => {
    setPlanDay({ day: meta.day, date: meta.date });
    setScheduleNote(null);
    setHasQueue(true);
    // Завантаження графіка — окрема явна дія, тож він застосовується одразу (і в чернетку, якщо вона є).
    setHousehold((h) => ({ ...h, outages, possibleOutages: meta.possible ?? [] }));
    setDraft((d) => (d ? { ...d, outages, possibleOutages: meta.possible ?? [] } : d));
  };

  const editDraft = (next) => setDraft(JSON.stringify(next) === JSON.stringify(household) ? null : next);

  const saveDraft = () => {
    if (!draft) return;
    setHousehold(draft);
    setDraft(null);
    notify('success', 'Зміни збережено, план перераховано');
  };

  const cancelDraft = () => {
    setDraft(null);
    notify('info', 'Зміни скасовано');
  };

  // Попередження, якщо закрити вкладку з незбереженими змінами.
  useEffect(() => {
    if (!draft) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);

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
      const { result: plan } = await computePlan(effectiveHousehold, algorithm, { day, scheduleOutages: household.outages });
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
    setDraft(null);
    setComparison(null);
    notify('info', 'Дані замінено демонстраційним прикладом');
  };

  // Людина вказує фактичний заряд станцій зараз — план на решту дня перебудовується від нього.
  const setCurrentCharge = (pct) => {
    setHousehold((h) => withSources(h, (h.sources ?? []).map((s) => (s.kind === 'battery' ? { ...s, initialSocPct: pct } : s))));
    notify('success', `Заряд ${pct}% враховано, план перебудовано`);
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
            household={effectiveHousehold}
            actual={actual}
            actualNote={actualNote}
            onReport={reportActual}
            result={result}
            busy={busy}
            planDay={planDay}
            scheduleNote={scheduleNote}
            replanNote={replanNote}
            onDismissReplan={() => setReplanNote(null)}
            onSetCharge={setCurrentCharge}
            hasQueue={hasQueue}
            onSelectDay={(day) => loadSchedule(day)}
            onExportCalendar={exportCalendar}
          />
        )}
        {route === 'home' && (
          <>
            <MyHome household={draft ?? household} onChange={editDraft} onOutagesLoaded={onOutagesLoaded} />
            <div className="save-footer no-print">
              {draft ? (
                <>
                  <button type="button" onClick={saveDraft}>
                    Зберегти зміни
                  </button>
                  <button type="button" className="secondary" onClick={cancelDraft}>
                    Скасувати
                  </button>
                </>
              ) : (
                <span className="muted">✓ Усі зміни збережено</span>
              )}
            </div>
          </>
        )}
        {route === 'backup' && <Autonomy household={household} />}
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
            events={actualEvents}
            onClearEvents={() => setActualEvents(clearEvents())}
          />
        )}
        {route === 'help' && <Help />}
      </main>

      {draft && (
        <div className="save-bar no-print" role="status">
          <span>
            Є незбережені зміни{route !== 'home' ? ' в «Мій дім»' : ''}
          </span>
          <div>
            <button type="button" className="secondary" onClick={cancelDraft}>
              Скасувати
            </button>
            <button type="button" onClick={saveDraft}>
              Зберегти
            </button>
          </div>
        </div>
      )}

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

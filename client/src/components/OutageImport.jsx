import { useEffect, useRef, useState } from 'react';
import { getYasnoRegions, getYasnoSchedule } from '../api.js';
import { useToast } from './Toasts.jsx';

const STORAGE_KEY = 'energy-planner:yasno';

// Завантаження графіка відключень за чергою з YASNO (Київ, Дніпро).
// Графік підставляється у таблицю нижче, де його можна виправити вручну.
export default function OutageImport({ onApply }) {
  const [sources, setSources] = useState(null);
  // Черги різні в різних містах (у Києві 1.1–60.1, у Дніпрі 1.1–6.2), тому беремо їх з самого графіка.
  const [groups, setGroups] = useState(null);
  const [choice, setChoice] = useState(() => ({ source: '', group: '1.1', day: 'today', ...readSaved() }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const notify = useToast();
  const autoLoaded = useRef(false);

  useEffect(() => {
    getYasnoRegions()
      .then((regions) => {
        const list = regions.flatMap((r) =>
          r.dsos.map((d) => ({ value: `${r.id}:${d.id}`, label: r.dsos.length > 1 ? `${r.name}, ${d.name}` : r.name })),
        );
        setSources(list);
        setChoice((c) => (list.some((s) => s.value === c.source) ? c : { ...c, source: list[0]?.value ?? '' }));
      })
      .catch(() => setMessage({ error: true, text: 'YASNO зараз недоступний, введіть графік вручну.' }));
  }, []);

  useEffect(() => {
    if (!choice.source) return;
    const [region, dso] = choice.source.split(':');
    setGroups(null);
    let cancelled = false;
    getYasnoSchedule(region, dso)
      .then((schedule) => {
        if (cancelled) return;
        const names = schedule.groups.map((g) => g.group);
        setGroups(names);
        if (names.length && !names.includes(choice.group)) update('group', names[0]);
      })
      .catch(() => !cancelled && setGroups([]));
    return () => {
      cancelled = true;
    };
  }, [choice.source]);

  const update = (key, value) => {
    setChoice((current) => {
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Без збереження вибору все одно працює.
      }
      return next;
    });
  };

  // Автоматичний режим: щойно відомі черги міста, один раз підтягуємо свіжий графік.
  useEffect(() => {
    if (!choice.auto || autoLoaded.current || !groups?.includes(choice.group)) return;
    autoLoaded.current = true;
    load({ auto: true });
  }, [groups]);

  const load = async ({ auto = false } = {}) => {
    const [region, dso] = choice.source.split(':');
    setBusy(true);
    setMessage(null);
    try {
      const { groups } = await getYasnoSchedule(region, dso);
      const day = groups.find((g) => g.group === choice.group)?.[choice.day];
      if (!day) {
        setMessage({ error: true, text: `YASNO не має даних для черги ${choice.group}.` });
        notify('error', `YASNO не має даних для черги ${choice.group}`);
        return;
      }
      const when = `${choice.day === 'today' ? 'на сьогодні' : 'на завтра'}${day.date ? ` (${formatDate(day.date)})` : ''}`;
      if (day.status === 'ScheduleApplies' || day.status === 'NoOutages') {
        onApply(day.outages, { auto, day: choice.day, date: day.date, possible: day.possible });
        const parts = [`Черга ${choice.group} ${when}: ${countOutages(day.outages.length)}.`];
        if (day.possible.length) parts.push(`Можливі додаткові відключення: ${day.possible.map((o) => `${o.from}–${o.to}`).join(', ')}.`);
        setMessage({ text: parts.join(' ') });
        notify('success', `Графік черги ${choice.group} завантажено: ${countOutages(day.outages.length)}`);
      } else {
        setMessage({ text: `Черга ${choice.group} ${when}: ${lowerFirst(day.statusText)}. Таблиця лишилась без змін.` });
        notify('info', `${day.statusText}. Графік не змінено`);
        if (auto) onApply(null, { auto, day: choice.day, date: day.date });
      }
    } catch (e) {
      setMessage({ error: true, text: e.message });
      notify('error', 'Не вдалося завантажити графік з YASNO');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="outage-import">
      <p className="hint">Для Києва і Дніпра графік можна завантажити з YASNO, для інших областей введіть його вручну.</p>
      <div className="import-row">
        <label className="field">
          <span>Місто</span>
          <select value={choice.source} onChange={(e) => update('source', e.target.value)} disabled={!sources}>
            {(sources ?? []).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Черга</span>
          <select value={choice.group} onChange={(e) => update('group', e.target.value)} disabled={!groups?.length}>
            {(groups ?? [choice.group]).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>День</span>
          <select value={choice.day} onChange={(e) => update('day', e.target.value)}>
            <option value="today">Сьогодні</option>
            <option value="tomorrow">Завтра</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => load()} disabled={busy || !choice.source || !groups?.length}>
          {busy ? 'Завантажую…' : 'Завантажити з YASNO'}
        </button>
      </div>
      <label className="checkbox auto-toggle">
        <input type="checkbox" checked={Boolean(choice.auto)} onChange={(e) => update('auto', e.target.checked)} />
        Автоматично завантажувати графік і складати план при відкритті сайту
      </label>
      {message && <p className={message.error ? 'error' : 'import-message'}>{message.text}</p>}
    </div>
  );
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function formatDate(iso) {
  const [, month, day] = iso.split('-');
  return `${day}.${month}`;
}

function countOutages(n) {
  if (n === 0) return 'відключень не заплановано';
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 >= 1 && mod10 <= 4 && !(mod100 >= 11 && mod100 <= 14) ? 'відключення' : 'відключень';
  return `${n} ${word}`;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

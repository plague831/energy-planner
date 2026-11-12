import { useEffect, useState } from 'react';
import { readChoice, saveChoice, loadSources, loadGroups, loadDay, countOutages } from '../yasno.js';
import { useToast } from './Toasts.jsx';

// Вибір міста й черги YASNO (Київ, Дніпро). Графік підставляється у таблицю відключень,
// де його можна виправити вручну. Автоматичне завантаження при відкритті сайту робить App.
export default function OutageImport({ onApply }) {
  const [sources, setSources] = useState(null);
  // Черги різні в різних містах (у Києві 1.1–60.1, у Дніпрі 1.1–6.2), тому беремо їх з самого графіка.
  const [groups, setGroups] = useState(null);
  const [choice, setChoice] = useState(() => ({ source: '', group: '1.1', day: 'today', auto: true, ...readChoice() }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const notify = useToast();

  const update = (key, value) =>
    setChoice((current) => {
      const next = { ...current, [key]: value };
      saveChoice(next);
      return next;
    });

  useEffect(() => {
    loadSources()
      .then((list) => {
        setSources(list);
        setChoice((c) => (list.some((s) => s.value === c.source) ? c : { ...c, source: list[0]?.value ?? '' }));
      })
      .catch(() => setMessage({ error: true, text: 'YASNO зараз недоступний, введіть графік вручну.' }));
  }, []);

  useEffect(() => {
    if (!choice.source) return;
    setGroups(null);
    let cancelled = false;
    loadGroups(choice.source)
      .then((names) => {
        if (cancelled) return;
        setGroups(names);
        if (names.length && !names.includes(choice.group)) update('group', names[0]);
      })
      .catch(() => !cancelled && setGroups([]));
    return () => {
      cancelled = true;
    };
  }, [choice.source]);

  // Назву міста запам'ятовуємо, щоб нові сонячні панелі брали прогноз погоди для нього ж.
  useEffect(() => {
    const label = sources?.find((s) => s.value === choice.source)?.label;
    if (label && label !== choice.sourceLabel) update('sourceLabel', label);
  }, [sources, choice.source]);

  const load = async () => {
    setBusy(true);
    setMessage(null);
    saveChoice(choice);
    try {
      const day = await loadDay(choice);
      const when = `${choice.day === 'today' ? 'на сьогодні' : 'на завтра'}${day.date ? ` (${formatDate(day.date)})` : ''}`;
      if (day.applies) {
        onApply(day.outages, { day: choice.day, date: day.date, possible: day.possible });
        const parts = [`Черга ${choice.group} ${when}: ${countOutages(day.outages.length)}.`];
        if (day.possible.length) parts.push(`Можливі додаткові відключення: ${day.possible.map((o) => `${o.from}–${o.to}`).join(', ')}.`);
        setMessage({ text: parts.join(' ') });
        notify('success', `Графік черги ${choice.group} завантажено: ${countOutages(day.outages.length)}`);
      } else {
        setMessage({ text: `Черга ${choice.group} ${when}: ${lowerFirst(day.statusText)}. Таблиця лишилась без змін.` });
        notify('info', `${day.statusText}. Графік не змінено`);
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
        <button type="button" className="secondary" onClick={load} disabled={busy || !choice.source || !groups?.length}>
          {busy ? 'Завантажую…' : 'Завантажити з YASNO'}
        </button>
      </div>
      <label className="checkbox auto-toggle">
        <input type="checkbox" checked={choice.auto !== false} onChange={(e) => update('auto', e.target.checked)} />
        Автоматично оновлювати графік при кожному відкритті сайту
      </label>
      {message && <p className={message.error ? 'error' : 'import-message'}>{message.text}</p>}
    </div>
  );
}

function formatDate(iso) {
  const [, month, day] = iso.split('-');
  return `${day}.${month}`;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

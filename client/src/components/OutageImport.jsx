import { useEffect, useState } from 'react';
import { getYasnoRegions, getYasnoSchedule } from '../api.js';

const GROUPS = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];
const STORAGE_KEY = 'energy-planner:yasno';

// Завантаження графіка відключень за чергою з YASNO (Київ, Дніпро).
// Графік підставляється у таблицю нижче, де його можна виправити вручну.
export default function OutageImport({ onApply }) {
  const [sources, setSources] = useState(null);
  const [choice, setChoice] = useState(() => ({ source: '', group: '1.1', day: 'today', ...readSaved() }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

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

  const update = (key, value) => {
    const next = { ...choice, [key]: value };
    setChoice(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Без збереження вибору все одно працює.
    }
  };

  const load = async () => {
    const [region, dso] = choice.source.split(':');
    setBusy(true);
    setMessage(null);
    try {
      const { groups } = await getYasnoSchedule(region, dso);
      const day = groups.find((g) => g.group === choice.group)?.[choice.day];
      if (!day) {
        setMessage({ error: true, text: `YASNO не має даних для черги ${choice.group}.` });
        return;
      }
      const when = `${choice.day === 'today' ? 'на сьогодні' : 'на завтра'}${day.date ? ` (${formatDate(day.date)})` : ''}`;
      if (day.status === 'ScheduleApplies' || day.status === 'NoOutages') {
        onApply(day.outages);
        const parts = [`Черга ${choice.group} ${when}: ${countOutages(day.outages.length)}.`];
        if (day.possible.length) parts.push(`Можливі додаткові відключення: ${day.possible.map((o) => `${o.from}–${o.to}`).join(', ')}.`);
        setMessage({ text: parts.join(' ') });
      } else {
        setMessage({ text: `Черга ${choice.group} ${when}: ${lowerFirst(day.statusText)}. Таблиця лишилась без змін.` });
      }
    } catch (e) {
      setMessage({ error: true, text: e.message });
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
          <select value={choice.group} onChange={(e) => update('group', e.target.value)}>
            {GROUPS.map((g) => (
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
        <button type="button" className="secondary" onClick={load} disabled={busy || !choice.source}>
          {busy ? 'Завантажую…' : 'Завантажити з YASNO'}
        </button>
      </div>
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

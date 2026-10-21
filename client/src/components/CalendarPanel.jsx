import { useState } from 'react';
import { readChoice } from '../yasno.js';
import { useToast } from './Toasts.jsx';

const TOKEN_KEY = 'energy-planner:calendar-token';

export function readCalendarToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// Оновлює дані дому в підписці (виклик після збереження змін у «Мій дім»).
export async function syncCalendar(household) {
  const token = readCalendarToken();
  if (!token) return;
  await fetch('/api/calendar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ household, choice: readChoice(), token }),
  }).catch(() => {});
}

// «Календар»: підписка, яка сама оновлюється (сервер щоразу бере свіжий графік і перераховує план),
// або разове завантаження файлу на вибраний день.
export default function CalendarPanel({ household, onDownload }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(readCalendarToken);
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const link = token ? `${window.location.origin}/api/calendar/${token}.ics` : null;

  const subscribe = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ household, choice: readChoice(), token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      localStorage.setItem(TOKEN_KEY, body.token);
      setToken(body.token);
      notify('success', 'Посилання для підписки створено');
    } catch {
      notify('error', 'Не вдалося створити підписку');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        📅 Календар
      </button>
    );
  }

  return (
    <div className="calendar-panel">
      <div className="calendar-option">
        <strong>Підписка, яка оновлюється сама</strong>
        <p className="hint">
          Календар на телефоні раз на кілька годин сам завантажує свіжий план на сьогодні й завтра з урахуванням нового графіка відключень.
        </p>
        {link ? (
          <>
            <input className="calendar-link" readOnly value={link} onFocus={(e) => e.target.select()} />
            <div className="buttons">
              <a className="button-link" href={link.replace(/^https?:/, 'webcal:')}>
                Відкрити в календарі
              </a>
              <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(link).then(() => notify('success', 'Посилання скопійовано'))}>
                Скопіювати
              </button>
            </div>
            <p className="hint">
              У Google Календарі: «Інші календарі» → «+» → «За URL». Сервіс має бути доступний з інтернету, тож з адреси localhost чи 192.168… підписка
              працюватиме лише на цьому комп'ютері.
            </p>
          </>
        ) : (
          <button type="button" onClick={subscribe} disabled={busy}>
            {busy ? 'Створюю…' : 'Створити посилання'}
          </button>
        )}
      </div>
      <div className="calendar-option">
        <strong>Разово на цей день</strong>
        <p className="hint">Файл .ics з подіями «Увімкнути: …» і нагадуванням за 5 хвилин.</p>
        <button type="button" className="secondary" onClick={onDownload}>
          Завантажити файл
        </button>
      </div>
      <button type="button" className="link-button" onClick={() => setOpen(false)}>
        Закрити
      </button>
    </div>
  );
}

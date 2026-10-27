import { useEffect, useState } from 'react';
import ActionList from '../components/ActionList.jsx';
import EnergyBalance from '../components/EnergyBalance.jsx';
import PowerFlow from '../components/PowerFlow.jsx';
import CalendarPanel from '../components/CalendarPanel.jsx';
import TrafficLight from '../components/TrafficLight.jsx';

const SLOT_MIN = 15;
const toSlot = (t) => {
  const [h, m] = t.split(':').map(Number);
  return Math.round((h * 60 + m) / SLOT_MIN);
};
const slotTime = (s) => `${String(Math.floor((s * SLOT_MIN) / 60) % 24).padStart(2, '0')}:${String((s * SLOT_MIN) % 60).padStart(2, '0')}`;
const nowSlotOf = () => {
  const d = new Date();
  return (d.getHours() * 60 + d.getMinutes()) / SLOT_MIN;
};

// Головний екран для звичайного користувача: що зі світлом зараз, скільки до відключення,
// що з зарядом станції і що робити далі. Усе технічне — у розділі «Детально».
export default function Today({ household, actual, actualNote, onReport, result, busy, planDay, scheduleNote, replanNote, onDismissReplan, onSetCharge, hasQueue, onSelectDay, onExportCalendar, notifySettings, onNotifyChange }) {
  const [now, setNow] = useState(nowSlotOf);
  useEffect(() => {
    const id = setInterval(() => setNow(nowSlotOf()), 30_000);
    return () => clearInterval(id);
  }, []);

  const isTomorrow = planDay?.day === 'tomorrow';
  const dateLabel = planDay?.date ? `${planDay.date.slice(8, 10)}.${planDay.date.slice(5, 7)}` : null;

  return (
    <div className="page-stack">
      <div className="day-switch" role="tablist" aria-label="День плану">
        <button type="button" role="tab" aria-selected={!isTomorrow} className={!isTomorrow ? 'active' : ''} onClick={() => onSelectDay('today')}>
          Сьогодні
        </button>
        <button type="button" role="tab" aria-selected={isTomorrow} className={isTomorrow ? 'active' : ''} onClick={() => onSelectDay('tomorrow')}>
          Завтра
        </button>
      </div>

      {!hasQueue && (household.outages ?? []).length === 0 && (
        <section className="card notice">
          <strong>Вкажіть свою чергу відключень.</strong> Тоді сайт сам підтягуватиме графік і складатиме план.{' '}
          <a href="#/home">Перейти до «Мій дім»</a>
        </section>
      )}

      {scheduleNote && <section className="card notice warn">{scheduleNote}</section>}

      {replanNote && !isTomorrow && (
        <section className="card notice replan">
          <button type="button" className="icon-button notice-close" onClick={onDismissReplan} aria-label="Закрити">
            ×
          </button>
          <strong>🔄 Графік відключень змінився.</strong> План на решту дня перебудовано о {replanNote.at}.
          {replanNote.moved.length > 0 ? (
            <ul>
              {replanNote.moved.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <div className="muted">Час приладів лишився тим самим.</div>
          )}
        </section>
      )}

      {!isTomorrow && <PowerStatus household={household} result={result} now={now} onSetCharge={onSetCharge} actual={actual} actualNote={actualNote} onReport={onReport} />}

      {!isTomorrow && result && (
        <PowerFlow
          trace={result.nominal.trace}
          slot={now}
          household={household}
          hasGenerator={(household.sources ?? []).some((s) => s.kind === 'generator')}
          hasSolar={(household.sources ?? []).some((s) => s.kind === 'solar')}
        />
      )}

      <section className="card">
        <h2>
          {isTomorrow ? 'План на завтра' : 'Що можна вмикати зараз'}
          {isTomorrow && dateLabel ? ` (${dateLabel})` : ''}
        </h2>
        {!result ? (
          <p className="muted">{busy ? 'Рахую…' : 'Додайте прилади в «Мій дім», і тут з’являться підказки.'}</p>
        ) : isTomorrow ? (
          <>
            <PrepAdvice household={household} result={result} now={0} />
            <GeneratorRules generators={result.generators ?? []} />
            <ActionList result={result} household={household} isToday={false} />
            <div className="plan-actions no-print">
              <CalendarPanel household={household} onDownload={onExportCalendar} />
              <button type="button" className="secondary" onClick={() => window.print()}>
                🖨️ Друкувати
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">Чи вистачить світла або заряду станції, якщо ввімкнути прилад просто зараз, з урахуванням графіка відключень.</p>
            <PrepAdvice household={household} result={result} now={now} />
            <TrafficLight household={household} result={result} now={now} />
            <GeneratorRules generators={result.generators ?? []} />
            <details className="more full-plan">
              <summary>📋 Увесь план на сьогодні</summary>
              <ActionList result={result} household={household} isToday />
            </details>
            <div className="plan-actions no-print">
              <CalendarPanel household={household} onDownload={onExportCalendar} />
              <button type="button" className="secondary" onClick={() => window.print()}>
                🖨️ Друкувати
              </button>
            </div>
            {notifySettings && <NotifySettings settings={notifySettings} onChange={onNotifyChange} />}
          </>
        )}
      </section>

      {result && <EnergyBalance result={result} />}
    </div>
  );
}

// Порада перед найближчим відключенням (як «Storm Guard» у застосунках станцій):
// до якого рівня має бути заряджена станція і чи вистачить її на все відключення.
function PrepAdvice({ household, result, now }) {
  const capacity = household.battery?.capacityWh;
  const trace = result.nominal.trace;
  if (!capacity || !trace?.length) return null;
  const start = Math.ceil(now);
  // Найближче відключення в плані, яке ще не почалось.
  let from = -1;
  for (let t = Math.max(1, start); t < trace.length; t++) {
    if (!trace[t].gridOn && trace[t - 1].gridOn) {
      from = t;
      break;
    }
  }
  if (from === -1) return null;
  let to = from;
  while (to < trace.length && !trace[to].gridOn) to++;
  const pct = (wh) => Math.round((wh / capacity) * 100);
  const needed = pct(trace[from - 1].energyWh);
  const lowest = Math.min(...trace.slice(from, to).map((t) => t.energyWh));
  const shortage = trace.slice(from, to).some((t) => t.servedW + 1 < t.demandW);
  const minSoc = household.battery.minSocPct ?? 10;
  const charging = trace.slice(start, from).some((t) => t.chargeW > 0);
  return (
    <div className={`prep-advice ${shortage ? 'warn' : ''}`}>
      <span className="next-icon" aria-hidden="true">
        🔋
      </span>
      <div>
        <div className="next-label">
          Підготовка до відключення о {slotTime(from)}–{slotTime(to)}
        </div>
        <div className="next-title">
          {needed >= 99 ? 'Зарядіть станцію повністю' : `Зарядіть станцію щонайменше до ${needed}%`} до {slotTime(from)}
        </div>
        <div className="prep-detail">
          {charging ? 'Тримайте її на зарядці, поки є світло. ' : ''}
          {shortage
            ? `Навіть так енергії на все відключення не вистачить: заряд впаде до ${minSoc}%, і частину приладів доведеться вимкнути.`
            : `За планом під час відключення заряд опуститься до ${pct(lowest)}%, тож запасу вистачить.`}
        </div>
      </div>
    </div>
  );
}

function NotifySettings({ settings, onChange }) {
  return (
    <div className="notify-settings no-print">
      <label className="checkbox">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => onChange({ ...settings, enabled: e.target.checked })} />
        🔔 Нагадувати про відключення і дії з плану
      </label>
      {settings.enabled && (
        <label className="notify-before">
          за
          <select value={settings.minutesBefore} onChange={(e) => onChange({ ...settings, minutesBefore: Number(e.target.value) })}>
            {[0, 5, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'у момент події' : `${m} хв`}
              </option>
            ))}
          </select>
        </label>
      )}
      {settings.enabled && <p className="hint">Сповіщення приходять, поки сайт відкритий (можна у фоновій вкладці або як встановлений застосунок).</p>}
    </div>
  );
}

function GeneratorRules({ generators }) {
  if (!generators.length) return null;
  return (
    <ul className="generator-rules">
      {generators.map((g) => (
        <li key={g.id}>
          ⛽ <strong>{g.name}:</strong>{' '}
          {g.thresholdPct === null
            ? 'сьогодні не знадобиться.'
            : g.noBattery
              ? 'вмикайте на початку кожного відключення.'
              : `вмикайте під час відключення, коли заряд станції впаде до ${g.thresholdPct}%, і вимикайте, коли підзарядиться до ${Math.min(95, g.thresholdPct + 30)}%.`}
        </li>
      ))}
    </ul>
  );
}

function PowerStatus({ household, result, now, onSetCharge, actual, actualNote, onReport }) {
  const outages = (household.outages ?? []).map((o) => {
    const from = toSlot(o.from);
    let to = toSlot(o.to);
    if (to <= from) to += 96;
    return { from, to };
  });
  // Відключення через північ (22:00–02:00) зберігається як 88–104, тож після півночі порівнюємо ще й now + 96.
  const inside = (o) => (now >= o.from && now < o.to ? now : now + 96 >= o.from && now + 96 < o.to ? now + 96 : null);
  const current = outages.find((o) => inside(o) !== null);
  const next = outages.filter((o) => o.from > now).sort((a, b) => a.from - b.from)[0];
  const capacity = household.battery?.capacityWh;
  const trace = result?.nominal?.trace;
  const socNow = capacity && trace ? Math.round((trace[Math.min(95, Math.floor(now))].energyWh / capacity) * 100) : null;

  return (
    <section className={`card status ${current ? 'off' : 'on'}`}>
      <div className="status-main">
        <span className="status-icon" aria-hidden="true">
          {current ? '🌑' : '💡'}
        </span>
        <div>
          <div className="status-title">
            {current
              ? actual?.type === 'off'
                ? `Зараз світла немає (ви повідомили о ${actual.time})`
                : 'Зараз відключення за графіком'
              : actual?.type === 'on'
                ? `Зараз світло є (повернулось о ${actual.time})`
                : 'Зараз світло є'}
          </div>
          <div className="status-sub">
            {current
              ? `Світло має повернутися о ${slotTime(current.to)} (через ${until(current.to - inside(current))})`
              : next
                ? `Наступне відключення о ${slotTime(next.from)}, через ${until(next.from - now)}`
                : 'Сьогодні більше відключень за графіком немає'}
          </div>
        </div>
      </div>
      {socNow !== null && (
        <div className="status-battery">
          <div className="battery-bar" aria-hidden="true">
            <div style={{ width: `${Math.max(0, Math.min(100, socNow))}%` }} />
          </div>
          <span>
            Заряд станції за планом зараз ≈ <strong>{socNow}%</strong>
          </span>
        </div>
      )}
      {actualNote && <p className="actual-note">{actualNote}</p>}
      <div className="report-buttons">
        <span className="muted">Насправді інакше?</span>
        {current ? (
          <button type="button" className="secondary" onClick={() => onReport('on')}>
            💡 Світло вже є
          </button>
        ) : (
          <button type="button" className="secondary" onClick={() => onReport('off')}>
            🌑 Світла немає
          </button>
        )}
      </div>
      {capacity && <ChargeCorrection onSetCharge={onSetCharge} />}
    </section>
  );
}

// Якщо реальний заряд відрізняється від розрахунку, людина вводить його, і план перебудовується від нього.
function ChargeCorrection({ onSetCharge }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) {
    return (
      <button type="button" className="link-button charge-fix" onClick={() => setOpen(true)}>
        Насправді заряд інший? Уточнити
      </button>
    );
  }
  const submit = (e) => {
    e.preventDefault();
    const pct = Number(value);
    if (!(pct >= 0 && pct <= 100) || value === '') return;
    onSetCharge(pct);
    setOpen(false);
    setValue('');
  };
  return (
    <form className="charge-form" onSubmit={submit}>
      <label className="field">
        <span>Фактичний заряд станції зараз, %</span>
        <input type="number" min={0} max={100} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </label>
      <button type="submit">Перебудувати план</button>
      <button type="button" className="secondary" onClick={() => setOpen(false)}>
        Скасувати
      </button>
    </form>
  );
}

function until(slots) {
  const min = Math.max(0, Math.round(slots * SLOT_MIN));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} хв`;
  return m ? `${h} год ${m} хв` : `${h} год`;
}

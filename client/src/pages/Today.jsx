import { useEffect, useState } from 'react';
import ActionList from '../components/ActionList.jsx';
import EnergyBalance from '../components/EnergyBalance.jsx';
import { iconFor } from '../icons.js';

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
export default function Today({ household, actual, actualNote, onReport, result, busy, planDay, scheduleNote, replanNote, onDismissReplan, onSetCharge, hasQueue, onSelectDay, onExportCalendar }) {
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

      <section className="card">
        <h2>
          План на {isTomorrow ? 'завтра' : 'сьогодні'}
          {dateLabel ? ` (${dateLabel})` : ''}
        </h2>
        {!result ? (
          <p className="muted">{busy ? 'Складаю план…' : 'Додайте прилади в «Мій дім», і план з’явиться тут.'}</p>
        ) : (
          <>
            <NextStep result={result} now={isTomorrow ? -1 : now} />
            <GeneratorRules generators={result.generators ?? []} />
            <ActionList result={result} household={household} isToday={!isTomorrow} />
            <div className="plan-actions no-print">
              <button type="button" className="secondary" onClick={onExportCalendar}>
                🔔 Нагадування в календар
              </button>
              <button type="button" className="secondary" onClick={() => window.print()}>
                🖨️ Друкувати
              </button>
            </div>
          </>
        )}
      </section>

      {result && <EnergyBalance result={result} />}
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

function NextStep({ result, now }) {
  const next = result.schedule.filter((s) => !s.skipped && s.startSlot >= now).sort((a, b) => a.startSlot - b.startSlot)[0];
  if (!next) return null;
  return (
    <div className="next-step">
      <span className="next-icon" aria-hidden="true">
        {iconFor(next.name)}
      </span>
      <div>
        <div className="next-label">Наступне, що варто ввімкнути</div>
        <div className="next-title">
          {next.name} о {next.start}
        </div>
      </div>
    </div>
  );
}

function until(slots) {
  const min = Math.max(0, Math.round(slots * SLOT_MIN));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} хв`;
  return m ? `${h} год ${m} хв` : `${h} год`;
}

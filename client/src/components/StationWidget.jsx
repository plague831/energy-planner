// Головна картка «Сьогодні» у стилі віджетів зарядних станцій: заряд, скільки станція віддає чи
// бере зараз, скільки триває відключення і на скільки ще вистачить; під нею — графік «зараз і далі».
// Поки дані розрахункові (з плану), картка так і підписана; живі дані зі станції підставляться сюди ж.
import { solarState } from '../solar.js';

const SLOT_MIN = 15;
const SLOT_H = SLOT_MIN / 60;

const toSlot = (t) => {
  const [h, m] = t.split(':').map(Number);
  return Math.round((h * 60 + m) / SLOT_MIN);
};
const slotTime = (s) => `${String(Math.floor((s * SLOT_MIN) / 60) % 24).padStart(2, '0')}:${String((s * SLOT_MIN) % 60).padStart(2, '0')}`;
// Тривалість у форматі годинника: 3:54.
const clockSpan = (hours) => {
  const min = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
};
const untilText = (slots) => {
  const min = Math.max(0, Math.round(slots * SLOT_MIN));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} хв`;
  return m ? `${h} год ${m} хв` : `${h} год`;
};
const fmt = (x) => Math.round(x).toLocaleString('uk-UA');

// Скільки станція віддає в цей слот: під час відключення те, що не покрили сонце й генератор.
const dischargeW = (t) => (t.gridOn ? 0 : Math.max(0, (t.servedW ?? 0) + (t.chargeW ?? 0) - (t.solarW ?? 0) - (t.generatorW ?? 0)));

// Відрізки доби «світло є / світла немає» за графіком (з уточненнями людини), від 0 до 96 слотів.
export function daySegments(outages) {
  const off = new Uint8Array(96);
  for (const o of outages ?? []) {
    const from = toSlot(o.from);
    let to = toSlot(o.to);
    if (to <= from) to += 96;
    for (let t = from; t < Math.min(to, 96); t++) off[t] = 1;
    // Хвіст відключення через північ (22:00–02:00) — на початку доби.
    for (let t = 96; t < to; t++) off[t - 96] = 1;
  }
  const segments = [];
  for (let t = 0; t < 96; t++) {
    const last = segments.at(-1);
    if (last && last.off === Boolean(off[t])) last.to = t + 1;
    else segments.push({ from: t, to: t + 1, off: Boolean(off[t]) });
  }
  return segments;
}

export function StationCard({ household, result, now, children }) {
  const battery = household.battery;
  const trace = result?.nominal?.trace;
  if (!battery?.capacityWh || !trace?.length) return null;
  const capacity = battery.capacityWh;
  const minPct = battery.minSocPct ?? 10;
  const slot = Math.min(trace.length - 1, Math.floor(now));
  const pct = (wh) => Math.max(0, Math.min(100, (wh / capacity) * 100));
  const socNow = pct(trace[slot].energyWh);
  const outW = dischargeW(trace[slot]);
  const inW = trace[slot].chargeW ?? 0;

  // Поточний відрізок графіка: від його початку рахуємо «без світла» чи «світло є».
  const segments = daySegments(household.outages);
  const current = segments.find((s) => slot >= s.from && slot < s.to) ?? segments[0];
  const elapsedH = (now - current.from) * SLOT_H;
  // Підсумки (віддано, заряджено, зміна заряду) — лише за ту частину відрізка, де план теж бачив
  // той самий стан світла: якщо графік змінився посеред дня, минулі слоти лишаються від старого плану.
  // Так само, якщо план перебудовано з нового заряду (людина змінила станцію чи «Заряд зараз»):
  // минулі слоти лишаються від розрахунку з іншим зарядом, і на стику заряд стрибає.
  let floor = current.from;
  const restart = trace.findIndex((t) => !t.past);
  if (restart > current.from && restart <= slot) {
    const t = trace[restart];
    const oneSlot = (Math.max(dischargeW(t), t.chargeW ?? 0) * SLOT_H) / 0.92;
    if (Math.abs(trace[restart - 1].energyWh - t.energyWh) > oneSlot + capacity * 0.03) floor = restart;
  }
  let startSlot = slot;
  while (startSlot > floor && Boolean(trace[startSlot - 1].gridOn) === Boolean(trace[slot].gridOn)) startSlot--;
  const since = startSlot > current.from ? ` з ${slotTime(startSlot)}` : '';
  const span = trace.slice(startSlot, slot + 1);
  const statsH = Math.max(SLOT_H, (now - startSlot) * SLOT_H);
  // Заряд на початку підсумків. Якщо вони починаються з перебудови плану, попередній слот — зі
  // старого розрахунку, тож заряд «до» відновлюємо з першого нового слота.
  const first = trace[startSlot];
  const socStart =
    startSlot === restart && floor === restart
      ? pct(first.energyWh + ((dischargeW(first) / 0.92 - (first.chargeW ?? 0) * 0.92) * SLOT_H))
      : pct((trace[startSlot - 1] ?? first).energyWh);
  const delta = Math.round(socNow) - Math.round(socStart);

  let badge;
  if (current.off) {
    const given = span.reduce((sum, t) => sum + dischargeW(t) * SLOT_H, 0);
    const avg = given / statsH;
    const leftH = outW > 0 ? Math.max(0, trace[slot].energyWh - (capacity * minPct) / 100) / outW : null;
    badge = {
      kind: 'off',
      icon: '⚡',
      label: 'Без світла',
      time: clockSpan(elapsedH),
      line: `Віддано${since}${avg > 0 ? ` · сер. ${fmt(avg)} Вт` : ''}`,
      value: `${fmt(given)} Вт·год`,
      footLabel: `До ${minPct}%`,
      foot: leftH === null ? '—' : clockSpan(leftH),
    };
  } else {
    const taken = span.reduce((sum, t) => sum + (t.chargeW ?? 0) * SLOT_H, 0);
    const avg = taken / statsH;
    const toFullH = inW > 0 ? (capacity - trace[slot].energyWh) / inW : null;
    badge = {
      kind: 'on',
      icon: '🔌',
      label: 'Світло є',
      time: clockSpan(elapsedH),
      line: `Заряджено${since}${avg > 0 ? ` · сер. ${fmt(avg)} Вт` : ''}`,
      value: `${fmt(taken)} Вт·год`,
      footLabel: socNow >= 99 ? 'Заряджена' : 'До 100%',
      foot: socNow >= 99 ? '✓' : toFullH === null ? '—' : clockSpan(toFullH),
    };
  }

  const stations = (household.sources ?? []).filter((s) => s.kind === 'battery');
  const name = stations.length === 1 ? stations[0].name : stations.length > 1 ? `Станції (${stations.length})` : 'Зарядна станція';
  const model = stations.length === 1 ? stations[0].model : null;
  const updated = new Date();
  const mode = outW > 1 ? 'out' : inW > 1 ? 'in' : 'idle';

  return (
    <section className="card station-card">
      <div className="sc-head">
        <div>
          <div className="sc-name">
            <span className="sc-dot" title="Розрахунок за планом" aria-hidden="true" />
            {name}
          </div>
          <div className="sc-sub">{[model, `${fmt(capacity)} Вт·год`, 'розрахунок'].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="sc-updated">
          Оновл. {String(updated.getHours()).padStart(2, '0')}:{String(updated.getMinutes()).padStart(2, '0')}
        </div>
      </div>

      <div className="sc-body">
        <StationPicture pct={socNow} mode={mode} />
        <div className={`sc-badge ${badge.kind}`}>
          <div className="sc-badge-label">
            <span aria-hidden="true">{badge.icon}</span> {badge.label}
          </div>
          <div className="sc-badge-time">{badge.time}</div>
          <div className="sc-badge-line">{badge.line}</div>
          <div className="sc-badge-value">{badge.value}</div>
          <div className="sc-badge-foot">
            <span>{badge.footLabel}</span>
            <strong>{badge.foot}</strong>
          </div>
        </div>
      </div>

      <div className="sc-soc">
        <span className="sc-soc-value">≈ {Math.round(socNow)}%</span>
        {Math.abs(delta) >= 1 && (
          <span className={`sc-soc-delta ${delta < 0 ? 'down' : 'up'}`}>
            {Math.round(socStart)}% → {Math.round(socNow)}% · {delta > 0 ? '+' : '−'}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className={`sc-bar ${mode}`} role="img" aria-label={`Заряд ${Math.round(socNow)}%`}>
        <div style={{ width: `${socNow}%` }} />
        <i style={{ left: `${minPct}%` }} title={`Мінімум ${minPct}%`} />
      </div>

      <div className="sc-flows">
        <div>
          <span className="sc-flow-icon out" aria-hidden="true">
            ↓
          </span>
          <span className="sc-flow-label">Віддає</span>
          <strong>≈ {fmt(outW)} Вт</strong>
        </div>
        <div>
          <span className="sc-flow-icon in" aria-hidden="true">
            ↑
          </span>
          <span className="sc-flow-label">Заряджається</span>
          <strong>≈ {fmt(inW)} Вт</strong>
        </div>
      </div>
      <p className="sc-disclaimer">
        <span aria-hidden="true">ⓘ</span> Це розрахунок, а не показ самої станції: заряд і потужність пораховано за вашим списком приладів у «Мій дім» і
        планом. Реальні значення можуть відрізнятися, тож перед важливим рішенням звіряйтеся з екраном станції.
      </p>
      {children}
    </section>
  );
}

// Схематична станція з екраном, на якому видно заряд.
function StationPicture({ pct, mode }) {
  return (
    <svg className={`sc-picture ${mode}`} viewBox="0 0 200 130" role="img" aria-label="Зарядна станція">
      <rect className="sc-pic-body" x="8" y="18" width="184" height="104" rx="14" />
      <rect className="sc-pic-handle" x="62" y="6" width="76" height="16" rx="6" />
      <rect className="sc-pic-screen" x="104" y="32" width="74" height="40" rx="6" />
      <text className="sc-pic-pct" x="141" y="59" textAnchor="middle">
        {Math.round(pct)}%
      </text>
      {[0, 1, 2].map((i) => (
        <rect key={i} className="sc-pic-port" x={104 + i * 26} y="82" width="20" height="26" rx="4" />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} className="sc-pic-vent" x="22" y={34 + i * 14} width="64" height="6" rx="3" />
      ))}
    </svg>
  );
}

// «Зараз і далі»: поточний відрізок графіка й наступний, з попередженням перед відключенням.
export function ScheduleCard({ household, now, actual, actualNote, onReport }) {
  const slot = Math.floor(now);
  const segments = daySegments(household.outages);
  const index = segments.findIndex((s) => slot >= s.from && slot < s.to);
  const current = segments[index];
  const next = segments[index + 1];
  const possible = (household.possibleOutages ?? []).map((o) => ({ from: toSlot(o.from), to: toSlot(o.to) || 96 }));
  const possibleIn = (seg) => !seg.off && possible.some((p) => p.from < seg.to && p.to > seg.from);
  const blocks = [current, next].filter(Boolean);
  const warnSoon = next?.off && next.from - now <= 8; // відключення за 2 години чи раніше

  const title = (seg, isCurrent) =>
    seg.off
      ? isCurrent && actual?.type === 'off'
        ? `світла немає (ви повідомили о ${actual.time})`
        : 'відключення'
      : isCurrent && actual?.type === 'on'
        ? `світло є (повернулось о ${actual.time})`
        : 'світло є';

  return (
    <section className="card schedule-card">
      <div className="sch-blocks">
        {blocks.map((seg, i) => (
          <div key={seg.from} className={`sch-block ${seg.off ? 'off' : 'on'} ${i === 0 ? 'current' : ''} ${possibleIn(seg) ? 'possible' : ''}`}>
            <span className="sch-icon" aria-hidden="true">
              {seg.off ? '🌑' : '💡'}
            </span>
            <span className="sch-time">
              {slotTime(seg.from)} – {seg.to >= 96 ? '24:00' : slotTime(seg.to)}
            </span>
            <span className="sch-label">
              {i === 0 ? `Зараз ${title(seg, true)}` : `Далі ${title(seg, false)}`}
              {i === 0 && ` · ще ${untilText(seg.to - now)}`}
              {possibleIn(seg) && ' · можливе відключення'}
            </span>
          </div>
        ))}
        {warnSoon && (
          <span className="sch-warn" title={`Відключення через ${untilText(next.from - now)}`} aria-label={`Відключення через ${untilText(next.from - now)}`}>
            ⚠️
          </span>
        )}
      </div>
      {!next && <p className="muted sch-note">Сьогодні далі змін за графіком немає.</p>}
      {actualNote && <p className="actual-note">{actualNote}</p>}
      <div className="report-buttons">
        <span className="muted">Насправді інакше?</span>
        {current?.off ? (
          <button type="button" className="secondary" onClick={() => onReport('on')}>
            💡 Світло вже є
          </button>
        ) : (
          <button type="button" className="secondary" onClick={() => onReport('off')}>
            🌑 Світла немає
          </button>
        )}
      </div>
    </section>
  );
}

// Сонячні панелі в тому ж стилі: скільки дають зараз, скільки вже вироблено й чекати за день,
// скільки до заходу сонця. Розрахунок за прогнозом погоди (або заданими вручну сонячними годинами).
export function SolarCard({ household, result, now }) {
  const st = solarState(household, result?.nominal?.trace, now);
  if (!st) return null;
  const { isDay, beforeSunrise, rise, set, nextRise, peakW, nowW, produced, total, tomorrowWh, toHome, toCharge, cloud, source, name } = st;
  const minute = now * SLOT_MIN;
  const clock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  const kwh = (wh) => (wh / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  const badge = isDay
    ? {
        kind: 'day',
        label: 'День',
        time: clockSpan((set - minute) / 60),
        timeNote: 'до заходу сонця',
        line: `Вироблено з ${clock(rise)}`,
        value: `${kwh(produced)} кВт·год`,
        footLabel: 'За весь день',
        foot: `≈ ${kwh(total)} кВт·год`,
      }
    : {
        kind: 'night',
        label: 'Ніч',
        time: beforeSunrise ? clock(rise) : nextRise !== null ? clock(nextRise) : '—',
        timeNote: beforeSunrise ? 'схід сонця' : 'схід сонця завтра',
        line: beforeSunrise ? 'Сьогодні чекати' : 'Сьогодні вироблено',
        value: `${kwh(beforeSunrise ? total : produced)} кВт·год`,
        footLabel: 'Завтра',
        foot: tomorrowWh > 0 ? `≈ ${kwh(tomorrowWh)} кВт·год` : '—',
      };

  return (
    <section className="card station-card solar-card">
      <div className="sc-head">
        <div>
          <div className="sc-name">
            <span className="sc-dot" title="Розрахунок, не вимірювання" aria-hidden="true" />
            {name}
          </div>
          <div className="sc-sub">{[`${fmt(peakW)} Вт`, source, Number.isFinite(cloud) ? `хмарність ${cloud}%` : null].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      <div className="sc-body">
        <SunPicture progress={isDay ? (minute - rise) / (set - rise) : null} />
        <div className={`sc-badge ${badge.kind}`}>
          <div className="sc-badge-label">
            <span aria-hidden="true">{isDay ? '☀️' : '🌙'}</span> {badge.label}
          </div>
          <div className="sc-badge-time">{badge.time}</div>
          <div className="sc-badge-note">{badge.timeNote}</div>
          <div className="sc-badge-line">{badge.line}</div>
          <div className="sc-badge-value">{badge.value}</div>
          <div className="sc-badge-foot">
            <span>{badge.footLabel}</span>
            <strong>{badge.foot}</strong>
          </div>
        </div>
      </div>

      <div className="sc-soc">
        <span className="sc-soc-value">≈ {fmt(nowW)} Вт</span>
        <span className="sc-soc-delta solar">{Math.round((nowW / peakW) * 100)}% від {fmt(peakW)} Вт</span>
      </div>
      <div className="sc-bar solar" role="img" aria-label={`Зараз ≈ ${fmt(nowW)} Вт`}>
        <div style={{ width: `${Math.min(100, (nowW / peakW) * 100)}%` }} />
      </div>

      {isDay && toHome !== null && (
        <div className="sc-flows">
          <div>
            <span className="sc-flow-icon home" aria-hidden="true">
              🏠
            </span>
            <span className="sc-flow-label">У дім</span>
            <strong>{fmt(toHome)} Вт</strong>
          </div>
          <div>
            <span className="sc-flow-icon in" aria-hidden="true">
              🔋
            </span>
            <span className="sc-flow-label">На заряд станції</span>
            <strong>{fmt(toCharge)} Вт</strong>
          </div>
        </div>
      )}
      <p className="sc-disclaimer">
        <span aria-hidden="true">ⓘ</span> Це розрахунок за прогнозом погоди{source === 'за вашими даними' ? ' й вашими сонячними годинами' : ''}, а не вимірювання. Реальна
        віддача панелей залежить від хмар, кута й чистоти панелей і може помітно відрізнятися.
      </p>
    </section>
  );
}

// Дуга сонця над горизонтом: де сонце зараз між сходом і заходом.
function SunPicture({ progress }) {
  const angle = progress === null ? null : Math.PI * (1 - progress);
  const cx = 100 + 80 * Math.cos(angle ?? 0);
  const cy = 110 - 80 * Math.sin(angle ?? 0);
  return (
    <svg className="sc-picture" viewBox="0 0 200 130" role="img" aria-label={progress === null ? 'Ніч' : 'Положення сонця'}>
      <path className="sun-arc" d="M 20 110 A 80 80 0 0 1 180 110" />
      <line className="sun-horizon" x1="8" y1="110" x2="192" y2="110" />
      {progress === null ? (
        <circle className="sun-moon" cx="100" cy="50" r="14" />
      ) : (
        <circle className="sun-disc" cx={cx} cy={cy} r="13" />
      )}
      <rect className="sun-panel" x="62" y="114" width="76" height="10" rx="2" />
    </svg>
  );
}

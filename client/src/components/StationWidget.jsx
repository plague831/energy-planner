// Головна картка «Сьогодні» у стилі віджетів зарядних станцій: заряд, скільки станція віддає чи
// бере зараз, скільки триває відключення і на скільки ще вистачить; під нею — графік «зараз і далі».
// Поки дані розрахункові (з плану), картка так і підписана; живі дані зі станції підставляться сюди ж.
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
  let startSlot = slot;
  while (startSlot > current.from && Boolean(trace[startSlot - 1].gridOn) === Boolean(trace[slot].gridOn)) startSlot--;
  const span = trace.slice(startSlot, slot + 1);
  const statsH = Math.max(SLOT_H, (now - startSlot) * SLOT_H);
  const socStart = pct((trace[startSlot - 1] ?? trace[startSlot]).energyWh);
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
      line: `Віддано${avg > 0 ? ` · сер. ${fmt(avg)} Вт` : ''}`,
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
      line: `Заряджено${avg > 0 ? ` · сер. ${fmt(avg)} Вт` : ''}`,
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
          <div className="sc-sub">{[model, `${fmt(capacity)} Вт·год`, 'за планом'].filter(Boolean).join(' · ')}</div>
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
        <span className="sc-soc-value">{Math.round(socNow)}%</span>
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
          <strong>{fmt(outW)} Вт</strong>
        </div>
        <div>
          <span className="sc-flow-icon in" aria-hidden="true">
            ↑
          </span>
          <span className="sc-flow-label">Заряджається</span>
          <strong>{fmt(inW)} Вт</strong>
        </div>
      </div>
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

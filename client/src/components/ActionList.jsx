import { useEffect, useState } from 'react';

const SLOT_MIN = 15;
const time = (slot) => {
  const m = (slot * SLOT_MIN) % (24 * 60 + 1);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// План як список дій по годинах: що й коли вмикати, коли відключення і що робить станція.
// Для плану на сьогодні минулі події приглушені, а перед наступною стоїть позначка «зараз».
export default function ActionList({ result, household, isToday }) {
  const [nowSlot, setNowSlot] = useState(currentSlot);
  // Минулі пункти за замовчуванням сховані, щоб на екрані було видно лише те, що попереду (у друці показуються всі).
  const [showPast, setShowPast] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNowSlot(currentSlot()), 60_000);
    return () => clearInterval(id);
  }, []);

  const events = buildEvents(result, household);
  const skipped = result.schedule.filter((s) => s.skipped && !s.missed);
  const missed = result.schedule.filter((s) => s.missed);
  const nextIndex = isToday ? events.findIndex((e) => e.slot >= nowSlot) : -1;
  const pastCount = isToday ? events.filter((e) => e.slot < nowSlot).length : 0;

  return (
    <div className={`action-list ${showPast ? 'show-past' : ''}`}>
      {pastCount > 0 && (
        <button type="button" className="link-button past-toggle no-print" onClick={() => setShowPast(!showPast)}>
          {showPast ? 'Сховати те, що вже минуло' : `Показати, що вже минуло (${pastCount})`}
        </button>
      )}
      <ol>
        {events.map((e, i) => (
          <li key={`${e.slot}-${i}`} className={`action ${e.kind} ${isToday && e.slot < nowSlot ? 'past' : ''}`}>
            {i === nextIndex && (
              <div className="now-marker">
                <span>Зараз {time(nowSlot)}</span>
              </div>
            )}
            <span className="action-time">{e.time}</span>
            <span className="action-dot" aria-hidden="true" />
            <div className="action-body">
              <div className="action-title">{e.title}</div>
              {e.detail && <div className="action-detail">{e.detail}</div>}
            </div>
          </li>
        ))}
        {isToday && nextIndex === -1 && events.length > 0 && (
          <li className="action done">
            <div className="now-marker">
              <span>Зараз {time(nowSlot)}: усі дії на сьогодні виконано</span>
            </div>
          </li>
        )}
      </ol>
      {missed.length > 0 && <p className="action-skipped">Час для цього вже минув: {missed.map((s) => s.name).join(', ')}.</p>}
      {skipped.length > 0 && (
        <p className="action-skipped">
          Сьогодні краще не вмикати: {skipped.map((s) => s.name).join(', ')}.
        </p>
      )}
    </div>
  );
}

function currentSlot() {
  const d = new Date();
  return Math.floor((d.getHours() * 60 + d.getMinutes()) / SLOT_MIN);
}

function buildEvents(result, household) {
  const trace = result.nominal.trace;
  const capacity = household.battery?.capacityWh;
  const failed = new Set(result.nominal.failedIds);
  const pct = (wh) => `${Math.round((wh / capacity) * 100)}%`;
  const energyAt = (slot) => (slot === 0 ? trace[0].energyWh - (trace[0].chargeW * SLOT_MIN) / 60 : trace[slot - 1].energyWh);
  const events = [];

  const genSlots = trace.map((t) => (t.generatorW ?? 0) > 0);
  for (const [from, to] of runs(trace.map((t) => !t.gridOn))) {
    const withGen = genSlots.slice(from, to).some(Boolean);
    const detail = capacity
      ? `Живлення від станції${withGen ? ' і генератора' : ''}: заряд ${pct(energyAt(from))} → ${pct(trace[to - 1].energyWh)}.`
      : withGen
        ? 'Живлення від генератора.'
        : 'Резервного живлення немає, прилади не працюватимуть.';
    events.push({ slot: from, time: time(from), kind: 'outage', title: `Відключення до ${time(to)}`, detail });
    if (to < trace.length) events.push({ slot: to, time: time(to), kind: 'grid', title: 'Світло має повернутися' });
  }

  if (capacity) {
    for (const [from, to] of runs(trace.map((t) => t.chargeW > 0))) {
      events.push({
        slot: from,
        time: time(from),
        kind: 'charge',
        title: `Станція заряджається до ${time(to)}`,
        detail: `Заряд ${pct(energyAt(from))} → ${pct(trace[to - 1].energyWh)}.`,
      });
    }
  }

  // Окремо для кожного генератора: коли вмикати, до котрої години і скільки пального лишиться.
  (result.generators ?? []).forEach((g, k) => {
    const on = trace.map((t) => Boolean(t.generatorsOn?.[k]));
    for (const [from, to] of runs(on)) {
      const fuel = trace[to - 1].generatorsFuelPct?.[k];
      events.push({
        slot: from,
        time: time(from),
        kind: 'generator',
        title: `Увімкніть ${g.name.charAt(0).toLowerCase()}${g.name.slice(1)} до ${time(to)}`,
        detail: `${capacity ? `Заряд станції впав до ${pct(energyAt(from))}. ` : ''}${Number.isFinite(fuel) ? `Пального залишиться ≈ ${Math.round(fuel)}%.` : ''}`,
      });
    }
  });

  for (const o of household.possibleOutages ?? []) {
    const slot = Math.round((Number(o.from.slice(0, 2)) * 60 + Number(o.from.slice(3))) / SLOT_MIN);
    events.push({ slot, time: o.from, kind: 'possible', title: `Можливе відключення до ${o.to}`, detail: 'YASNO попереджає про можливе відключення; краще не планувати на цей час важливе.' });
  }

  const outageSlots = new Set(trace.filter((t) => !t.gridOn).map((t) => t.slot));
  for (const s of result.schedule) {
    if (s.skipped) continue;
    const onBattery = Array.from({ length: s.endSlot - s.startSlot }, (_, k) => s.startSlot + k).some((t) => outageSlots.has(t));
    const slots = Array.from({ length: s.endSlot - s.startSlot }, (_, k) => s.startSlot + k);
    const genShare = slots.filter((t) => genSlots[t]).length / slots.length;
    const source = genShare === 1 ? ', від генератора' : genShare > 0 ? ', частково від генератора' : onBattery ? ', частково від станції' : '';
    const notes = [`Працює до ${s.end}${source}.`];
    if (failed.has(s.id)) notes.push('Увага: за цим графіком прилад може не відпрацювати до кінця.');
    events.push({ slot: s.startSlot, time: s.start, kind: failed.has(s.id) ? 'appliance warn' : 'appliance', title: `Увімкніть: ${s.name}`, detail: notes.join(' ') });
  }

  const order = { grid: 0, outage: 1, possible: 2, generator: 3, charge: 4, appliance: 5 };
  return events.sort((a, b) => a.slot - b.slot || order[a.kind.split(' ')[0]] - order[b.kind.split(' ')[0]]);
}

function runs(flags) {
  const out = [];
  let start = null;
  flags.forEach((f, t) => {
    if (f && start === null) start = t;
    if (!f && start !== null) {
      out.push([start, t]);
      start = null;
    }
  });
  if (start !== null) out.push([start, flags.length]);
  return out;
}

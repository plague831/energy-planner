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
  useEffect(() => {
    const id = setInterval(() => setNowSlot(currentSlot()), 60_000);
    return () => clearInterval(id);
  }, []);

  const events = buildEvents(result, household);
  const skipped = result.schedule.filter((s) => s.skipped);
  const nextIndex = isToday ? events.findIndex((e) => e.slot >= nowSlot) : -1;

  return (
    <div className="action-list">
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

  for (const [from, to] of runs(trace.map((t) => !t.gridOn))) {
    const detail = capacity
      ? `Живлення від станції: заряд ${pct(energyAt(from))} → ${pct(trace[to - 1].energyWh)}.`
      : 'Зарядної станції немає, прилади не працюватимуть.';
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

  const outageSlots = new Set(trace.filter((t) => !t.gridOn).map((t) => t.slot));
  for (const s of result.schedule) {
    if (s.skipped) continue;
    const onBattery = Array.from({ length: s.endSlot - s.startSlot }, (_, k) => s.startSlot + k).some((t) => outageSlots.has(t));
    const notes = [`Працює до ${s.end}${onBattery ? ', частково від станції' : ''}.`];
    if (failed.has(s.id)) notes.push('Увага: за цим графіком прилад може не відпрацювати до кінця.');
    events.push({ slot: s.startSlot, time: s.start, kind: failed.has(s.id) ? 'appliance warn' : 'appliance', title: `Увімкніть: ${s.name}`, detail: notes.join(' ') });
  }

  const order = { grid: 0, outage: 1, charge: 2, appliance: 3 };
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

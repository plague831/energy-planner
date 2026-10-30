import { iconFor } from '../icons.js';

// «Що можна вмикати зараз»: для кожного приладу проста відповідь замість розкладу —
// ✅ можна зараз, ⚠️ краще о …, ⛔ сьогодні не вийде. Відповідь рахується з того самого плану:
// графік відключень (з уточненнями від людини), заряд станції за планом і час, який обрав алгоритм.
const SLOT_MIN = 15;
const SLOT_H = SLOT_MIN / 60;
const ETA = 0.92; // ККД розряду станції, як у моделі
// Запас на те, що відключення може початися раніше за графік (як у моделі невизначеності): 30 хв.
const MARGIN_SLOTS = 2;

const toSlot = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return Math.round((h * 60 + m) / SLOT_MIN);
};
const time = (slot) => `${String(Math.floor((slot * SLOT_MIN) / 60) % 24).padStart(2, '0')}:${String((slot * SLOT_MIN) % 60).padStart(2, '0')}`;

// Чи може прилад працювати від моменту start протягом duration слотів.
function checkRun(appliance, start, { trace, battery, gridMaxW, baseLoadAt }) {
  const duration = Math.max(1, Math.round(Number(appliance.durationMin) / SLOT_MIN));
  const end = start + duration;
  if (end > trace.length) return { ok: false, reason: 'Не встигне відпрацювати до кінця доби.' };
  let energy = trace[start]?.energyWh ?? 0;
  let usedBattery = false;
  for (let t = start; t < end; t++) {
    const load = baseLoadAt(t) + Number(appliance.powerW);
    if (trace[t].gridOn) {
      if (load > gridMaxW) return { ok: false, reason: 'Разом з іншими приладами перевищить ліміт мережі.' };
      continue;
    }
    // Відключення: живлення від станції.
    const when = t === start ? 'Зараз немає світла' : `О ${time(t)} почнеться відключення`;
    if (!battery) return { ok: false, reason: `${when}, а резервного живлення немає.`, outageAt: t };
    if (appliance.allowOnBattery === false) return { ok: false, reason: `${when}, а від станції цей прилад не вмикають.`, outageAt: t };
    if (load > battery.inverterMaxW) return { ok: false, reason: `${when}, а станція не витягне ${Number(appliance.powerW).toLocaleString('uk-UA')} Вт.`, outageAt: t };
    energy -= (load * SLOT_H) / ETA;
    usedBattery = true;
    if (energy < battery.minWh) return { ok: false, reason: `${when}, а заряду станції не вистачить до кінця.`, outageAt: t };
  }
  // Ризик: відключення може початися раніше за графік і перервати потужний прилад наприкінці.
  const risky =
    appliance.allowOnBattery === false &&
    trace.slice(end, end + MARGIN_SLOTS).some((t) => !t.gridOn);
  return { ok: true, end, usedBattery, endSoc: battery ? Math.round((energy / battery.capacityWh) * 100) : null, risky };
}

export function trafficLight(household, result, nowSlot) {
  const trace = result?.nominal?.trace;
  if (!trace?.length) return [];
  const now = Math.min(trace.length - 1, Math.max(0, Math.floor(nowSlot)));
  const b = household.battery;
  const battery = b ? { capacityWh: b.capacityWh, minWh: (b.capacityWh * (b.minSocPct ?? 10)) / 100, inverterMaxW: b.inverterMaxW } : null;
  const baseLoads = household.baseLoads ?? [];
  const baseLoadAt = (t) =>
    baseLoads.reduce((sum, l) => {
      if (!l.from || !l.to) return sum + Number(l.powerW);
      const from = toSlot(l.from);
      const to = toSlot(l.to);
      const active = from < to ? t >= from && t < to : t >= from || t < to;
      return active ? sum + Number(l.powerW) : sum;
    }, 0);
  const ctx = { trace, battery, gridMaxW: household.grid?.maxPowerW ?? 5000, baseLoadAt };
  const planned = new Map((result.schedule ?? []).map((s) => [s.id, s]));

  return (household.appliances ?? []).map((a) => {
    const plan = planned.get(a.id);
    const latest = toSlot(a.latest ?? '24:00');
    const duration = Math.max(1, Math.round(Number(a.durationMin) / SLOT_MIN));
    const nowCheck = checkRun(a, now, ctx);
    const plannedLater = plan && !plan.skipped && plan.startSlot > now + 1 ? plan : null;
    const base = { id: a.id, name: a.name, icon: iconFor(a.name) };

    if (nowCheck.ok && !nowCheck.risky) {
      const detail = nowCheck.usedBattery
        ? `Частково від станції, заряд опуститься до ≈ ${nowCheck.endSoc}%.`
        : `Світла вистачить до кінця, до ${time(nowCheck.end)}.`;
      const better = plannedLater && plannedLater.startSlot - now > 4 ? ` За планом найкраще о ${plannedLater.start}.` : '';
      return { ...base, status: 'go', title: 'Можна вмикати зараз', detail: detail + better };
    }
    if (nowCheck.ok && nowCheck.risky) {
      return {
        ...base,
        status: 'wait',
        title: plannedLater ? `Краще о ${plannedLater.start}` : 'Можна, але ризиковано',
        detail: `Закінчить о ${time(nowCheck.end)}, а одразу після цього за графіком відключення: якщо воно почнеться раніше, прилад переріжеться.`,
      };
    }
    if (plannedLater) {
      return { ...base, status: 'wait', title: `Краще о ${plannedLater.start}`, detail: nowCheck.reason };
    }
    // Плану на сьогодні немає: шукаємо найближчий момент, коли прилад таки зможе відпрацювати.
    for (let s = now + 1; s + duration <= Math.min(trace.length, Math.max(latest, now + 1)); s++) {
      if (checkRun(a, s, ctx).ok) return { ...base, status: 'wait', title: `Можна о ${time(s)}`, detail: nowCheck.reason };
    }
    return { ...base, status: 'stop', title: 'Сьогодні краще не вмикати', detail: `${nowCheck.reason} До кінця його вікна (${a.latest ?? '24:00'}) зручного часу немає.` };
  });
}

const ORDER = { go: 0, wait: 1, stop: 2 };
const MARK = { go: '✅', wait: '⚠️', stop: '⛔' };

export default function TrafficLight({ household, result, now }) {
  const items = trafficLight(household, result, now).sort((x, y) => ORDER[x.status] - ORDER[y.status]);
  if (!items.length) return null;
  return (
    <ul className="traffic-light">
      {items.map((it) => (
        <li key={it.id} className={`tl-item ${it.status}`}>
          <span className="tl-icon" aria-hidden="true">
            {it.icon}
          </span>
          <div className="tl-body">
            <div className="tl-name">{it.name}</div>
            <div className="tl-detail">{it.detail}</div>
          </div>
          <div className="tl-verdict">
            <span aria-hidden="true">{MARK[it.status]}</span> {it.title}
          </div>
        </li>
      ))}
    </ul>
  );
}

// Нагадування про відключення і дії з плану (як у застосунках «Світло» чи PowerOff, але з порадою, що робити).
// Сповіщення плануються в браузері, тож приходять, поки сайт відкритий (зокрема у фоновій вкладці чи як
// встановлений застосунок). Сповіщення при повністю закритому сайті потребували б push-сервера.
const SETTINGS_KEY = 'energy-planner:notifications';
const SLOT_MIN = 15;

export function readSettings() {
  try {
    return { enabled: false, minutesBefore: 15, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { enabled: false, minutesBefore: 15 };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Без сховища налаштування діють до перезавантаження.
  }
}

export const supported = () => typeof window !== 'undefined' && 'Notification' in window;

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  return Notification.requestPermission();
}

async function show(title, body, tag) {
  const options = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, options);
  } catch {
    // Падаємо на звичайне сповіщення нижче.
  }
  new Notification(title, options);
}

// Події плану на сьогодні, про які варто нагадати: початок відключення, запуск приладів і генератора.
export function upcomingEvents(result, household) {
  const trace = result?.nominal?.trace ?? [];
  const capacity = household.battery?.capacityWh;
  const time = (slot) => `${String(Math.floor((slot * SLOT_MIN) / 60) % 24).padStart(2, '0')}:${String((slot * SLOT_MIN) % 60).padStart(2, '0')}`;
  const events = [];
  for (let t = 1; t < trace.length; t++) {
    if (!trace[t].gridOn && trace[t - 1].gridOn) {
      let end = t;
      while (end < trace.length && !trace[end].gridOn) end++;
      const soc = capacity ? ` Станція: ${Math.round((trace[t - 1].energyWh / capacity) * 100)}%.` : '';
      events.push({ slot: t, tag: `outage-${t}`, title: `Відключення о ${time(t)}`, body: `Світла не буде до ${time(end)} за графіком.${soc}` });
    }
    if ((trace[t].generatorW ?? 0) > 0 && !((trace[t - 1].generatorW ?? 0) > 0)) {
      events.push({ slot: t, tag: `generator-${t}`, title: `Час увімкнути генератор о ${time(t)}`, body: 'Заряд станції наближається до порогу з плану.' });
    }
  }
  for (const s of result?.schedule ?? []) {
    if (s.skipped) continue;
    events.push({ slot: s.startSlot, tag: `appliance-${s.id}-${s.startSlot}`, title: `Увімкніть: ${s.name} о ${s.start}`, body: `За планом працює до ${s.end}.` });
  }
  return events.sort((a, b) => a.slot - b.slot);
}

let timers = [];

// Перепланувати нагадування для плану на сьогодні; повертає кількість запланованих.
export function scheduleNotifications(result, household, { minutesBefore = 15 } = {}) {
  timers.forEach(clearTimeout);
  timers = [];
  if (!supported() || Notification.permission !== 'granted' || !result) return 0;
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  for (const e of upcomingEvents(result, household)) {
    const at = midnight.getTime() + (e.slot * SLOT_MIN - minutesBefore) * 60_000;
    const delay = at - now.getTime();
    if (delay < 0 || delay > 24 * 3600_000) continue;
    const prefix = minutesBefore ? `Через ${minutesBefore} хв: ` : '';
    timers.push(setTimeout(() => show(prefix + e.title, e.body, e.tag), delay));
  }
  return timers.length;
}

export function testNotification() {
  return show('Нагадування увімкнено', 'Так виглядатимуть сповіщення про відключення і дії з плану.', 'test');
}

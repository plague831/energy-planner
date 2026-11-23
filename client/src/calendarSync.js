import { readChoice } from './yasno.js';

// Підписка на календар (посилання .ics), якщо людина її колись оформила: після змін у «Мій дім»
// сервер отримує свіжі дані дому, щоб календар і далі показував актуальний план.
const TOKEN_KEY = 'energy-planner:calendar-token';

function readCalendarToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function syncCalendar(household) {
  const token = readCalendarToken();
  if (!token) return;
  await fetch('/api/calendar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ household, choice: readChoice(), token }),
  }).catch(() => {});
}

// Експорт плану в календар (.ics) і дата за місцевим часом.

const pad = (n) => String(n).padStart(2, '0');

export function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Формування .ics винесено в ядро, щоб той самий формат використовувала й підписка на календар на сервері.
export { planToIcs } from '@energy-planner/core/ics';

export function downloadIcs(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

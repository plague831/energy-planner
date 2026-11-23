// Дата за місцевим часом у форматі РРРР-ММ-ДД.

const pad = (n) => String(n).padStart(2, '0');

export function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

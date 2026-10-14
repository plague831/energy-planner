// Доба поділена на однакові інтервали (слоти). За замовчуванням 15 хвилин, тобто 96 слотів.
export const SLOT_MINUTES = 15;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;
export const SLOT_HOURS = SLOT_MINUTES / 60;

// "08:30" -> номер слоту. "24:00" дозволено як кінець доби.
export function timeToSlot(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
  if (!match) throw new Error(`Некоректний час: "${time}"`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) {
    throw new Error(`Некоректний час: "${time}"`);
  }
  return Math.round((hours * 60 + minutes) / SLOT_MINUTES);
}

export function slotToTime(slot) {
  const total = slot * SLOT_MINUTES;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Інтервал [from, to) у вигляді маски слотів. Якщо to < from, інтервал переходить через північ.
export function fillInterval(mask, from, to, value = 1) {
  const n = mask.length;
  if (from === to) return mask;
  if (from < to) {
    for (let t = Math.max(0, from); t < Math.min(n, to); t++) mask[t] = value;
  } else {
    for (let t = from; t < n; t++) mask[t] = value;
    for (let t = 0; t < to; t++) mask[t] = value;
  }
  return mask;
}

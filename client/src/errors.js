// Повідомлення ядра про некоректні дані («Поле appliances[0].durationMin має бути додатним числом»)
// людською мовою: «Пральна машина»: час роботи має бути більше нуля.
const FIELDS = {
  durationMin: 'час роботи',
  powerW: 'потужність',
  priority: 'важливість',
  capacityWh: 'ємність',
  initialSocPct: 'заряд зараз',
  minSocPct: 'мінімальний заряд',
  targetEndSocPct: 'бажаний заряд на кінець доби',
  maxChargeW: 'потужність заряджання',
  inverterMaxW: 'потужність інвертора',
  maxPowerW: 'потужність',
};
const RULES = [
  [/має бути додатним числом/, 'має бути більше нуля'],
  [/має бути від 0 до 100/, 'має бути від 0 до 100%'],
];

export function humanizeError(message, household) {
  const m = /^Поле (appliances|baseLoads)\[(\d+)\]\.(\w+)|^Поле (battery|grid)\.(\w+)/.exec(message ?? '');
  if (!m) return message;
  const [whole, list, index, listField, group, groupField] = m;
  const field = FIELDS[listField ?? groupField] ?? (listField ?? groupField);
  const subject = list
    ? `«${household?.[list]?.[Number(index)]?.name || (list === 'appliances' ? 'Прилад' : 'Постійний прилад')}»`
    : group === 'battery'
      ? 'Станція'
      : 'Обмеження мережі';
  let rest = message.slice(whole.length).trim();
  for (const [from, to] of RULES) rest = rest.replace(from, to);
  return `${subject}: ${field} ${rest}`;
}

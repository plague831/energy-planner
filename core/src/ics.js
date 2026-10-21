// План у форматі календаря iCalendar (.ics): запуски приладів з нагадуванням за 5 хвилин і відключення за графіком.
// Час записується як місцевий («плаваючий»), тож календар покаже його так само, як на сайті.
// Працює і для плану на добу, і для 48-годинного (прилади з полем day, household.nextDay.outages).

const pad = (n) => String(n).padStart(2, '0');

// date — 'YYYY-MM-DD' першої доби плану; dayOffset — номер доби; time — 'ГГ:ХХ' (може бути ≥ 24:00).
function stamp(date, dayOffset, time) {
  const [h, m] = time.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + dayOffset, 0, h * 60 + m));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00`;
}

const escapeText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

export function planToIcs(result, household, date, { name = 'План енергоспоживання' } = {}) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const events = [];
  const add = ({ uid, day, from, to, summary, description, alarm }) => {
    events.push(
      [
        'BEGIN:VEVENT',
        `UID:${uid}-${date}-${day}@energy-planner`,
        `DTSTAMP:${now}`,
        `DTSTART:${stamp(date, day, from)}`,
        `DTEND:${stamp(date, day, to)}`,
        `SUMMARY:${escapeText(summary)}`,
        description ? `DESCRIPTION:${escapeText(description)}` : null,
        alarm ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(summary)}`, 'TRIGGER:-PT5M', 'END:VALARM'].join('\r\n') : null,
        'END:VEVENT',
      ]
        .filter(Boolean)
        .join('\r\n'),
    );
  };

  for (const s of result.schedule) {
    if (s.skipped) continue;
    add({ uid: `appliance-${s.id}`, day: s.day ?? 0, from: s.start, to: s.end, summary: `Увімкнути: ${s.name}`, description: `За планом енергоспоживання, до ${s.end}.`, alarm: true });
  }
  const days = [household.outages ?? [], ...(household.nextDay ? [household.nextDay.outages ?? []] : [])];
  days.forEach((list, day) =>
    list.forEach((o, i) => {
      // Відключення через північ закінчується наступного дня: «26:00» = 02:00 наступного дня.
      const [fh, fm] = o.from.split(':').map(Number);
      const [th, tm] = o.to.split(':').map(Number);
      const to = th * 60 + tm <= fh * 60 + fm ? `${th + 24}:${pad(tm)}` : o.to;
      add({ uid: `outage-${i}`, day, from: o.from, to, summary: 'Відключення світла за графіком', alarm: false });
    }),
  );

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//energy-planner//UA',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

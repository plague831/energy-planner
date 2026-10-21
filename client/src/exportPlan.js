// Експорт плану в календар (.ics): запуски приладів з нагадуванням за 5 хвилин і відключення за графіком.
// Час записується як місцевий («плаваючий»), тож календар покаже його так само, як на сайті.

const pad = (n) => String(n).padStart(2, '0');

function stamp(date, time) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(`${date}T00:00:00`);
  d.setMinutes(h * 60 + m);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

const escapeText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

export function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function planToIcs(result, household, date) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const events = [];
  const add = ({ uid, from, to, summary, description, alarm }) => {
    events.push(
      [
        'BEGIN:VEVENT',
        `UID:${uid}-${date}@energy-planner`,
        `DTSTAMP:${now}`,
        `DTSTART:${stamp(date, from)}`,
        `DTEND:${stamp(date, to)}`,
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
    add({ uid: `appliance-${s.id}`, from: s.start, to: s.end, summary: `Увімкнути: ${s.name}`, description: `За планом енергоспоживання, до ${s.end}.`, alarm: true });
  }
  (household.outages ?? []).forEach((o, i) => {
    // Відключення через північ закінчується наступного дня: «26:00» = 02:00 наступного дня.
    const [fh, fm] = o.from.split(':').map(Number);
    const [th, tm] = o.to.split(':').map(Number);
    const to = th * 60 + tm <= fh * 60 + fm ? `${th + 24}:${pad(tm)}` : o.to;
    add({ uid: `outage-${i}`, from: o.from, to, summary: 'Відключення світла за графіком', alarm: false });
  });

  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//energy-planner//UA', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

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

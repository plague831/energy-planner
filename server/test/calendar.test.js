import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

let server;
let url;
let dir;
const yasno = {
  regions: async () => [],
  schedule: async () => ({
    groups: [
      {
        group: '4.1',
        today: { status: 'ScheduleApplies', outages: [{ from: '18:00', to: '21:00' }], possible: [] },
        tomorrow: { status: 'WaitingForSchedule', outages: [], possible: [] },
      },
    ],
  }),
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'calendar-'));
  server = createApp({ calendarFile: join(dir, 'calendars.json'), yasno }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

test('підписка на календар: посилання віддає план зі свіжим графіком YASNO', async () => {
  const { household } = await (await fetch(`${url}/api/defaults`)).json();
  const res = await fetch(`${url}/api/calendar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ household, choice: { source: '25:902', group: '4.1' } }),
  });
  const { token } = await res.json();
  assert.match(token, /^[0-9a-f]{32}$/);

  const ics = await fetch(`${url}/api/calendar/${token}.ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  const text = await ics.text();
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /SUMMARY:Увімкнути: /);
  // Відключення з YASNO, а не з демо-даних, і на завтра (графік ще не опубліковано — повторюється сьогоднішній).
  assert.equal((text.match(/T180000/g) ?? []).length, 2);

  // Оновлення тієї самої підписки зберігає токен.
  const again = await (await fetch(`${url}/api/calendar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ household, token }) })).json();
  assert.equal(again.token, token);
});

test('невідома підписка повертає 404', async () => {
  const res = await fetch(`${url}/api/calendar/${'0'.repeat(32)}.ics`);
  assert.equal(res.status, 404);
});

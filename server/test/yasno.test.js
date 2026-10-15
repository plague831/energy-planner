import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { parsePlannedOutages, createYasnoClient } from '../src/sources/yasno.js';
import { sourcesRouter } from '../src/routes/sources.js';

const sample = {
  '2.1': {
    today: {
      slots: [
        { start: 0, end: 240, type: 'Definite' },
        { start: 240, end: 480, type: 'NotPlanned' },
        { start: 480, end: 720, type: 'Definite' },
        { start: 720, end: 750, type: 'Definite' },
        { start: 1290, end: 1440, type: 'Definite' },
      ],
      date: '2026-10-14T00:00:00+03:00',
      status: 'ScheduleApplies',
    },
    tomorrow: { slots: [], date: '2026-10-15T00:00:00+03:00', status: 'WaitingForSchedule' },
    updatedOn: '2026-10-14T13:54:36+00:00',
  },
  '10.1': { today: { slots: [], status: 'NoOutages' }, tomorrow: null },
  '1.1': { today: { slots: [{ start: 600, end: 660, type: 'PossibleOutage' }], status: 'ScheduleApplies' } },
};

test('графік YASNO перетворюється на інтервали відключень', () => {
  const { groups } = parsePlannedOutages(sample);
  assert.deepEqual(
    groups.map((g) => g.group),
    ['1.1', '2.1', '10.1'],
  );
  const g = groups[1];
  assert.equal(g.today.date, '2026-10-14');
  assert.equal(g.today.statusText, 'Діє графік відключень');
  assert.deepEqual(g.today.outages, [
    { from: '00:00', to: '04:00' },
    { from: '08:00', to: '12:30' },
    { from: '21:30', to: '24:00' },
  ]);
  assert.deepEqual(g.tomorrow.outages, []);
  assert.equal(g.tomorrow.status, 'WaitingForSchedule');
});

test('можливі відключення йдуть окремо від точних', () => {
  const day = parsePlannedOutages(sample).groups[0].today;
  assert.deepEqual(day.outages, []);
  assert.deepEqual(day.possible, [{ from: '10:00', to: '11:00' }]);
});

test('межі інтервалів вирівнюються на сітку 15 хвилин', () => {
  const { groups } = parsePlannedOutages({ '1.1': { today: { slots: [{ start: 125, end: 190, type: 'Definite' }] } } });
  assert.deepEqual(groups[0].today.outages, [{ from: '02:00', to: '03:15' }]);
});

test('клієнт кешує відповіді YASNO', async () => {
  let calls = 0;
  const client = createYasnoClient({ fetchJson: async () => (calls++, sample) });
  await client.schedule(25, 902);
  await client.schedule(25, 902);
  assert.equal(calls, 1);
});

test('маршрут перевіряє параметри і повідомляє про недоступність YASNO', async () => {
  const failing = { regions: async () => [], schedule: async () => { throw new Error('timeout'); } };
  const app = express().use('/api/sources', sourcesRouter({ yasno: failing }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/sources/yasno/schedule`;
  try {
    assert.equal((await fetch(`${url}?region=abc&dso=1`)).status, 400);
    const res = await fetch(`${url}?region=25&dso=902`);
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /timeout/);
  } finally {
    server.close();
  }
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let url;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('сервер відповідає на перевірку стану', async () => {
  const res = await fetch(`${url}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('план будується для демонстраційних даних', async () => {
  const { household } = await (await fetch(`${url}/api/defaults`)).json();
  const res = await fetch(`${url}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ household, algorithm: 'greedy' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.schedule.length, household.appliances.length);
  assert.ok(body.robustness.scenarios > 0);
});

test('некоректні дані повертають помилку 400 з поясненням', async () => {
  const res = await fetch(`${url}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ household: { outages: [{ from: '25:00', to: '26:00' }] }, algorithm: 'greedy' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Некоректний час/);
});

test('без бази даних маршрути кабінету відповідають 503', async () => {
  const res = await fetch(`${url}/api/households`);
  assert.equal(res.status, 503);
});

test('невідомий маршрут API повертає 404', async () => {
  const res = await fetch(`${url}/api/nothing-here`);
  assert.equal(res.status, 404);
});

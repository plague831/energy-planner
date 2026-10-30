import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demoHousehold } from '@energy-planner/core/examples';
import '../src/env.js';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Тести працюють з реальною базою. Без TEST_DATABASE_URL вони пропускаються.
// УВАГА: схема public у цій базі очищається перед запуском.
const connectionString = process.env.TEST_DATABASE_URL;
const opts = { skip: connectionString ? false : 'не задано TEST_DATABASE_URL' };

let db;
let server;
let url;

before(async () => {
  if (!connectionString) return;
  db = createPool(connectionString);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  server = createApp({ db }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await db?.end();
});

// Мінімальний клієнт, що пам'ятає cookie сесії, як браузер.
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const { outages, ...demoWithoutOutages } = demoHousehold;
const demo = { name: 'Квартира', ...demoWithoutOutages };

test('реєстрація, вхід і вихід', opts, async () => {
  const api = client();
  let r = await api('POST', '/api/auth/register', { email: 'Olena@Example.com', password: 'secret123', name: 'Олена' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.email, 'olena@example.com');

  r = await api('GET', '/api/auth/me');
  assert.equal(r.body.user.name, 'Олена');

  r = await api('POST', '/api/auth/register', { email: 'olena@example.com', password: 'other1234' });
  assert.equal(r.status, 409);

  assert.equal((await api('POST', '/api/auth/logout')).status, 204);
  assert.equal((await api('GET', '/api/auth/me')).status, 401);

  r = await api('POST', '/api/auth/login', { email: 'olena@example.com', password: 'wrong-pass' });
  assert.equal(r.status, 401);
  r = await api('POST', '/api/auth/login', { email: 'olena@example.com', password: 'secret123' });
  assert.equal(r.status, 200);
  assert.equal((await api('GET', '/api/auth/me')).status, 200);
});

test('короткий пароль і погана пошта відхиляються', opts, async () => {
  const api = client();
  assert.equal((await api('POST', '/api/auth/register', { email: 'a@b.c', password: '123' })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { email: 'not-an-email', password: 'secret123' })).status, 400);
});

test('кабінет недоступний без входу', opts, async () => {
  const api = client();
  assert.equal((await api('GET', '/api/households')).status, 401);
});

test('домогосподарство зберігається і читається без втрат', opts, async () => {
  const api = client();
  await api('POST', '/api/auth/register', { email: 'house@example.com', password: 'secret123' });

  let r = await api('POST', '/api/households', demo);
  assert.equal(r.status, 201);
  const { id, updatedAt, sources, ...saved } = r.body;
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), JSON.parse(JSON.stringify(demo)));
  // Старий формат (одна станція в battery) зберігається як одне джерело-станція.
  assert.deepEqual(sources.map((s) => [s.kind, s.capacityWh]), [['battery', demo.battery.capacityWh]]);

  r = await api('PUT', `/api/households/${id}`, { ...demo, name: 'Дача', battery: null, appliances: demo.appliances.slice(0, 2) });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Дача');
  assert.equal(r.body.battery, null);
  assert.equal(r.body.appliances.length, 2);

  r = await api('GET', '/api/households');
  assert.deepEqual(r.body.map((h) => [h.name, h.applianceCount]), [['Дача', 2]]);
});

test('кілька джерел живлення зберігаються і читаються без втрат', opts, async () => {
  const api = client();
  await api('POST', '/api/auth/register', { email: 'sources@example.com', password: 'secret123' });
  const { battery, ...rest } = demo;
  const sources = [
    { id: 'b1', kind: 'battery', name: 'Станція', model: 'EcoFlow River 2 Pro', capacityWh: 768, initialSocPct: 80, minSocPct: 10, targetEndSocPct: 60, maxChargeW: 940, inverterMaxW: 800 },
    { id: 'b2', kind: 'battery', name: 'Станція 2', capacityWh: 256, initialSocPct: 40, minSocPct: 20, targetEndSocPct: 50, maxChargeW: 300, inverterMaxW: 300 },
    { id: 'g1', kind: 'generator', name: 'Генератор', ratedW: 2500, tankHoursAtHalf: 8.5, fuelPct: 75 },
    { id: 's1', kind: 'solar', name: 'Панелі на балконі', peakW: 800, sunHours: 3, forecast: true, place: 'Київ', lat: 50.45, lon: 30.52 },
    { id: 's2', kind: 'solar', name: 'Панелі на даху', peakW: 1200, sunHours: 2.5, forecast: false },
  ];

  let r = await api('POST', '/api/households', { ...rest, sources });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.sources, sources);
  // Еквівалентна станція для планувальника: ємності й потужності додаються, заряд середньозважений.
  assert.equal(r.body.battery.capacityWh, 1024);
  assert.equal(r.body.battery.inverterMaxW, 1100);
  assert.equal(r.body.battery.initialSocPct, 70);

  r = await api('POST', `/api/households/${r.body.id}/plans`, { outages: [{ from: '18:00', to: '22:00' }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.generators.length, 1);

  r = await api('POST', '/api/households', { ...rest, sources: [{ kind: 'wind', name: 'Вітряк' }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /sources\[0\]\.kind/);
});

test('некоректне домогосподарство повертає 400 з поясненням', opts, async () => {
  const api = client();
  await api('POST', '/api/auth/register', { email: 'bad@example.com', password: 'secret123' });
  const r = await api('POST', '/api/households', { ...demo, appliances: [{ name: 'Бойлер', powerW: 2000, durationMin: 120, earliest: '10:00', latest: '11:00' }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /не вміщується/);
});

test('чужі дані недоступні', opts, async () => {
  const owner = client();
  const stranger = client();
  await owner('POST', '/api/auth/register', { email: 'owner@example.com', password: 'secret123' });
  await stranger('POST', '/api/auth/register', { email: 'stranger@example.com', password: 'secret123' });
  const { body: house } = await owner('POST', '/api/households', demo);
  const { body: schedule } = await owner('POST', `/api/households/${house.id}/schedules`, { name: 'Черга 3', outages });

  assert.equal((await stranger('GET', `/api/households/${house.id}`)).status, 404);
  assert.equal((await stranger('PUT', `/api/households/${house.id}`, demo)).status, 404);
  assert.equal((await stranger('DELETE', `/api/households/${house.id}`)).status, 404);
  assert.equal((await stranger('GET', `/api/schedules/${schedule.id}`)).status, 404);
  assert.equal((await stranger('POST', `/api/households/${house.id}/plans`, { algorithm: 'greedy' })).status, 404);
});

test('графік відключень, план і історія планів', opts, async () => {
  const api = client();
  await api('POST', '/api/auth/register', { email: 'plan@example.com', password: 'secret123' });
  const { body: house } = await api('POST', '/api/households', demo);

  let r = await api('POST', `/api/households/${house.id}/schedules`, { name: 'Черга 3', day: '2026-10-15', outages });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.outages, outages);
  assert.equal(r.body.day, '2026-10-15');
  const schedule = r.body;

  r = await api('PUT', `/api/schedules/${schedule.id}`, { name: 'Черга 3', day: '2026-10-15', outages: [{ from: '20:00', to: '24:00' }] });
  assert.deepEqual(r.body.outages, [{ from: '20:00', to: '24:00' }]);

  r = await api('POST', `/api/households/${house.id}/schedules`, { name: 'Помилка', outages: [{ from: '10:00', to: '10:00' }] });
  assert.equal(r.status, 400);

  r = await api('POST', `/api/households/${house.id}/plans`, { scheduleId: schedule.id, algorithm: 'greedy' });
  assert.equal(r.status, 201);
  assert.equal(r.body.scheduleId, schedule.id);
  assert.equal(r.body.schedule.length, demo.appliances.length);
  const planId = r.body.id;

  r = await api('GET', `/api/households/${house.id}/plans`);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].algorithm, 'greedy');
  assert.ok(r.body[0].robustness.scenarios > 0);

  r = await api('GET', `/api/plans/${planId}`);
  assert.deepEqual(r.body.input.household.outages, [{ from: '20:00', to: '24:00' }]);

  // Видалення графіка не видаляє план, лише відв'язує його.
  assert.equal((await api('DELETE', `/api/schedules/${schedule.id}`)).status, 204);
  r = await api('GET', `/api/plans/${planId}`);
  assert.equal(r.body.scheduleId, null);

  assert.equal((await api('DELETE', `/api/plans/${planId}`)).status, 204);
  assert.equal((await api('GET', `/api/plans/${planId}`)).status, 404);
});

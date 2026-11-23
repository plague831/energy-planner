import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarState } from '../src/solar.js';

const panel = { kind: 'solar', name: 'Панелі', peakW: 800, sunHours: 3, sunrise: '07:00', sunset: '17:00', forecast: true, cloudPct: 40 };
const household = { sources: [panel], nextDay: { sources: [{ ...panel, sunHours: 2, sunrise: '07:02' }] } };

test('за день панелі дають peakW · сонячні години · 0,75, опівдні — пік, половина вже вироблена', () => {
  const noon = solarState(household, null, 48);
  assert.equal(noon.isDay, true);
  assert.equal(Math.round(noon.total), 1800);
  assert.equal(Math.round(noon.produced), 900);
  assert.ok(Math.abs(noon.nowW - 283) < 2, `опівдні ${noon.nowW} Вт`);
  assert.equal(noon.cloud, 40);
  assert.equal(noon.source, 'за прогнозом погоди');
});

test('вночі сонця немає: до сходу — скільки чекати, після заходу — скільки вироблено і що завтра', () => {
  const dawn = solarState(household, null, 20);
  assert.equal(dawn.isDay, false);
  assert.equal(dawn.beforeSunrise, true);
  assert.equal(dawn.nowW, 0);
  assert.equal(Math.round(dawn.produced), 0);
  const evening = solarState(household, null, 80);
  assert.equal(evening.beforeSunrise, false);
  assert.equal(Math.round(evening.produced), 1800);
  assert.equal(evening.tomorrowWh, 1200);
  assert.equal(evening.nextRise, 7 * 60 + 2);
});

test('куди йде сонце за планом: спершу в дім, решта на заряд станції', () => {
  const trace = Array.from({ length: 96 }, (_, t) => ({ slot: t, solarW: t === 48 ? 250 : 0, servedW: 100 }));
  const st = solarState(household, trace, 48);
  assert.equal(st.toHome, 100);
  assert.equal(st.toCharge, 150);
});

test('без панелей картки немає', () => {
  assert.equal(solarState({ sources: [{ kind: 'battery', capacityWh: 1000 }] }, null, 48), null);
});

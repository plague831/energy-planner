import './setup.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateBattery, newSource, migrateHousehold, withSources } from '../src/sources.js';
import { saveChoice } from '../src/yasno.js';

beforeEach(() => localStorage.clear());

test('кілька станцій зводяться в одну: ємності й потужності додаються, заряд середньозважений', () => {
  const b = aggregateBattery([
    { kind: 'battery', capacityWh: 768, initialSocPct: 80, minSocPct: 10, maxChargeW: 940, inverterMaxW: 800 },
    { kind: 'battery', capacityWh: 256, initialSocPct: 40, minSocPct: 20, maxChargeW: 300, inverterMaxW: 300 },
    { kind: 'solar', peakW: 800 },
  ]);
  assert.equal(b.capacityWh, 1024);
  assert.equal(b.inverterMaxW, 1100);
  assert.equal(b.maxChargeW, 1240);
  assert.equal(b.initialSocPct, 70);
  assert.equal(b.minSocPct, 13);
  assert.equal(aggregateBattery([{ kind: 'solar', peakW: 800 }]), null);
});

test('нова панель одразу бере прогноз погоди для міста з графіка відключень', () => {
  const kyiv = newSource('solar');
  assert.equal(kyiv.forecast, true);
  assert.equal(kyiv.place, 'Київ');
  saveChoice({ source: '3:301', group: '1.1', sourceLabel: 'Дніпро, ДнЕМ' });
  const dnipro = newSource('solar');
  assert.equal(dnipro.place, 'Дніпро');
  assert.ok(Number.isFinite(dnipro.lat) && Number.isFinite(dnipro.lon));
});

test('старі дані (одна станція, генератор і панелі окремими полями) переводяться у список джерел', () => {
  const legacy = {
    battery: { capacityWh: 1024, initialSocPct: 60, minSocPct: 10, maxChargeW: 600, inverterMaxW: 1800, model: 'EcoFlow River 2 Pro' },
    generator: { ratedW: 2500, tankHoursAtHalf: 8, fuelPct: 100 },
    solar: { peakW: 600, sunHours: 4 },
    baseLoads: [],
    appliances: [],
  };
  const h = migrateHousehold(legacy);
  assert.deepEqual(h.sources.map((s) => s.kind), ['battery', 'generator', 'solar']);
  assert.equal(h.sources[0].name, 'Станція EcoFlow River 2 Pro');
  assert.equal(h.battery.capacityWh, 1024);
  assert.equal(h.generator, undefined);
  assert.equal(h.solar, undefined);
  // Введені вручну сонячні години старих панелей не підміняються прогнозом.
  assert.equal(h.sources[2].forecast, false);
  assert.equal(h.sources[2].sunHours, 4);
  // Дані нового формату не змінюються.
  assert.equal(migrateHousehold(h), h);
});

test('після зміни списку джерел еквівалентна станція перераховується, а без станцій її немає', () => {
  const h = withSources({ battery: { capacityWh: 500 } }, [{ kind: 'solar', peakW: 400 }]);
  assert.equal(h.battery, null);
});

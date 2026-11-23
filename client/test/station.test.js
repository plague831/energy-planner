import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySegments, stationState } from '../src/station.js';

const household = (outages) => ({ outages, battery: { capacityWh: 1000, minSocPct: 10 } });
// Слід плану: заряд за слотами, світло за графіком, постійне навантаження loadW під час відключення.
function trace({ outageFrom, startWh, loadW, past = 0, pastWh = null }) {
  let energy = startWh;
  return Array.from({ length: 96 }, (_, t) => {
    const gridOn = t < outageFrom;
    if (!gridOn) energy -= (loadW * 0.25) / 0.92;
    const e = t < past && pastWh !== null ? pastWh - (t - outageFrom + 1) * 30 : energy;
    return { slot: t, gridOn, servedW: loadW, demandW: loadW, chargeW: 0, solarW: 0, generatorW: 0, energyWh: e, ...(t < past ? { past: true } : {}) };
  });
}

test('відрізки доби: світло є до відключення, відключення через північ ділиться на два краї доби', () => {
  assert.deepEqual(daySegments([{ from: '20:30', to: '24:00' }]), [
    { from: 0, to: 82, off: false },
    { from: 82, to: 96, off: true },
  ]);
  assert.deepEqual(daySegments([{ from: '22:00', to: '02:00' }]).map((s) => [s.from, s.to, s.off]), [
    [0, 8, true],
    [8, 88, false],
    [88, 96, true],
  ]);
  assert.deepEqual(daySegments([]), [{ from: 0, to: 96, off: false }]);
});

test('під час відключення: скільки віддано від його початку, зміна заряду і на скільки ще вистачить', () => {
  const tr = trace({ outageFrom: 58, startWh: 1000, loadW: 120 }); // 14:30
  const st = stationState(household([{ from: '14:30', to: '21:00' }]), tr, 80); // 20:00
  assert.equal(st.off, true);
  assert.equal(st.sinceSlot, null);
  assert.equal(st.elapsedH, 5.5);
  assert.equal(Math.round(st.given), 23 * 30); // 23 слоти по 120 Вт · 0,25 год
  assert.equal(st.outW, 120);
  assert.equal(Math.round(st.socStart), 100);
  assert.ok(st.delta < -60, `заряд мав упасти помітно, а впав на ${st.delta}%`);
  assert.ok(st.leftH > 0 && st.leftH < 3);
  assert.equal(st.mode, 'out');
});

test('план перебудовано з нового заряду: підсумки рахуються з моменту перебудови, без стрибка', () => {
  // Минулі слоти — зі старого розрахунку (заряд уже низький), нові — від «Заряд зараз» 100%.
  const tr = trace({ outageFrom: 58, startWh: 1000, loadW: 120, past: 80, pastWh: 1000 });
  for (let t = 80; t < 96; t++) tr[t].energyWh = 1000 - ((t - 79) * 30) / 0.92;
  const st = stationState(household([{ from: '14:30', to: '21:00' }]), tr, 80);
  assert.equal(st.sinceSlot, 80);
  assert.equal(Math.round(st.given), 30);
  assert.equal(Math.round(st.socStart), 100);
  assert.ok(st.delta >= -4 && st.delta <= 0, `зміна заряду ${st.delta}%`);
  assert.equal(st.elapsedH, 5.5, 'тривалість відключення — за графіком, а не з перебудови');
});

test('без станції або без плану картки станції немає', () => {
  assert.equal(stationState({ outages: [], battery: null }, trace({ outageFrom: 96, startWh: 0, loadW: 0 }), 40), null);
  assert.equal(stationState(household([]), null, 40), null);
});

import './setup.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '@energy-planner/core';
import { demoHousehold } from '@energy-planner/core/examples';
import { planDay, sliceDay, describeChanges } from '../src/planning.js';
import { withSources } from '../src/sources.js';

// Дім у форматі сайту: джерела списком і план на 48 год (завтра — той самий графік).
const station = { id: 'b1', kind: 'battery', name: 'Станція', ...demoHousehold.battery };
const home = (overrides = {}) => {
  const h = withSources({ ...demoHousehold, ...overrides }, overrides.sources ?? [station]);
  return { ...h, nextDay: { outages: h.outages, sources: h.sources } };
};
// Розрахунок, як у фоновому потоці браузера; calls — з якими параметрами його викликали.
let calls;
const build = async (household, algorithm, replan) => {
  calls.push({ replan });
  return JSON.parse(JSON.stringify(plan(household, { algorithm, replan, dropFailing: true })));
};
const at = (h, m = 0) => mock.timers.setTime(new Date(2026, 10, 12, h, m).getTime());

beforeEach(() => {
  localStorage.clear();
  calls = [];
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 12, 10, 0) });
});
afterEach(() => mock.timers.reset());

test('перший план дня будується з «зараз», а минулі години доби добудовуються', async () => {
  const { result } = await planDay(home(), 'greedy', { build });
  assert.equal(result.nominal.trace.length, 96);
  assert.equal(result.nominal.trace[39].past, true);
  assert.ok(!result.nominal.trace[40].past);
  assert.equal(calls.length, 2, 'план з «зараз» і план на всю добу для минулих годин');
  assert.equal(calls[0].replan.nowSlot, 40);
  assert.equal(calls[0].replan.socPct, 70, 'без попереднього плану — введений «Заряд зараз»');
  for (const s of result.schedule) if (!s.skipped) assert.ok(s.startSlot >= 40, `${s.name} у минулому`);
});

test('наступне перепланування продовжує заряд і не зсуває вже ввімкнені прилади', async () => {
  const first = (await planDay(home(), 'greedy', { build })).result;
  at(12, 0);
  calls = [];
  const second = (await planDay(home(), 'greedy', { build })).result;
  assert.equal(calls.length, 1, 'минулі години беруться з попереднього плану');
  // Заряд на початок слота 12:00 — це кінець слота 11:45 попереднього плану.
  const expected = (first.nominal.trace[47].energyWh / demoHousehold.battery.capacityWh) * 100;
  assert.ok(Math.abs(calls[0].replan.socPct - expected) < 1e-9, 'заряд — з попереднього плану на цю мить');
  for (const s of first.schedule) {
    if (s.skipped || s.startSlot >= 48) continue;
    assert.equal(second.schedule.find((x) => x.id === s.id)?.startSlot, s.startSlot, `${s.name} зсунуто`);
  }
});

test('повторні оновлення сторінки в межах тих самих 15 хвилин не «з’їдають» заряд', async () => {
  at(19, 0); // відключення 18:00–22:00, станція віддає
  await planDay(home(), 'greedy', { build });
  const startSoc = calls[0].replan.socPct;
  const socs = [];
  for (const minute of [2, 5, 9, 14]) {
    at(19, minute);
    calls = [];
    await planDay(home(), 'greedy', { build });
    socs.push(calls[0].replan.socPct);
  }
  for (const soc of socs) assert.ok(Math.abs(soc - startSoc) < 1e-9, `заряд сповзає: ${[startSoc, ...socs].map((x) => x.toFixed(2)).join(' → ')}`);
  // А в наступному слоті заряд продовжується з кінця поточного.
  at(19, 16);
  calls = [];
  await planDay(home(), 'greedy', { build });
  assert.ok(calls[0].replan.socPct < startSoc, 'під час відключення заряд має зменшуватися');
});

test('людина змінила «Заряд зараз» — план будується від нового значення', async () => {
  await planDay(home(), 'greedy', { build });
  at(12, 15);
  calls = [];
  await planDay(home({ sources: [{ ...station, initialSocPct: 30 }] }), 'greedy', { build });
  assert.equal(calls[0].replan.socPct, 30);
});

test('змінився склад дому — минулі години перераховуються заново', async () => {
  await planDay(home(), 'greedy', { build });
  at(12, 0);
  calls = [];
  await planDay(home({ sources: [{ ...station, capacityWh: 2048 }] }), 'greedy', { build });
  assert.equal(calls.length, 2);
});

test('змінився графік — повертається, що саме перенесено', async () => {
  await planDay(home(), 'greedy', { build });
  at(10, 30);
  const outages = [{ from: '11:00', to: '15:00' }, { from: '18:00', to: '22:00' }];
  const { changed } = await planDay(home({ outages }), 'greedy', { build, scheduleOutages: outages });
  assert.ok(changed, 'зміна графіка має бути помічена');
  assert.equal(changed.at, '10:30');
  assert.ok(Array.isArray(changed.moved));
});

test('план на завтра — окрема доба з власною нумерацією слотів', async () => {
  const { result } = await planDay(home(), 'greedy', { build, day: 'tomorrow' });
  assert.equal(result.nominal.trace.length, 96);
  assert.equal(result.nominal.trace[0].slot, 0);
  for (const s of result.schedule) assert.doesNotMatch(String(s.id), /@\d+$/);
});

test('зріз доби з 48-годинного плану і опис перенесених приладів', () => {
  const full = {
    schedule: [
      { id: 'washer', name: 'Пральна', day: 0, startSlot: 50, endSlot: 56, start: '12:30' },
      { id: 'washer@1', name: 'Пральна', day: 1, startSlot: 96 + 50, endSlot: 96 + 56, start: '12:30' },
    ],
    nominal: { trace: Array.from({ length: 192 }, (_, t) => ({ slot: t })), failedIds: ['washer@1'], missedIds: [] },
  };
  const tomorrow = sliceDay(full, 1);
  assert.deepEqual(tomorrow.schedule.map((s) => [s.id, s.startSlot]), [['washer', 50]]);
  assert.deepEqual(tomorrow.nominal.failedIds, ['washer']);
  assert.equal(sliceDay({ nominal: { trace: Array(96).fill({}) } }, 1), null);

  const moved = describeChanges([{ id: 'w', name: 'Пральна', start: '12:30', startSlot: 50 }], [{ id: 'w', name: 'Пральна', start: '14:00', startSlot: 56 }], 48);
  assert.deepEqual(moved, { at: '12:00', moved: ['Пральна: тепер о 14:00 (було 12:30)'] });
});

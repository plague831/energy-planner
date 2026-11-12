import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '@energy-planner/core';
import { demoHousehold } from '@energy-planner/core/examples';
import { trafficLight } from '../src/trafficLight.js';

const slotOf = (t) => Number(t.slice(0, 2)) * 4 + Number(t.slice(3)) / 15;
const byName = (items) => Object.fromEntries(items.map((it) => [it.name, it]));

test('світло є і станція є: пральна машина, яка встигне до відключення, — «можна зараз»', () => {
  const result = plan(demoHousehold, { algorithm: 'greedy' });
  const items = byName(trafficLight(demoHousehold, result, slotOf('13:00')));
  assert.equal(items['Пральна машина'].status, 'go');
  assert.match(items['Пральна машина'].detail, /Світла вистачить до кінця/);
  // Бойлер (2 кВт, не від станції) теж встигне: світло до 18:00.
  assert.equal(items['Бойлер'].status, 'go');
});

test('прилад, який не можна від станції, не радиться перед самим відключенням', () => {
  const result = plan(demoHousehold, { algorithm: 'greedy' });
  // Духовка 45 хв о 17:30 закінчиться вже під час відключення о 18:00.
  const oven = byName(trafficLight(demoHousehold, result, slotOf('17:30')))['Духовка (вечеря)'];
  assert.notEqual(oven.status, 'go');
});

test('без резервного живлення під час відключення нічого не радиться на час, коли світла немає', () => {
  const household = { ...demoHousehold, battery: null, sources: [] };
  const result = plan(household, { algorithm: 'greedy' });
  const items = trafficLight(household, result, slotOf('19:00'));
  assert.equal(byName(items)['Пральна машина'].status, 'stop');
  for (const it of items) {
    assert.notEqual(it.status, 'go', `${it.name}: «можна зараз» без світла`);
    const time = it.title.match(/о (\d\d:\d\d)/)?.[1];
    if (time) {
      const s = slotOf(time);
      assert.ok(s < slotOf('18:00') || s >= slotOf('22:00'), `${it.name}: радить ${time}, коли світла немає`);
    }
  }
});

test('без плану підказок немає', () => {
  assert.deepEqual(trafficLight(demoHousehold, null, 40), []);
});

test('під час відключення підказка не каже, що воно «почнеться»', () => {
  const household = { ...demoHousehold, battery: { ...demoHousehold.battery, capacityWh: 300 } };
  const result = plan(household, { algorithm: 'greedy' });
  for (const it of trafficLight(household, result, slotOf('19:00'))) {
    assert.doesNotMatch(it.detail, /почнеться відключення/, `${it.name}: ${it.detail}`);
  }
  // Минуле вікно приладу так і називається.
  const kettle = byName(trafficLight(household, result, slotOf('19:00')))['Чайник (сніданок)'];
  if (kettle.status === 'stop') assert.match(kettle.detail, /вже минув/);
});

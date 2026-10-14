import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeToSlot, slotToTime, fillInterval, SLOTS_PER_DAY } from '../src/index.js';

test('час перетворюється в слот і назад', () => {
  assert.equal(timeToSlot('00:00'), 0);
  assert.equal(timeToSlot('08:30'), 34);
  assert.equal(timeToSlot('24:00'), SLOTS_PER_DAY);
  assert.equal(slotToTime(34), '08:30');
});

test('некоректний час відхиляється', () => {
  assert.throws(() => timeToSlot('25:00'));
  assert.throws(() => timeToSlot('8.30'));
  assert.throws(() => timeToSlot('24:15'));
});

test('інтервал через північ заповнює кінець і початок доби', () => {
  const mask = fillInterval(new Uint8Array(SLOTS_PER_DAY), timeToSlot('23:00'), timeToSlot('01:00'));
  assert.equal(mask[timeToSlot('23:30')], 1);
  assert.equal(mask[timeToSlot('00:30')], 1);
  assert.equal(mask[timeToSlot('12:00')], 0);
});

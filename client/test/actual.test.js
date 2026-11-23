import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyActual, currentActual, deviation } from '../src/actual.js';
import { localDate } from '../src/exportPlan.js';

const today = localDate(0);
const at = (time, type) => ({ date: today, time, type, minute: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) });

test('розбіжність з графіком: на скільки хвилин раніше чи пізніше, або null поза графіком', () => {
  const outages = [{ from: '18:00', to: '22:00' }];
  assert.equal(deviation('off', 18 * 60 + 20, outages), 20);
  assert.equal(deviation('on', 21 * 60 + 30, outages), -30);
  assert.equal(deviation('off', 9 * 60, outages), null);
  // Межа через північ: відключення до 00:30 і світло о 00:10.
  assert.equal(deviation('on', 10, [{ from: '20:00', to: '00:30' }]), -20);
});

test('світло зникло поза графіком: вважаємо, що його не буде щонайменше 2 години', () => {
  const { outages, note } = applyActual([{ from: '18:00', to: '22:00' }], at('10:00', 'off'));
  assert.deepEqual(outages, [{ from: '18:00', to: '22:00' }, { from: '10:00', to: '12:00' }]);
  assert.match(note, /поза графіком/);
});

test('світло зникло раніше за графік: відключення триває до запланованого кінця', () => {
  const { outages, note } = applyActual([{ from: '18:00', to: '22:00' }], at('17:00', 'off'));
  assert.deepEqual(outages, [{ from: '17:00', to: '22:00' }]);
  assert.match(note, /раніше за графік/);
});

test('світло повернулось раніше: відключення обрізається на цьому моменті', () => {
  const { outages } = applyActual([{ from: '18:00', to: '22:00' }], at('20:15', 'on'));
  assert.deepEqual(outages, [{ from: '18:00', to: '20:15' }]);
});

test('події іншого дня і збіг з графіком нічого не змінюють', () => {
  const schedule = [{ from: '18:00', to: '22:00' }];
  assert.equal(applyActual(schedule, { ...at('10:00', 'off'), date: '2000-01-01' }).outages, schedule);
  assert.equal(applyActual(schedule, at('19:00', 'off')).outages, schedule);
  assert.equal(applyActual(schedule, at('10:00', 'on')).outages, schedule);
});

test('поточний фактичний стан — остання подія сьогодні', () => {
  const events = [{ ...at('08:00', 'off'), date: '2000-01-01' }, at('09:00', 'off'), at('10:30', 'on')];
  assert.equal(currentActual(events).time, '10:30');
  assert.equal(currentActual([events[0]]), null);
});

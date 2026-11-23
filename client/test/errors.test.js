import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeError } from '../src/errors.js';

const household = { appliances: [{ name: 'Пральна машина' }], baseLoads: [{ name: 'Холодильник' }] };

test('помилки в даних перекладаються на людську мову з назвою приладу', () => {
  assert.equal(humanizeError('Поле appliances[0].durationMin має бути додатним числом', household), '«Пральна машина»: час роботи має бути більше нуля');
  assert.equal(humanizeError('Поле baseLoads[0].powerW має бути додатним числом', household), '«Холодильник»: потужність має бути більше нуля');
  assert.equal(humanizeError('Поле battery.minSocPct має бути від 0 до 100', household), 'Станція: мінімальний заряд має бути від 0 до 100%');
  // Інші повідомлення лишаються як є.
  assert.equal(humanizeError('Прилад «Бойлер» не вміщується у своє вікно', household), 'Прилад «Бойлер» не вміщується у своє вікно');
});

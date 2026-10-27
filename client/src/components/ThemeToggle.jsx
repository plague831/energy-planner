import { useEffect, useState } from 'react';

// Перемикач теми: як у системі → світла → темна. Вибір зберігається в localStorage,
// а index.html застосовує його ще до першого малювання, щоб сторінка не блимала.
const MODES = [
  ['system', '🖥️', 'Тема як у системі'],
  ['light', '☀️', 'Світла тема'],
  ['dark', '🌙', 'Темна тема'],
];
const KEY = 'theme';

function readMode() {
  try {
    const saved = localStorage.getItem(KEY);
    return MODES.some(([m]) => m === saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export default function ThemeToggle() {
  const [mode, setMode] = useState(readMode);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    try {
      if (mode === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch {
      // приватний режим: тема просто не запам'ятається
    }
  }, [mode]);

  const index = MODES.findIndex(([m]) => m === mode);
  const [, icon, label] = MODES[index];
  const [, , nextLabel] = MODES[(index + 1) % MODES.length];
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setMode(MODES[(index + 1) % MODES.length][0])}
      title={`${label}. Натисніть: ${nextLabel.toLowerCase()}`}
      aria-label={`${label}. Змінити тему`}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

import { useEffect, useState } from 'react';

// Вибір теми: як у системі, світла або темна. Вибір зберігається в localStorage,
// а index.html застосовує його ще до першого малювання, щоб сторінка не блимала.
const MODES = [
  ['system', '🖥️', 'Системна'],
  ['light', '☀️', 'Світла'],
  ['dark', '🌙', 'Темна'],
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

  return (
    <label className="theme-select">
      <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Тема оформлення">
        {MODES.map(([m, icon, label]) => (
          <option key={m} value={m}>
            {icon} {label}
          </option>
        ))}
      </select>
    </label>
  );
}

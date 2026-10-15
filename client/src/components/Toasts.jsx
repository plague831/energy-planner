import { createContext, useCallback, useContext, useRef, useState } from 'react';

// Короткі сповіщення про результат дій (план складено, графік завантажено, помилка).
const ToastContext = createContext(() => {});

const DURATION_MS = { success: 4000, info: 5000, error: 7000 };
const ICONS = { success: '✓', info: 'i', error: '!' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const notify = useCallback(
    (type, text) => {
      const id = nextId.current++;
      // Не більше трьох одночасно, щоб сповіщення не закривали форму.
      setToasts((list) => [...list.slice(-2), { id, type, text }]);
      setTimeout(() => dismiss(id), DURATION_MS[type] ?? 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon" aria-hidden="true">
              {ICONS[t.type]}
            </span>
            <span className="toast-text">{t.text}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Закрити">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// notify('success' | 'info' | 'error', текст)
export const useToast = () => useContext(ToastContext);

import { useEffect } from 'react';
import TrafficLight from './TrafficLight.jsx';
import ActionList from './ActionList.jsx';

// Вікно з оновленим планом, яке з'являється одразу після збереження змін,
// щоб не треба було перемикатися на «Сьогодні», аби побачити результат.
export default function PlanSheet({ household, result, isToday, onClose, onOpenToday }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const now = new Date();
  const nowSlot = (now.getHours() * 60 + now.getMinutes()) / 15;
  return (
    <div className="sheet-backdrop no-print" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Оновлений план" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>✅ Зміни застосовано — ваш план</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрити">
            ×
          </button>
        </div>
        {isToday && (
          <>
            <h3>Що можна вмикати зараз</h3>
            <TrafficLight household={household} result={result} now={nowSlot} />
          </>
        )}
        <h3>План на {isToday ? 'сьогодні' : 'завтра'}</h3>
        <ActionList result={result} household={household} isToday={isToday} />
        <div className="sheet-actions">
          <button type="button" onClick={onOpenToday}>
            Відкрити «Сьогодні»
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}

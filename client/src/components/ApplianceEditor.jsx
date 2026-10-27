import { useState } from 'react';
import { iconFor } from '../icons.js';
import { useToast } from './Toasts.jsx';

// Прилади, які можна ввімкнути в зручний час. На виду лише головне: назва, потужність, скільки працює
// і коли зручно. Вікно «не раніше / закінчити до», важливість і живлення від станції — під «⚙️ Ще».
export const IMPORTANCE = [
  [5, 'дуже важливо'],
  [4, 'важливо'],
  [3, 'звичайно'],
  [2, 'можна відкласти'],
  [1, 'неважливо'],
];

export default function ApplianceEditor({ rows, onChange, newRow, presets }) {
  const [open, setOpen] = useState(() => new Set());
  const notify = useToast();
  const update = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, k) => k !== i));
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="appliance-editor">
      {rows.length === 0 && <p className="list-empty">Поки нічого не додано.</p>}
      {rows.length > 0 && (
        <div className="ae-head" aria-hidden="true">
          <span>Прилад</span>
          <span>Потужність, Вт</span>
          <span>Працює, хв</span>
          <span>Зручно о</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => {
        const key = r.id ?? i;
        const expanded = open.has(key);
        return (
          <div key={key} className={`ae-row ${expanded ? 'expanded' : ''}`}>
            <div className="ae-main">
              <label className="ae-name">
                <span aria-hidden="true">{iconFor(r.name)}</span>
                <input type="text" value={r.name ?? ''} onChange={(e) => update(i, { name: e.target.value })} aria-label="Назва" placeholder="Назва" />
              </label>
              <label className="ae-field">
                <span className="ae-mobile-label">Потужність, Вт</span>
                <input type="number" min={0} value={r.powerW ?? ''} onChange={(e) => update(i, { powerW: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Потужність, Вт" />
              </label>
              <label className="ae-field">
                <span className="ae-mobile-label">Працює, хв</span>
                <input type="number" min={15} step={15} value={r.durationMin ?? ''} onChange={(e) => update(i, { durationMin: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Тривалість, хв" />
              </label>
              <label className="ae-field">
                <span className="ae-mobile-label">Зручно о</span>
                <input type="time" step={900} value={r.preferredStart ?? ''} onChange={(e) => update(i, { preferredStart: e.target.value || undefined })} aria-label="Зручний час" />
              </label>
              <div className="ae-actions">
                <button type="button" className="icon-button" onClick={() => toggle(key)} aria-expanded={expanded} title="Додаткові налаштування">
                  ⚙️ {expanded ? 'Менше' : 'Ще'}
                </button>
                <button type="button" className="icon-button" onClick={() => remove(i)} aria-label={`Прибрати ${r.name}`}>
                  ×
                </button>
              </div>
            </div>
            {expanded && (
              <div className="ae-more">
                <label className="field">
                  <span>Можна вмикати не раніше</span>
                  <input type="time" step={900} value={r.earliest ?? ''} onChange={(e) => update(i, { earliest: e.target.value || undefined })} />
                </label>
                <label className="field">
                  <span>Має закінчити до</span>
                  <input type="time" step={900} value={r.latest ?? ''} onChange={(e) => update(i, { latest: e.target.value || undefined })} />
                </label>
                <label className="field">
                  <span>Наскільки важливо</span>
                  <select value={r.priority ?? 3} onChange={(e) => update(i, { priority: Number(e.target.value) })}>
                    {IMPORTANCE.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox ae-battery">
                  <input type="checkbox" checked={r.allowOnBattery !== false} onChange={(e) => update(i, { allowOnBattery: e.target.checked })} />
                  Можна вмикати від станції під час відключення
                </label>
              </div>
            )}
          </div>
        );
      })}
      <div className="list-actions">
        <button type="button" className="link-button" onClick={() => onChange([...rows, newRow(rows.length)])}>
          + Додати свій прилад
        </button>
        <select
          className="preset-select"
          value=""
          onChange={(e) => {
            const preset = presets[Number(e.target.value)];
            if (!preset) return;
            onChange([...rows, { ...newRow(rows.length), ...preset }]);
            notify('success', `Додано з довідника: ${preset.name}`);
          }}
        >
          <option value="">Додати з довідника…</option>
          {presets.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}, {p.powerW} Вт
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

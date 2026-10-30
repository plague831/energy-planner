import { useState } from 'react';
import { iconFor } from '../icons.js';
import { IMPORTANCE } from './ApplianceEditor.jsx';
import { useToast } from './Toasts.jsx';

// Прилади, які працюють постійно (холодильник, роутер) або в певні години (світло ввечері).
// На виду: назва, потужність і коли працює одним словом; години та важливість — під «⚙️ Ще».
export default function BaseLoadEditor({ rows, onChange, newRow, presets }) {
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
    <div className="appliance-editor base-editor">
      {rows.length === 0 && <p className="list-empty">Поки нічого не додано.</p>}
      {rows.length > 0 && (
        <div className="ae-head" aria-hidden="true">
          <span>Прилад</span>
          <span>Потужність, Вт</span>
          <span>Коли працює</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => {
        const key = r.id ?? i;
        const expanded = open.has(key);
        const allDay = !r.from && !r.to;
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
              <div className="ae-field ae-when">
                <span className="ae-mobile-label">Коли працює</span>
                <span>{allDay ? 'цілодобово' : `${r.from ?? '00:00'}–${r.to ?? '24:00'}`}</span>
              </div>
              <div className="ae-actions">
                <button type="button" className="icon-button" onClick={() => toggle(key)} aria-expanded={expanded} title="Години й важливість">
                  ⚙️ {expanded ? 'Менше' : 'Ще'}
                </button>
                <button type="button" className="icon-button" onClick={() => remove(i)} aria-label={`Прибрати ${r.name}`}>
                  ×
                </button>
              </div>
            </div>
            {expanded && (
              <div className="ae-more">
                <label className="checkbox ae-battery">
                  <input type="checkbox" checked={allDay} onChange={(e) => update(i, e.target.checked ? { from: undefined, to: undefined } : { from: '09:00', to: '18:00' })} />
                  Працює цілодобово
                </label>
                {!allDay && (
                  <>
                    <label className="field">
                      <span>Працює з</span>
                      <input type="time" step={900} value={r.from ?? ''} onChange={(e) => update(i, { from: e.target.value || undefined })} />
                    </label>
                    <label className="field">
                      <span>до</span>
                      <input type="time" step={900} value={r.to ?? ''} onChange={(e) => update(i, { to: e.target.value || undefined })} />
                    </label>
                  </>
                )}
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

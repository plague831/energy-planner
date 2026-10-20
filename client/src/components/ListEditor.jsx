import { useToast } from './Toasts.jsx';

// Таблиця для редагування списку однотипних записів (відключення, навантаження, прилади).
// presets (необов'язково): типові записи, які можна додати одним вибором зі списку.
export default function ListEditor({ columns, rows, onChange, newRow, addLabel, presets, emptyText = 'Список порожній.' }) {
  const update = (index, key, value) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };
  const notify = useToast();
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="list-editor">
      {rows.length === 0 && <p className="list-empty">{emptyText}</p>}
      <table hidden={rows.length === 0}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            <th aria-label="Дії" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label}>
                  <Field column={c} value={row[c.key]} onChange={(v) => update(i, c.key, v)} />
                </td>
              ))}
              <td>
                <button type="button" className="icon-button" onClick={() => remove(i)} title="Видалити">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="list-actions">
        <button type="button" className="link-button" onClick={() => onChange([...rows, newRow(rows.length)])}>
          + {addLabel}
        </button>
        {presets && (
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
        )}
      </div>
    </div>
  );
}

function Field({ column, value, onChange }) {
  switch (column.type) {
    case 'number':
      return (
        <input
          type="number"
          min={column.min ?? 0}
          step={column.step ?? 1}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'time':
      return <input type="time" step={900} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />;
    case 'checkbox':
      return <input type="checkbox" checked={value !== false} onChange={(e) => onChange(e.target.checked)} />;
    case 'priority':
      return (
        <select value={value ?? 3} onChange={(e) => onChange(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      );
    default:
      return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

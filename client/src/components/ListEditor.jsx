// Таблиця для редагування списку однотипних записів (відключення, навантаження, прилади).
export default function ListEditor({ columns, rows, onChange, newRow, addLabel }) {
  const update = (index, key, value) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="list-editor">
      <table>
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
      <button type="button" className="link-button" onClick={() => onChange([...rows, newRow(rows.length)])}>
        + {addLabel}
      </button>
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

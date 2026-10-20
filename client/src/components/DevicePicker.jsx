import { iconFor } from '../icons.js';
import { appliancePresets, baseLoadPresets } from '../presets.js';

// Прилади кнопками: додані показуються «плитками» з хрестиком, нижче — кнопки з довідника, яких ще немає.
// Точні налаштування (час, пріоритет) лишаються в розгорнутих таблицях «Мого дому».
export default function DevicePicker({ household, onChange }) {
  const set = (key, value) => onChange({ ...household, [key]: value });
  const baseLoads = household.baseLoads ?? [];
  const appliances = household.appliances ?? [];
  const has = (list, name) => list.some((d) => d.name === name);

  const addBase = (p) => set('baseLoads', [...baseLoads, { id: `base-${Date.now()}`, ...p }]);
  const addAppliance = (p) => set('appliances', [...appliances, { id: `appliance-${Date.now()}`, ...p }]);

  return (
    <div className="device-picker">
      <h3>Працює постійно або у певні години</h3>
      <p className="hint">Те, що не можна перенести: холодильник, роутер, світло.</p>
      <Tiles items={baseLoads} onRemove={(i) => set('baseLoads', baseLoads.filter((_, k) => k !== i))} />
      <Choices presets={baseLoadPresets.filter((p) => !has(baseLoads, p.name))} onAdd={addBase} />

      <h3>Можна ввімкнути в зручний час</h3>
      <p className="hint">Сайт сам підбере для них час, коли буде світло.</p>
      <Tiles items={appliances} onRemove={(i) => set('appliances', appliances.filter((_, k) => k !== i))} />
      <Choices presets={appliancePresets.filter((p) => !has(appliances, p.name))} onAdd={addAppliance} />
    </div>
  );
}

function Tiles({ items, onRemove }) {
  if (!items.length) return <p className="list-empty">Поки нічого не додано.</p>;
  return (
    <ul className="device-tiles">
      {items.map((d, i) => (
        <li key={d.id ?? i} className="device-tile">
          <span className="device-icon" aria-hidden="true">
            {iconFor(d.name)}
          </span>
          <span className="device-name">{d.name || 'Без назви'}</span>
          <span className="device-power">{Number(d.powerW || 0).toLocaleString('uk-UA')} Вт</span>
          <button type="button" className="icon-button" onClick={() => onRemove(i)} aria-label={`Прибрати ${d.name}`}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function Choices({ presets, onAdd }) {
  if (!presets.length) return null;
  return (
    <div className="device-choices">
      {presets.map((p) => (
        <button key={p.name} type="button" className="chip" onClick={() => onAdd(p)}>
          + <span aria-hidden="true">{iconFor(p.name)}</span> {p.name}
        </button>
      ))}
    </div>
  );
}

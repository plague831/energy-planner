import { SOURCE_KINDS, newSource } from '../sources.js';
import { stationPresets } from '../presets.js';
import { useToast } from './Toasts.jsx';

// Список джерел живлення в «Мій дім»: кожне — картка з основними полями, технічні параметри станції розгортаються.
export default function SourcesEditor({ sources, onChange }) {
  const notify = useToast();
  const update = (id, patch) => onChange(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id) => onChange(sources.filter((s) => s.id !== id));
  const count = (kind) => sources.filter((s) => s.kind === kind).length;
  const add = (kind) => {
    const n = count(kind) + 1;
    onChange([...sources, newSource(kind, n > 1 ? { name: `${SOURCE_KINDS[kind].label} ${n}` } : {})]);
  };

  return (
    <div className="sources-editor">
      {sources.length === 0 && <p className="list-empty">Резервного живлення немає. Додайте станцію, генератор чи панелі, якщо вони є.</p>}
      {sources.map((s) => (
        <div key={s.id} className={`source-card ${s.kind}`}>
          <div className="source-card-head">
            <span className="source-card-icon" aria-hidden="true">
              {SOURCE_KINDS[s.kind].icon}
            </span>
            <input className="source-card-name" type="text" value={s.name} aria-label="Назва джерела" onChange={(e) => update(s.id, { name: e.target.value })} />
            <button type="button" className="icon-button" onClick={() => remove(s.id)} aria-label={`Прибрати ${s.name}`}>
              ×
            </button>
          </div>

          {s.kind === 'battery' && (
            <>
              <div className="grid-fields">
                <label className="field">
                  <span>Модель</span>
                  <select
                    value={stationPresets.findIndex((p) => p.name === s.model)}
                    onChange={(e) => {
                      const preset = stationPresets[Number(e.target.value)];
                      if (!preset) return update(s.id, { model: undefined });
                      const { name, ...specs } = preset;
                      update(s.id, { ...specs, model: name, name: `Станція ${name}` });
                      notify('success', `Підставлено параметри станції ${name}`);
                    }}
                  >
                    <option value={-1}>Інша (вказати параметри вручну)</option>
                    {stationPresets.map((p, i) => (
                      <option key={p.name} value={i}>
                        {p.name} ({p.capacityWh} Вт·год)
                      </option>
                    ))}
                  </select>
                </label>
                <Num label="Заряд зараз, %" value={s.initialSocPct} onChange={(v) => update(s.id, { initialSocPct: v })} />
              </div>
              <details className="more">
                <summary>Додаткові параметри станції</summary>
                <div className="grid-fields">
                  <Num label="Ємність, Вт·год" value={s.capacityWh} onChange={(v) => update(s.id, { capacityWh: v, model: undefined })} />
                  <Num label="Не розряджати нижче, %" value={s.minSocPct} onChange={(v) => update(s.id, { minSocPct: v })} />
                  <Num label="Бажаний заряд на кінець доби, %" value={s.targetEndSocPct} onChange={(v) => update(s.id, { targetEndSocPct: v })} />
                  <Num label="Потужність заряджання, Вт" value={s.maxChargeW} onChange={(v) => update(s.id, { maxChargeW: v, model: undefined })} />
                  <Num label="Макс. потужність інвертора, Вт" value={s.inverterMaxW} onChange={(v) => update(s.id, { inverterMaxW: v, model: undefined })} />
                </div>
              </details>
            </>
          )}

          {s.kind === 'generator' && (
            <>
              <div className="grid-fields">
                <Num label="Потужність, Вт" value={s.ratedW} onChange={(v) => update(s.id, { ratedW: v })} />
                <Num label="Повного бака на, год" value={s.tankHoursAtHalf} onChange={(v) => update(s.id, { tankHoursAtHalf: v })} />
                <Num label="Пального зараз, %" value={s.fuelPct} onChange={(v) => update(s.id, { fuelPct: v })} />
              </div>
              <p className="hint field-note">У паспорті генератора час роботи на повному баку зазвичай вказують для навантаження 50%.</p>
            </>
          )}

          {s.kind === 'solar' && (
            <div className="grid-fields">
              <Num label="Потужність панелей, Вт" value={s.peakW} onChange={(v) => update(s.id, { peakW: v })} />
              <Num label="Сонячних годин за день" value={s.sunHours} step={0.5} onChange={(v) => update(s.id, { sunHours: v })} />
            </div>
          )}
        </div>
      ))}

      <div className="device-choices">
        {Object.entries(SOURCE_KINDS).map(([kind, k]) => (
          <button key={kind} type="button" className="chip" onClick={() => add(kind)}>
            + <span aria-hidden="true">{k.icon}</span> {k.add}
          </button>
        ))}
      </div>
      {count('battery') > 1 && <p className="hint">План заряджання враховує всі станції разом, як одну з сумарною ємністю.</p>}
      {sources.some((s) => s.kind !== 'battery') && (
        <p className="hint">Генератор і панелі зараз враховуються в розділі «Резервне живлення»; у плані на день — лише зарядні станції.</p>
      )}
    </div>
  );
}

function Num({ label, value, onChange, step = 1 }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    </label>
  );
}

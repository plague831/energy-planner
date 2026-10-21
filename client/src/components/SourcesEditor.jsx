import { useEffect, useState } from 'react';
import { SOURCE_KINDS, newSource } from '../sources.js';
import { stationPresets } from '../presets.js';
import { CITIES, solarForecast } from '../weather.js';
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
            <>
              <div className="grid-fields">
                <Num label="Потужність панелей, Вт" value={s.peakW} onChange={(v) => update(s.id, { peakW: v })} />
                {!s.forecast && <Num label="Сонячних годин за день" value={s.sunHours} step={0.5} onChange={(v) => update(s.id, { sunHours: v })} />}
                {s.forecast && (
                  <label className="field">
                    <span>Місто для прогнозу</span>
                    <select
                      value={CITIES.findIndex((c) => c.name === s.place)}
                      onChange={(e) => {
                        const c = CITIES[Number(e.target.value)];
                        if (c) update(s.id, { place: c.name, lat: c.lat, lon: c.lon });
                      }}
                    >
                      {CITIES.findIndex((c) => c.name === s.place) === -1 && <option value={-1}>{s.place ?? 'Оберіть місто'}</option>}
                      {CITIES.map((c, i) => (
                        <option key={c.name} value={i}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(s.forecast)}
                  onChange={(e) => update(s.id, e.target.checked ? { forecast: true, ...(s.lat ? {} : { place: CITIES[0].name, lat: CITIES[0].lat, lon: CITIES[0].lon }) } : { forecast: false })}
                />
                Брати сонячні години з прогнозу погоди (Open-Meteo)
              </label>
              {s.forecast && (
                <div className="forecast-row">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      navigator.geolocation?.getCurrentPosition(
                        (p) => update(s.id, { place: 'Моє місцезнаходження', lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
                        () => notify('error', 'Не вдалося визначити місцезнаходження'),
                      )
                    }
                  >
                    📍 Визначити моє місцезнаходження
                  </button>
                  <ForecastPreview lat={s.lat} lon={s.lon} />
                </div>
              )}
            </>
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
      {sources.some((s) => s.kind === 'generator') && (
        <p className="hint">План сам підбере, з якого заряду станції варто вмикати генератор, щоб вистачило і пального, і енергії.</p>
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

function ForecastPreview({ lat, lon }) {
  const [days, setDays] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!lat || !lon) return;
    let cancelled = false;
    setFailed(false);
    solarForecast(lat, lon)
      .then((d) => !cancelled && setDays(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);
  if (failed) return <span className="muted">Прогноз зараз недоступний, використовую 3 сонячні години.</span>;
  if (!days) return <span className="muted">Завантажую прогноз…</span>;
  const [today, tomorrow] = Object.values(days);
  const line = (label, d) => d && `${label}: ≈ ${String(d.sunHours).replace('.', ',')} сонячної год, хмарність ${d.cloudPct}%`;
  return <span className="muted">{[line('сьогодні', today), line('завтра', tomorrow)].filter(Boolean).join('; ')}</span>;
}

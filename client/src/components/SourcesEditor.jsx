import { useEffect, useState } from 'react';
import { SOURCE_KINDS, newSource } from '../sources.js';
import { stationPresets } from '../presets.js';
import { SOLAR_DERATE } from '@energy-planner/core/autonomy';
import { CITIES, solarForecast, typicalSunHours, monthName, defaultCity } from '../weather.js';
import { readChoice } from '../yasno.js';
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
              </div>
              <SolarEstimate panel={s} />
              <details className="more">
                <summary>{s.forecast ? `Прогноз для: ${s.place ?? 'Київ'}. Змінити або вказати вручну` : 'Сонячні години вказано вручну'}</summary>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!s.forecast}
                    onChange={(e) => {
                      const city = s.lat ? null : defaultCity(readChoice().sourceLabel);
                      update(s.id, e.target.checked ? { forecast: false } : { forecast: true, ...(city ? { place: city.name, lat: city.lat, lon: city.lon } : {}) });
                    }}
                  />
                  Вказати сонячні години вручну
                </label>
                {s.forecast ? (
                  <div className="grid-fields">
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
                    <div className="field forecast-row">
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
                    </div>
                  </div>
                ) : (
                  <div className="grid-fields">
                    <Num label="Сонячних годин за день" value={s.sunHours} step={0.5} onChange={(v) => update(s.id, { sunHours: v })} />
                  </div>
                )}
                <p className="hint field-note">
                  Сонячна година — година роботи панелей на повну потужність. Прогноз погоди (Open-Meteo) враховує хмарність; вручну варто вказувати, якщо ви знаєте реальну віддачу своїх панелей.
                </p>
              </details>
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

// Скільки дадуть панелі: з прогнозу погоди, а без нього — звичайне для цієї пори року значення.
function SolarEstimate({ panel }) {
  const [days, setDays] = useState(null);
  const [failed, setFailed] = useState(false);
  const { forecast, lat, lon } = panel;
  useEffect(() => {
    if (!forecast || !lat || !lon) return;
    let cancelled = false;
    setDays(null);
    setFailed(false);
    solarForecast(lat, lon)
      .then((d) => !cancelled && setDays(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [forecast, lat, lon]);

  const kwh = (hours) => ((Number(panel.peakW) || 0) * hours * SOLAR_DERATE) / 1000;
  const num = (x) => x.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
  const day = (label, hours, cloud) =>
    `${label} ≈ ${num(hours)} год сонця${cloud !== undefined ? ` (${cloudWord(cloud)})` : ''}, це ≈ ${num(kwh(hours))} кВт·год`;

  let text;
  if (!forecast) text = `Вказано вручну: ${day('щодня', Number(panel.sunHours) || 0)}.`;
  else if (failed || !lat) {
    const h = typicalSunHours();
    text = `Прогноз зараз недоступний, тому беру звичайне для ${monthName()} значення: ${day('', h).trim()}.`;
  } else if (!days) text = 'Завантажую прогноз погоди…';
  else {
    const [today, tomorrow] = Object.values(days);
    text = [today && day('Сьогодні очікується', today.sunHours, today.cloudPct), tomorrow && day('завтра', tomorrow.sunHours, tomorrow.cloudPct)].filter(Boolean).join('; ') + '.';
  }
  return <p className="solar-estimate">☀️ {text}</p>;
}

function cloudWord(pct) {
  if (pct < 25) return 'ясно';
  if (pct < 60) return 'мінлива хмарність';
  if (pct < 85) return 'хмарно';
  return 'похмуро';
}

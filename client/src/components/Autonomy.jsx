import { useMemo, useState } from 'react';
import { batterySource, generatorSource, solarSource, estimateAutonomy } from '@energy-planner/core/autonomy';
import { appliancePresets, baseLoadPresets } from '../presets.js';
import { EnergyBreakdown, DischargeChart, clock, hoursText } from './AutonomyCharts.jsx';

const DEFAULT_GENERATOR = { ratedW: 2500, tankHoursAtHalf: 8, fuelPct: 100 };
const DEFAULT_SOLAR = { peakW: 800, sunHours: 3 };
const EXTRA_PRESETS = [...baseLoadPresets, ...appliancePresets];

// «Скільки протримається»: людина відмічає, що хоче живити, і бачить для кожного джерела
// навантаження у відсотках і приблизний час роботи.
export default function Autonomy({ household, onChange }) {
  const set = (key, value) => onChange({ ...household, [key]: value });
  const generator = household.generator ?? null;
  const solar = household.solar ?? null;

  const own = useMemo(
    () => [
      ...(household.baseLoads ?? []).map((c, i) => ({ key: `base-${c.id ?? i}`, base: true, ...c })),
      ...(household.appliances ?? []).map((c, i) => ({ key: `app-${c.id ?? i}`, base: false, ...c })),
    ],
    [household.baseLoads, household.appliances],
  );
  const [extra, setExtra] = useState([]);
  // За замовчуванням увімкнені постійні навантаження: саме їх зазвичай треба тримати під час відключення.
  const [unchecked, setUnchecked] = useState(() => new Set());
  const [checked, setChecked] = useState(() => new Set());
  const items = [...own, ...extra];
  const isOn = (item) => (item.base || item.extra ? !unchecked.has(item.key) : checked.has(item.key));
  const toggle = (item) => {
    const flip = (setter) =>
      setter((prev) => {
        const next = new Set(prev);
        next.has(item.key) ? next.delete(item.key) : next.add(item.key);
        return next;
      });
    if (item.base || item.extra) flip(setUnchecked);
    else flip(setChecked);
  };

  const consumers = items.filter(isOn).map((c) => ({ name: c.name || 'Без назви', powerW: Number(c.powerW) || 0, priority: c.priority }));

  const sources = [];
  const b = household.battery;
  if (b?.capacityWh > 0 && b.inverterMaxW > 0) {
    sources.push(
      batterySource({
        name: b.model ? `Станція ${b.model}` : 'Зарядна станція',
        capacityWh: b.capacityWh,
        socPct: b.initialSocPct ?? 100,
        minSocPct: b.minSocPct ?? 10,
        inverterMaxW: b.inverterMaxW,
      }),
    );
  }
  if (generator?.ratedW > 0 && generator.tankHoursAtHalf > 0) sources.push(generatorSource(generator));
  if (solar?.peakW > 0 && solar.sunHours > 0) sources.push(solarSource(solar));

  const estimate = estimateAutonomy(sources, consumers);

  return (
    <section className="card autonomy">
      <p className="hint">Відмітьте, що хочете живити під час відключення, і побачите, на скільки вистачить кожного джерела.</p>

      <div className="autonomy-inputs">
        <div>
          <h3>Джерела живлення</h3>
          <p className="source-line">
            {b ? (
              <>
                <strong>{b.model ?? 'Зарядна станція'}</strong>: {fmt(b.capacityWh)} Вт·год, заряд {b.initialSocPct ?? 100}%, інвертор до {fmt(b.inverterMaxW)} Вт
                <span className="muted"> (із форми)</span>
              </>
            ) : (
              <span className="muted">Зарядної станції немає, її можна додати у формі «Мережа і зарядна станція».</span>
            )}
          </p>

          <label className="checkbox">
            <input type="checkbox" checked={Boolean(generator)} onChange={(e) => set('generator', e.target.checked ? DEFAULT_GENERATOR : null)} />
            Бензиновий генератор
          </label>
          {generator && (
            <div className="grid-fields compact">
              <Num label="Потужність, Вт" value={generator.ratedW} onChange={(v) => set('generator', { ...generator, ratedW: v })} />
              <Num label="Повного бака на, год" value={generator.tankHoursAtHalf} onChange={(v) => set('generator', { ...generator, tankHoursAtHalf: v })} />
              <Num label="Пального, %" value={generator.fuelPct} onChange={(v) => set('generator', { ...generator, fuelPct: v })} />
            </div>
          )}
          {generator && (
            <p className="hint field-note">У паспорті генератора час роботи на повному баку зазвичай вказують для навантаження 50%.</p>
          )}

          <label className="checkbox">
            <input type="checkbox" checked={Boolean(solar)} onChange={(e) => set('solar', e.target.checked ? DEFAULT_SOLAR : null)} />
            Сонячні панелі
          </label>
          {solar && (
            <div className="grid-fields compact">
              <Num label="Потужність, Вт" value={solar.peakW} onChange={(v) => set('solar', { ...solar, peakW: v })} />
              <Num label="Сонячних годин" value={solar.sunHours} step={0.5} onChange={(v) => set('solar', { ...solar, sunHours: v })} />
            </div>
          )}
        </div>

        <div>
          <h3>Що живити</h3>
          <ul className="consumer-list">
            {items.map((item) => (
              <li key={item.key}>
                <label className="checkbox">
                  <input type="checkbox" checked={isOn(item)} onChange={() => toggle(item)} />
                  <span className="consumer-name">{item.name || 'Без назви'}</span>
                  <span className="muted">{fmt(item.powerW)} Вт</span>
                </label>
                {item.extra && (
                  <button type="button" className="icon-button" title="Прибрати" onClick={() => setExtra(extra.filter((x) => x !== item))}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <select
            className="preset-select"
            value=""
            onChange={(e) => {
              const preset = EXTRA_PRESETS[Number(e.target.value)];
              if (preset) setExtra([...extra, { ...preset, key: `extra-${Date.now()}`, extra: true }]);
            }}
          >
            <option value="">Додати споживача з довідника…</option>
            {EXTRA_PRESETS.map((p, i) => (
              <option key={`${p.name}-${i}`} value={i}>
                {p.name}, {p.powerW} Вт
              </option>
            ))}
          </select>
          <p className="total-line">
            Разом: <strong>{fmt(estimate.totalW)} Вт</strong>
            {consumers.length > 0 && <span className="muted"> ({consumers.length} шт.)</span>}
          </p>
        </div>
      </div>

      {sources.length === 0 ? (
        <p className="muted">Додайте хоча б одне джерело: зарядну станцію у формі, генератор або панелі.</p>
      ) : consumers.length === 0 ? (
        <p className="muted">Відмітьте хоча б одного споживача.</p>
      ) : (
        <>
          <Conclusion estimate={estimate} household={household} />
          <div className="source-results">
            {estimate.sources.map((r) => (
              <SourceResult key={r.name} r={r} />
            ))}
          </div>
          <div className="autonomy-charts">
            <DischargeChart series={dischargeSeries(estimate, household)} />
            <EnergyBreakdown consumers={consumers} hours={estimate.sources.find((r) => r.kind !== 'solar' && !r.overloaded)?.hours} />
          </div>
        </>
      )}
    </section>
  );
}

// Скільки працює джерело на тих споживачах, які воно реально витягне (при перевантаженні — без зайвих).
const runHours = (r) => (r.overloaded ? r.fitted?.hours : r.hours);

// Кольори закріплені за типом джерела в усіх графіках.
const SERIES_COLOR = { battery: '--series-1', generator: '--series-2' };

function dischargeSeries(estimate, household) {
  return estimate.sources
    .filter((r) => r.kind !== 'solar' && Number.isFinite(runHours(r)))
    .map((r) => ({
      name: r.kind === 'battery' ? 'Станція (заряд)' : 'Генератор (пальне)',
      color: SERIES_COLOR[r.kind],
      hours: runHours(r),
      startPct: r.kind === 'battery' ? Number(household.battery.initialSocPct ?? 100) : Number(household.generator.fuelPct ?? 100),
      endPct: r.kind === 'battery' ? Number(household.battery.minSocPct ?? 10) : 0,
    }));
}

// Висновок простими словами: до котрої години вистачить кожного джерела, якщо світло зникне зараз.
function Conclusion({ estimate }) {
  const now = new Date();
  const usable = estimate.sources.filter((r) => r.kind !== 'solar' && Number.isFinite(runHours(r)));
  if (!usable.length) return null;
  const total = usable.reduce((s, r) => s + runHours(r), 0);
  const parts = usable.map((r) => `${r.kind === 'battery' ? 'станції' : 'генератора'} — до ${clock(now, runHours(r))} (${hoursText(runHours(r))})`);
  return (
    <div className="conclusion">
      <div className="conclusion-label">Якщо світло зникне зараз, о {now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="conclusion-main">Вистачить: {parts.join(', ')}.</div>
      {usable.length > 1 && total < 48 && (
        <div className="conclusion-sub">
          Якщо використовувати джерела по черзі, разом протримаєтесь {hoursText(total)}, до {clock(now, total)}.
        </div>
      )}
      {usable.some((r) => r.overloaded) && <div className="conclusion-sub">Для перевантажених джерел час указано без приладів, які доведеться вимкнути (див. нижче).</div>}
    </div>
  );
}

function SourceResult({ r }) {
  const tone = r.overloaded ? 'bad' : r.heavy ? 'warn' : 'good';
  const shown = r.overloaded ? r.fitted : r;
  return (
    <div className={`source-result ${tone}`}>
      <div className="source-head">
        <span className="source-name">{r.name}</span>
        <span className="source-hours">{shown ? duration(shown.hours) : '—'}</span>
      </div>
      <div className="load-bar" aria-hidden="true">
        <div style={{ width: `${Math.min(100, r.loadPct)}%` }} />
      </div>
      <p className="source-load">
        Навантаження {Math.round(r.loadPct)}% ({fmt(r.loadW)} з {fmt(Math.round(r.maxW))} Вт)
        {r.energyWh !== null && <>, запас ≈ {fmt(Math.round(r.energyWh))} Вт·год{r.kind === 'solar' ? ' за день' : ''}</>}
      </p>
      <p className="source-verdict">{verdict(r)}</p>
    </div>
  );
}

function verdict(r) {
  const night = r.kind === 'solar' ? ' Панелі дають енергію лише вдень, вночі потрібна станція.' : '';
  if (r.overloaded) {
    if (!r.fitted) return `Не витягне жоден з вибраних споживачів: кожен потужніший за ${fmt(Math.round(r.maxW))} Вт.`;
    return `Перевантаження. Вимкніть ${list(r.drop)}, тоді решти (${list(r.keep)}) вистачить ${durationText(r.fitted.hours)}.${night}`;
  }
  const heavy = r.heavy ? ' Навантаження понад 80%, краще зняти щось менш важливе.' : '';
  return `Вистачить ${durationText(r.hours)} на ${list(r.keep)}.${heavy}${night}`;
}

function list(consumers) {
  return consumers.map((c) => c.name.charAt(0).toLowerCase() + c.name.slice(1)).join(', ');
}

function durationText(hours) {
  if (!Number.isFinite(hours) || hours >= 48) return 'більше ніж на дві доби';
  return `приблизно на ${duration(hours)}`;
}

function duration(hours) {
  if (!Number.isFinite(hours) || hours >= 48) return '> 2 діб';
  const total = Math.max(0, Math.round((hours * 60) / 10) * 10);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} хв`;
  return m ? `${h} год ${m} хв` : `${h} год`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('uk-UA');
}

function Num({ label, value, onChange, step = 1 }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    </label>
  );
}

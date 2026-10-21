import { useMemo, useState } from 'react';
import { batterySource, generatorSource, solarSource, estimateAutonomy } from '@energy-planner/core/autonomy';
import { appliancePresets, baseLoadPresets } from '../presets.js';
import { SOURCE_KINDS } from '../sources.js';
import { EnergyBreakdown, clock, hoursText } from './AutonomyCharts.jsx';
import BackupTimeline from './BackupTimeline.jsx';

const EXTRA_PRESETS = [...baseLoadPresets, ...appliancePresets];

// Кольори закріплені за джерелом (за його місцем у списку «Мій дім»), тож не змінюються, коли інші вимкнено.
const PALETTE = ['--series-1', '--series-2', '--series-3', '--series-4'];

// Об'єкт розрахунку ядра для джерела зі списку «Мій дім».
function toCore(s) {
  if (s.kind === 'battery' && s.capacityWh > 0 && s.inverterMaxW > 0) {
    return batterySource({ name: s.name, capacityWh: s.capacityWh, socPct: s.initialSocPct ?? 100, minSocPct: s.minSocPct ?? 10, inverterMaxW: s.inverterMaxW });
  }
  if (s.kind === 'generator' && s.ratedW > 0 && s.tankHoursAtHalf > 0) return generatorSource(s);
  if (s.kind === 'solar' && s.peakW > 0 && s.sunHours > 0) return solarSource(s);
  return null;
}

// «Резервне живлення»: людина обирає джерела з «Мого дому» і те, що хоче живити,
// і бачить для кожного джерела навантаження, час роботи і графік розряду.
export default function Autonomy({ household }) {
  const allSources = household.sources ?? [];
  const [offSources, setOffSources] = useState(() => new Set());
  const toggleSource = (id) =>
    setOffSources((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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

  // Джерела, які людина відмітила, разом з їхнім кольором і параметрами для графіка.
  const selected = allSources
    .map((src, index) => ({ src, color: PALETTE[index % PALETTE.length], core: toCore(src) }))
    .filter((x) => x.core && !offSources.has(x.src.id));
  const sources = selected.map((x) => x.core);
  const estimate = estimateAutonomy(sources, consumers);

  return (
    <section className="card autonomy">
      <p className="hint">Відмітьте, що хочете живити під час відключення, і побачите, на скільки вистачить кожного джерела.</p>

      <div className="autonomy-inputs">
        <div>
          <h3>Джерела живлення</h3>
          {allSources.length === 0 ? (
            <p className="muted">
              Джерел ще немає. Додайте зарядну станцію, генератор чи панелі в <a href="#/home">«Мій дім»</a>.
            </p>
          ) : (
            <ul className="consumer-list">
              {allSources.map((src, index) => (
                <li key={src.id}>
                  <label className="checkbox">
                    <input type="checkbox" checked={!offSources.has(src.id)} onChange={() => toggleSource(src.id)} />
                    <i className="swatch" style={{ background: `var(${PALETTE[index % PALETTE.length]})` }} aria-hidden="true" />
                    <span className="consumer-name">
                      {SOURCE_KINDS[src.kind].icon} {src.name}
                    </span>
                    <span className="muted">{describeSource(src)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            Змінити або додати джерела можна в <a href="#/home">«Мій дім»</a>.
          </p>
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
        <p className="muted">Відмітьте хоча б одне джерело живлення.</p>
      ) : consumers.length === 0 ? (
        <p className="muted">Відмітьте хоча б одного споживача.</p>
      ) : (
        <>
          <Conclusion estimate={estimate} />
          <div className="source-results">
            {estimate.sources.map((r) => (
              <SourceResult key={r.name} r={r} />
            ))}
          </div>
          <div className="autonomy-charts">
            <BackupTimeline sources={selected.map((x) => x.src)} consumers={consumers} />
            <EnergyBreakdown consumers={consumers} hours={estimate.sources.find((r) => r.kind !== 'solar' && !r.overloaded)?.hours} />
          </div>
        </>
      )}
    </section>
  );
}

// Скільки працює джерело на тих споживачах, які воно реально витягне (при перевантаженні — без зайвих).
const runHours = (r) => (r.overloaded ? r.fitted?.hours : r.hours);

function describeSource(s) {
  if (s.kind === 'battery') return `${fmt(s.capacityWh)} Вт·год, ${s.initialSocPct ?? 100}%`;
  if (s.kind === 'generator') return `${fmt(s.ratedW)} Вт, пального ${s.fuelPct ?? 100}%`;
  return `${fmt(s.peakW)} Вт`;
}

// Висновок простими словами: до котрої години вистачить кожного джерела, якщо світло зникне зараз.
function Conclusion({ estimate }) {
  const now = new Date();
  const usable = estimate.sources.filter((r) => r.kind !== 'solar' && Number.isFinite(runHours(r)));
  if (!usable.length) return null;
  const parts = usable.map((r) => `${r.name} — до ${clock(now, runHours(r))} (${hoursText(runHours(r))})`);
  return (
    <div className="conclusion">
      <div className="conclusion-label">Кожного джерела окремо вистачить, якщо світло зникне зараз, о {now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="conclusion-main">
        {parts.map((p) => (
          <div key={p}>{p}</div>
        ))}
      </div>
      {usable.length > 1 && <div className="conclusion-sub">Це для кожного джерела окремо; як вони працюватимуть разом, показано на графіку нижче.</div>}
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

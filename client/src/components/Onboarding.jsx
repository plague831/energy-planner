import { useEffect, useState } from 'react';
import { loadSources, loadGroups } from '../yasno.js';
import { iconFor } from '../icons.js';
import { appliancePresets, baseLoadPresets, stationPresets } from '../presets.js';
import { newSource, withSources } from '../sources.js';

const DEFAULT_BASE = ['Холодильник', 'Роутер і ONT', 'Освітлення (LED)'];
const DEFAULT_APPLIANCES = ['Пральна машина', 'Бойлер', 'Електрочайник'];

// Майстер першого запуску: три кроки замість великої форми. Після нього людина одразу бачить план.
export default function Onboarding({ onFinish, onSkip }) {
  const [step, setStep] = useState(0);
  const [sources, setSources] = useState(null);
  const [groups, setGroups] = useState(null);
  const [source, setSource] = useState('');
  const [group, setGroup] = useState('');
  const [noQueue, setNoQueue] = useState(false);
  const [hasStation, setHasStation] = useState(null);
  const [model, setModel] = useState(-1);
  const [soc, setSoc] = useState(80);
  const [base, setBase] = useState(new Set(DEFAULT_BASE));
  const [apps, setApps] = useState(new Set(DEFAULT_APPLIANCES));

  useEffect(() => {
    loadSources()
      .then((list) => {
        setSources(list);
        setSource(list[0]?.value ?? '');
      })
      .catch(() => {
        setSources([]);
        setNoQueue(true);
      });
  }, []);

  useEffect(() => {
    if (!source) return;
    setGroups(null);
    loadGroups(source)
      .then((names) => {
        setGroups(names);
        setGroup((g) => (names.includes(g) ? g : names[0] ?? ''));
      })
      .catch(() => setGroups([]));
  }, [source]);

  const toggle = (set, setter, name) => {
    const next = new Set(set);
    next.has(name) ? next.delete(name) : next.add(name);
    setter(next);
  };

  const finish = () => {
    const preset = stationPresets[model];
    const station = preset
      ? newSource('battery', { capacityWh: preset.capacityWh, inverterMaxW: preset.inverterMaxW, maxChargeW: preset.maxChargeW, model: preset.name, name: `Станція ${preset.name}`, initialSocPct: soc })
      : newSource('battery', { initialSocPct: soc });
    const stamp = Date.now();
    onFinish({
      household: withSources({
        grid: { maxPowerW: 5000 },
        outages: [],
        baseLoads: baseLoadPresets.filter((p) => base.has(p.name)).map((p, i) => ({ id: `base-${stamp}-${i}`, ...p })),
        appliances: appliancePresets.filter((p) => apps.has(p.name)).map((p, i) => ({ id: `appliance-${stamp}-${i}`, ...p })),
      }, hasStation ? [station] : []),
      choice: noQueue || !source || !group ? null : { source, group, day: 'today', auto: true },
    });
  };

  const steps = ['Черга', 'Станція', 'Прилади'];
  const canNext = step === 0 ? noQueue || (source && group) : step === 1 ? hasStation !== null : true;

  return (
    <div className="onboarding">
      <section className="card">
        <p className="onboarding-hello">Вітаємо! Три короткі кроки, і сайт складе план на сьогодні.</p>
        <ol className="stepper">
          {steps.map((s, i) => (
            <li key={s} className={i === step ? 'active' : i < step ? 'done' : ''}>
              <span>{i + 1}</span> {s}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="onboarding-step">
            <h2>Де ви живете?</h2>
            <p className="hint">Для Києва й Дніпра графік відключень підтягуватиметься сам. Номер черги можна знайти на сайті чи в застосунку обленерго.</p>
            {!noQueue && (
              <div className="grid-fields">
                <label className="field">
                  <span>Місто</span>
                  <select value={source} onChange={(e) => setSource(e.target.value)} disabled={!sources?.length}>
                    {(sources ?? []).map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Черга</span>
                  <select value={group} onChange={(e) => setGroup(e.target.value)} disabled={!groups?.length}>
                    {(groups ?? []).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <label className="checkbox">
              <input type="checkbox" checked={noQueue} onChange={(e) => setNoQueue(e.target.checked)} />
              Мого міста немає, введу графік вручну пізніше
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-step">
            <h2>Чи є у вас зарядна станція?</h2>
            <p className="hint">Генератор, сонячні панелі чи ще одну станцію можна буде додати потім у «Мій дім».</p>
            <div className="choice-buttons">
              <button type="button" className={hasStation === true ? 'chip selected' : 'chip'} onClick={() => setHasStation(true)}>
                🔋 Так, є
              </button>
              <button type="button" className={hasStation === false ? 'chip selected' : 'chip'} onClick={() => setHasStation(false)}>
                Ні
              </button>
            </div>
            {hasStation && (
              <div className="grid-fields">
                <label className="field">
                  <span>Модель (якщо знаєте)</span>
                  <select value={model} onChange={(e) => setModel(Number(e.target.value))}>
                    <option value={-1}>Не знаю / іншої моделі (типова 1 кВт·год)</option>
                    {stationPresets.map((p, i) => (
                      <option key={p.name} value={i}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Заряд зараз: {soc}%</span>
                  <input type="range" min={0} max={100} step={5} value={soc} onChange={(e) => setSoc(Number(e.target.value))} />
                </label>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <h2>Що є вдома?</h2>
            <p className="hint">Відмітьте основне, решту можна додати потім. Потужність і час роботи підставляться самі.</p>
            <h3>Працює постійно</h3>
            <div className="device-choices">
              {baseLoadPresets.map((p) => (
                <button key={p.name} type="button" className={base.has(p.name) ? 'chip selected' : 'chip'} onClick={() => toggle(base, setBase, p.name)} aria-pressed={base.has(p.name)}>
                  {iconFor(p.name)} {p.name}
                </button>
              ))}
            </div>
            <h3>Можна ввімкнути в зручний час</h3>
            <div className="device-choices">
              {appliancePresets.map((p) => (
                <button key={p.name} type="button" className={apps.has(p.name) ? 'chip selected' : 'chip'} onClick={() => toggle(apps, setApps, p.name)} aria-pressed={apps.has(p.name)}>
                  {iconFor(p.name)} {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="onboarding-nav">
          {step > 0 ? (
            <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
              Назад
            </button>
          ) : (
            <button type="button" className="link-button" onClick={onSkip}>
              Пропустити й подивитися приклад
            </button>
          )}
          {step < 2 ? (
            <button type="button" onClick={() => setStep(step + 1)} disabled={!canNext}>
              Далі
            </button>
          ) : (
            <button type="button" onClick={finish}>
              Показати мій план
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

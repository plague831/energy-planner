import ListEditor from '../components/ListEditor.jsx';
import OutageImport from '../components/OutageImport.jsx';
import DevicePicker from '../components/DevicePicker.jsx';
import { useToast } from '../components/Toasts.jsx';
import { appliancePresets, baseLoadPresets, stationPresets } from '../presets.js';

const outageColumns = [
  { key: 'from', label: 'З', type: 'time' },
  { key: 'to', label: 'До', type: 'time' },
];

const baseColumns = [
  { key: 'name', label: 'Назва' },
  { key: 'powerW', label: 'Потужність, Вт', type: 'number' },
  { key: 'priority', label: 'Пріоритет', type: 'priority' },
  { key: 'from', label: 'Працює з', type: 'time' },
  { key: 'to', label: 'до', type: 'time' },
];

const applianceColumns = [
  { key: 'name', label: 'Назва' },
  { key: 'powerW', label: 'Потужність, Вт', type: 'number' },
  { key: 'durationMin', label: 'Тривалість, хв', type: 'number', step: 15 },
  { key: 'earliest', label: 'Не раніше', type: 'time' },
  { key: 'latest', label: 'Закінчити до', type: 'time' },
  { key: 'preferredStart', label: 'Бажаний старт', type: 'time' },
  { key: 'priority', label: 'Пріоритет', type: 'priority' },
  { key: 'allowOnBattery', label: 'Від станції', type: 'checkbox' },
];

export const DEFAULT_BATTERY = { capacityWh: 1024, initialSocPct: 70, minSocPct: 10, targetEndSocPct: 60, maxChargeW: 600, inverterMaxW: 1800 };

// «Мій дім»: усе, що описує домогосподарство, у трьох кроках. Прості поля на виду,
// точні технічні параметри — у розгорнутих блоках «Додатково».
export default function MyHome({ household, onChange, onOutagesLoaded }) {
  const notify = useToast();
  const set = (key, value) => onChange({ ...household, [key]: value });
  const battery = household.battery;
  const setBattery = (key, value) => {
    const specChanged = ['capacityWh', 'inverterMaxW', 'maxChargeW'].includes(key);
    set('battery', { ...battery, [key]: value, ...(specChanged ? { model: undefined } : {}) });
  };

  return (
    <div className="page-stack">
      <section className="card">
        <h2>
          <span className="step">1</span> Графік відключень
        </h2>
        <p className="hint">Оберіть місто й свою чергу: графік підтягнеться з YASNO і оновлюватиметься сам. Чергу можна дізнатися на сайті чи в застосунку свого обленерго.</p>
        <OutageImport onApply={onOutagesLoaded} />
        <details className="more">
          <summary>Мого міста немає або графік інший: ввести вручну ({household.outages?.length ?? 0})</summary>
          <ListEditor
            columns={outageColumns}
            rows={household.outages}
            onChange={(rows) => set('outages', rows)}
            newRow={() => ({ from: '12:00', to: '16:00' })}
            addLabel="Додати відключення"
            emptyText="Відключень немає."
          />
        </details>
      </section>

      <section className="card">
        <h2>
          <span className="step">2</span> Зарядна станція
        </h2>
        <label className="checkbox">
          <input type="checkbox" checked={Boolean(battery)} onChange={(e) => set('battery', e.target.checked ? DEFAULT_BATTERY : null)} />
          У мене є зарядна станція або акумулятор з інвертором
        </label>
        {battery && (
          <>
            <div className="grid-fields station-simple">
              <label className="field">
                <span>Модель</span>
                <select
                  value={stationPresets.findIndex((p) => p.name === battery.model)}
                  onChange={(e) => {
                    const preset = stationPresets[Number(e.target.value)];
                    const { name, ...specs } = preset ?? {};
                    onChange({ ...household, battery: preset ? { ...battery, ...specs, model: name } : { ...battery, model: undefined } });
                    if (preset) notify('success', `Підставлено параметри станції ${name}`);
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
              <NumberField label="Заряд зараз, %" value={battery.initialSocPct} onChange={(v) => setBattery('initialSocPct', v)} />
            </div>
            <details className="more">
              <summary>Додаткові параметри станції</summary>
              <div className="grid-fields">
                <NumberField label="Ємність, Вт·год" value={battery.capacityWh} onChange={(v) => setBattery('capacityWh', v)} />
                <NumberField label="Не розряджати нижче, %" value={battery.minSocPct} onChange={(v) => setBattery('minSocPct', v)} />
                <NumberField label="Бажаний заряд на кінець доби, %" value={battery.targetEndSocPct} onChange={(v) => setBattery('targetEndSocPct', v)} />
                <NumberField label="Потужність заряджання, Вт" value={battery.maxChargeW} onChange={(v) => setBattery('maxChargeW', v)} />
                <NumberField label="Макс. потужність інвертора, Вт" value={battery.inverterMaxW} onChange={(v) => setBattery('inverterMaxW', v)} />
              </div>
            </details>
          </>
        )}
        <details className="more">
          <summary>Обмеження мережі</summary>
          <p className="hint">Скільки ват одночасно витримує ваша проводка чи автомат. Якщо не знаєте, залиште 5000.</p>
          <div className="grid-fields">
            <NumberField label="Ліміт потужності мережі, Вт" value={household.grid?.maxPowerW} onChange={(v) => set('grid', { maxPowerW: v })} />
          </div>
        </details>
      </section>

      <section className="card">
        <h2>
          <span className="step">3</span> Що є вдома
        </h2>
        <DevicePicker household={household} onChange={onChange} />
        <details className="more">
          <summary>Точні налаштування: потужність, час роботи, важливість</summary>
          <p className="hint">Пріоритет від 1 (неважливо) до 5 (дуже важливо): при нестачі енергії першими вимикаються менш важливі прилади.</p>
          <h3>Працює постійно</h3>
          <ListEditor
            columns={baseColumns}
            rows={household.baseLoads}
            onChange={(rows) => set('baseLoads', rows)}
            newRow={(i) => ({ id: `base-${Date.now()}-${i}`, name: '', powerW: 50, priority: 3 })}
            addLabel="Додати свій прилад"
            presets={baseLoadPresets}
          />
          <h3>Можна ввімкнути в зручний час</h3>
          <ListEditor
            columns={applianceColumns}
            rows={household.appliances}
            onChange={(rows) => set('appliances', rows)}
            newRow={(i) => ({
              id: `appliance-${Date.now()}-${i}`,
              name: '',
              powerW: 1000,
              durationMin: 60,
              earliest: '07:00',
              latest: '23:00',
              priority: 3,
              allowOnBattery: true,
            })}
            addLabel="Додати свій прилад"
            presets={appliancePresets}
          />
        </details>
      </section>
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    </label>
  );
}

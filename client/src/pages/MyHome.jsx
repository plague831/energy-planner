import ListEditor from '../components/ListEditor.jsx';
import OutageImport from '../components/OutageImport.jsx';
import DevicePicker from '../components/DevicePicker.jsx';
import ApplianceEditor from '../components/ApplianceEditor.jsx';
import SourcesEditor from '../components/SourcesEditor.jsx';
import { withSources } from '../sources.js';
import { appliancePresets, baseLoadPresets } from '../presets.js';

const outageColumns = [
  { key: 'from', label: 'З', type: 'time' },
  { key: 'to', label: 'До', type: 'time' },
];

const baseColumns = [
  { key: 'name', label: 'Назва' },
  { key: 'powerW', label: 'Потужність, Вт', type: 'number' },
  { key: 'priority', label: 'Пріоритет', type: 'priority' },
  { key: 'hours', label: 'Коли працює', render: (row, patch) => <WorkHours row={row} onChange={patch} /> },
];


// «Мій дім»: усе, що описує домогосподарство, у трьох кроках. Прості поля на виду,
// точні технічні параметри — у розгорнутих блоках «Додатково».
export default function MyHome({ household, onChange, onOutagesLoaded }) {
  const set = (key, value) => onChange({ ...household, [key]: value });

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
          <span className="step">2</span> Джерела живлення
        </h2>
        <p className="hint">Що допомагає пережити відключення: зарядні станції, генератор, сонячні панелі. Можна додати кілька.</p>
        <SourcesEditor sources={household.sources ?? []} onChange={(sources) => onChange(withSources(household, sources))} />
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
          <h3>Працює постійно або у певні години</h3>
          <p className="hint">
            Холодильник чи роутер працюють цілодобово. Години потрібні лише для того, що працює частину доби (світло ввечері, ноутбук удень): так план
            знає, скільки енергії піде саме під час відключення.
          </p>
          <ListEditor
            columns={baseColumns}
            rows={household.baseLoads}
            onChange={(rows) => set('baseLoads', rows)}
            newRow={(i) => ({ id: `base-${Date.now()}-${i}`, name: '', powerW: 50, priority: 3 })}
            addLabel="Додати свій прилад"
            presets={baseLoadPresets}
          />
          <h3>Можна ввімкнути в зручний час</h3>
          <ApplianceEditor
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

// Більшість постійних приладів (холодильник, роутер) працюють цілодобово, тож години ховаються за галочкою.
// Години потрібні лише для того, що працює частину доби (світло ввечері, ноутбук удень): так план знає,
// коли саме це навантаження буде і скільки заряду станції воно забере під час відключення.
function WorkHours({ row, onChange }) {
  const allDay = !row.from && !row.to;
  return (
    <div className="work-hours">
      <label className="checkbox">
        <input type="checkbox" checked={allDay} onChange={(e) => onChange(e.target.checked ? { from: undefined, to: undefined } : { from: '09:00', to: '18:00' })} />
        цілодобово
      </label>
      {!allDay && (
        <span className="work-hours-times">
          <input type="time" step={900} value={row.from ?? ''} onChange={(e) => onChange({ from: e.target.value || undefined })} aria-label="Працює з" />
          –
          <input type="time" step={900} value={row.to ?? ''} onChange={(e) => onChange({ to: e.target.value || undefined })} aria-label="Працює до" />
        </span>
      )}
    </div>
  );
}

import ListEditor from './ListEditor.jsx';

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

export default function HouseholdForm({ household, onChange }) {
  const set = (key, value) => onChange({ ...household, [key]: value });
  const battery = household.battery;
  const setBattery = (key, value) => set('battery', { ...battery, [key]: value });

  return (
    <div className="form">
      <section className="card">
        <h2>Мережа і зарядна станція</h2>
        <div className="grid-fields">
          <NumberField label="Ліміт потужності мережі, Вт" value={household.grid?.maxPowerW} onChange={(v) => set('grid', { maxPowerW: v })} />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(battery)}
              onChange={(e) =>
                set(
                  'battery',
                  e.target.checked
                    ? { capacityWh: 1024, initialSocPct: 70, minSocPct: 10, targetEndSocPct: 60, maxChargeW: 600, inverterMaxW: 1800 }
                    : null,
                )
              }
            />
            Є зарядна станція
          </label>
        </div>
        {battery && (
          <div className="grid-fields">
            <NumberField label="Ємність, Вт·год" value={battery.capacityWh} onChange={(v) => setBattery('capacityWh', v)} />
            <NumberField label="Заряд зараз, %" value={battery.initialSocPct} onChange={(v) => setBattery('initialSocPct', v)} />
            <NumberField label="Не розряджати нижче, %" value={battery.minSocPct} onChange={(v) => setBattery('minSocPct', v)} />
            <NumberField label="Бажаний заряд на кінець доби, %" value={battery.targetEndSocPct} onChange={(v) => setBattery('targetEndSocPct', v)} />
            <NumberField label="Потужність заряджання, Вт" value={battery.maxChargeW} onChange={(v) => setBattery('maxChargeW', v)} />
            <NumberField label="Макс. потужність інвертора, Вт" value={battery.inverterMaxW} onChange={(v) => setBattery('inverterMaxW', v)} />
          </div>
        )}
      </section>

      <section className="card">
        <h2>Графік відключень</h2>
        <ListEditor
          columns={outageColumns}
          rows={household.outages}
          onChange={(rows) => set('outages', rows)}
          newRow={() => ({ from: '12:00', to: '16:00' })}
          addLabel="Додати відключення"
        />
      </section>

      <section className="card">
        <h2>Постійні навантаження</h2>
        <p className="hint">Те, що має працювати весь час або у певні години: холодильник, роутер, освітлення.</p>
        <ListEditor
          columns={baseColumns}
          rows={household.baseLoads}
          onChange={(rows) => set('baseLoads', rows)}
          newRow={(i) => ({ id: `base-${Date.now()}-${i}`, name: '', powerW: 50, priority: 3 })}
          addLabel="Додати навантаження"
        />
      </section>

      <section className="card">
        <h2>Прилади, час роботи яких можна зсунути</h2>
        <p className="hint">Пріоритет від 1 (неважливо) до 5 (дуже важливо).</p>
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
          addLabel="Додати прилад"
        />
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

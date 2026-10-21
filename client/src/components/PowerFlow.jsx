// «Енергія зараз»: схема потоків між мережею, сонцем, генератором, станцією і домом у поточний момент
// (як картки потоку енергії в Home Assistant), за розрахунком плану на цей 15-хвилинний інтервал.
const W = 360;
const H = 220;
const NODES = {
  grid: { x: 60, y: 50, icon: '🔌', label: 'Мережа', color: '--flow-grid' },
  solar: { x: 300, y: 50, icon: '☀️', label: 'Сонце', color: '--flow-solar' },
  generator: { x: 60, y: 170, icon: '⛽', label: 'Генератор', color: '--flow-generator' },
  battery: { x: 300, y: 170, icon: '🔋', label: 'Станція', color: '--flow-discharge' },
  home: { x: 180, y: 110, icon: '🏠', label: 'Дім', color: '--text' },
};

// Розкладає потужності слоту на потоки «звідки → куди».
export function flowsAt(t) {
  const served = t.servedW ?? 0;
  const charge = t.chargeW ?? 0;
  const solar = t.solarW ?? 0;
  const gen = t.generatorW ?? 0;
  const solarHome = Math.min(solar, served);
  const solarBattery = Math.max(0, solar - solarHome);
  const homeRest = served - solarHome;
  const chargeRest = Math.max(0, charge - solarBattery);
  const flows = { 'solar-home': solarHome, 'solar-battery': solarBattery };
  if (t.gridOn) {
    flows['grid-home'] = homeRest;
    flows['grid-battery'] = chargeRest;
  } else {
    const genHome = Math.min(gen, homeRest);
    flows['generator-home'] = genHome;
    flows['generator-battery'] = Math.max(0, gen - genHome);
    flows['battery-home'] = Math.max(0, homeRest - genHome);
  }
  return flows;
}

export default function PowerFlow({ trace, slot, household, hasGenerator, hasSolar }) {
  const t = trace?.[Math.max(0, Math.min(trace.length - 1, Math.floor(slot)))];
  if (!t) return null;
  const flows = flowsAt(t);
  const capacity = household.battery?.capacityWh;
  const present = { grid: true, home: true, battery: Boolean(capacity), generator: hasGenerator, solar: hasSolar };
  const w = (v) => `${Math.round(v).toLocaleString('uk-UA')} Вт`;
  const nodeValue = {
    grid: t.gridOn ? w((flows['grid-home'] ?? 0) + (flows['grid-battery'] ?? 0)) : 'немає',
    solar: w(t.solarW ?? 0),
    generator: (t.generatorW ?? 0) > 0 ? w(t.generatorW) : 'вимкнено',
    battery: capacity ? `${Math.round((t.energyWh / capacity) * 100)}%` : '',
    home: w(t.servedW ?? 0),
  };

  return (
    <section className="card power-flow">
      <h2>Енергія зараз</h2>
      <p className="hint">Звідки зараз живиться дім і куди йде енергія, за розрахунком плану.</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Схема потоків енергії зараз">
        {Object.entries(flows).map(([key, value]) => {
          const [from, to] = key.split('-');
          if (!present[from] || !present[to]) return null;
          const a = NODES[from];
          const b = NODES[to];
          const active = value > 1;
          return (
            <g key={key} style={{ color: `var(${NODES[from].color})` }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={active ? 'flow-line active' : 'flow-line'} />
              {active && (
                <text className="flow-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle">
                  {w(value)}
                </text>
              )}
            </g>
          );
        })}
        {Object.entries(NODES).map(([key, n]) =>
          present[key] ? (
            <g key={key} className={`flow-node ${key === 'grid' && !t.gridOn ? 'off' : ''}`}>
              <circle cx={n.x} cy={n.y} r={key === 'home' ? 30 : 24} />
              <text x={n.x} y={n.y + 6} textAnchor="middle" className="flow-icon">
                {n.icon}
              </text>
              <text x={n.x} y={n.y + (key === 'home' ? 46 : 40)} textAnchor="middle" className="flow-caption">
                {n.label}: {nodeValue[key]}
              </text>
            </g>
          ) : null,
        )}
      </svg>
    </section>
  );
}

// Штрафні коефіцієнти цільової функції (у «балах дискомфорту»).
export const DEFAULT_WEIGHTS = {
  baseShedPerHour: 1, // година без постійного навантаження, помножена на його пріоритет
  applianceFailure: 10, // прилад не відпрацював (перерваний або не запланований), множиться на пріоритет
  preferencePerHour: 0.3, // година зсуву від бажаного часу запуску, множиться на пріоритет
  endShortfall: 20, // недозаряд станції в кінці доби (частка ємності) відносно цільового рівня
  generatorFuel: 8, // витрачений повний бак генератора (пальне, шум, знос)
};

// Витрата пального генератора наближено лінійна від навантаження x (частка номіналу):
// q(x) = q_ном · (0.25 + 0.75·x); повного бака вистачає на tankHoursAtHalf годин при x = 0.5.
const fuelRate = (x) => 0.25 + 0.75 * x;
// Гістерезис: генератор, увімкнений на порозі θ, вимикається, коли станція зарядилась до θ + 30%.
const GENERATOR_HYSTERESIS_PCT = 30;
const THRESHOLD_STEP = 5;

const SKIP = -1;

// Покрокова імітація доби для заданого плану.
// starts[i] — номер слоту запуску приладу i або -1, якщо прилад не запускається.
// grid[t] — 1, якщо в слоті t є світло, 0 — відключення.
export function simulate(model, starts, grid, weights = DEFAULT_WEIGHTS, options = {}) {
  const { T, slotHours, gridMaxW, battery, baseLoads, appliances, loadOrder } = model;
  const generators = model.generators ?? [];
  const solar = model.solar ?? null;
  const startSlot = model.startSlot ?? 0;
  const nA = appliances.length;
  const trace = options.trace ? [] : null;

  const failed = new Uint8Array(appliances.length);
  let energy = battery ? battery.initialWh : 0;
  let minEnergy = energy;
  let shedBasePoints = 0;
  let shedBaseWh = 0;
  let gridWh = 0;
  let batteryWh = 0;
  let solarWh = 0;
  let generatorWh = 0;
  let generatorSlots = 0;
  let fuelUsed = 0;
  const fuel = generators.map((g) => g.fuel);
  const running = generators.map(() => false);

  for (let t = startSlot; t < T; t++) {
    const gridOn = grid[t] === 1;
    const socPct = battery ? (energy / battery.capacityWh) * 100 : 0;

    // Генератор працює лише під час відключення: вмикається, коли заряд станції впав до порогу,
    // і вимикається, коли станція підзарядилась, пальне скінчилось або повернулось світло.
    let genCap = 0;
    for (let g = 0; g < generators.length; g++) {
      const gene = starts[nA + g];
      if (gridOn || gene === undefined || gene === SKIP || fuel[g] <= 0) {
        running[g] = false;
        continue;
      }
      const threshold = gene * THRESHOLD_STEP;
      if (!running[g] && (!battery || socPct <= threshold)) running[g] = true;
      else if (running[g] && battery && socPct >= Math.min(95, threshold + GENERATOR_HYSTERESIS_PCT)) running[g] = false;
      if (running[g]) genCap += generators[g].ratedW;
    }

    const solarW = solar ? solar[t] : 0;
    const nonBattery = (gridOn ? gridMaxW : 0) + solarW + genCap;
    const batteryCap = !gridOn && battery ? Math.min(battery.inverterMaxW, (Math.max(0, energy - battery.minWh) * battery.etaDis) / slotHours) : 0;
    const capacity = nonBattery + batteryCap;
    // Потужні прилади, які не можна живити від станції, можна вмикати від мережі або генератора.
    const strongSupply = gridOn || genCap > 0;

    let served = 0;
    for (let k = 0; k < loadOrder.length; k++) {
      const entry = loadOrder[k];
      if (entry.kind === 'base') {
        const load = baseLoads[entry.index];
        if (load.activeMask[t] === 0) continue;
        if (served + load.powerW <= capacity) {
          served += load.powerW;
        } else {
          shedBasePoints += load.priority * slotHours;
          shedBaseWh += load.powerW * slotHours;
        }
      } else {
        const i = entry.index;
        const s = starts[i];
        if (s === SKIP || failed[i] || t < s || t >= s + appliances[i].duration) continue;
        const load = appliances[i];
        const allowed = strongSupply || load.allowOnBattery;
        if (allowed && served + load.powerW <= capacity) {
          served += load.powerW;
        } else {
          failed[i] = 1; // цикл приладу перервано, далі він не працює
        }
      }
    }

    // Енергобаланс слоту: спершу сонце, потім мережа або генератор; станція покриває решту
    // під час відключення і заряджається з надлишку.
    const fromBattery = Math.max(0, served - nonBattery);
    let chargeW = 0;
    if (battery) {
      const room = (battery.capacityWh - energy) / (battery.etaCh * slotHours);
      chargeW = Math.max(0, Math.min(battery.maxChargeW, nonBattery - served, room));
      energy += chargeW * battery.etaCh * slotHours - (fromBattery * slotHours) / battery.etaDis;
      batteryWh += fromBattery * slotHours;
    }
    const solarUsed = Math.min(solarW, served + chargeW);
    const rest = served + chargeW - solarUsed - fromBattery;
    let genW = 0;
    if (gridOn) gridWh += Math.max(0, rest) * slotHours;
    else if (genCap > 0) {
      genW = Math.max(0, Math.min(genCap, rest));
      generatorWh += genW * slotHours;
      generatorSlots++;
      const x = genW / genCap;
      for (let g = 0; g < generators.length; g++) {
        if (!running[g]) continue;
        const used = Math.min(fuel[g], (slotHours / generators[g].tankHoursAtHalf) * (fuelRate(x) / fuelRate(0.5)));
        fuel[g] -= used;
        fuelUsed += used;
      }
    }
    solarWh += solarUsed * slotHours;
    if (energy < minEnergy) minEnergy = energy;

    if (trace) {
      trace.push({ slot: t, gridOn, demandW: demandAt(model, starts, t), servedW: served, chargeW, energyWh: energy, solarW: solarUsed, generatorW: genW, fuelPct: fuel.length ? (fuel.reduce((a, b) => a + b, 0) / fuel.length) * 100 : null });
    }
  }

  let failedPoints = 0;
  let preferencePoints = 0;
  const completed = [];
  const failedIds = [];
  for (let i = 0; i < appliances.length; i++) {
    const a = appliances[i];
    if (starts[i] === SKIP || failed[i]) {
      failedPoints += a.priority;
      failedIds.push(a.id);
    } else {
      completed.push(a.id);
      if (a.preferred !== null) preferencePoints += a.priority * Math.abs(starts[i] - a.preferred) * slotHours;
    }
  }

  const endShortfall = battery ? Math.max(0, battery.targetEndWh - energy) / battery.capacityWh : 0;

  const cost =
    weights.baseShedPerHour * shedBasePoints +
    weights.applianceFailure * failedPoints +
    weights.preferencePerHour * preferencePoints +
    weights.endShortfall * endShortfall +
    (weights.generatorFuel ?? 0) * fuelUsed;

  return {
    cost,
    shedBasePoints,
    shedBaseWh,
    failedIds,
    completedIds: completed,
    preferencePoints,
    endShortfall,
    minSocPct: battery ? (minEnergy / battery.capacityWh) * 100 : null,
    endSocPct: battery ? (energy / battery.capacityWh) * 100 : null,
    gridWh,
    batteryWh,
    solarWh,
    generatorWh,
    generatorHours: generatorSlots * slotHours,
    fuelUsedTanks: fuelUsed,
    trace,
  };
}

// Сумарна потужність, яку хотіли б спожити в слоті t (без урахування обмежень).
function demandAt(model, starts, t) {
  let demand = 0;
  for (const b of model.baseLoads) if (b.activeMask[t]) demand += b.powerW;
  model.appliances.forEach((a, i) => {
    const s = starts[i];
    if (s !== SKIP && t >= s && t < s + a.duration) demand += a.powerW;
  });
  return demand;
}

// Лише значення цільової функції, без зайвих об'єктів (використовується в оптимізаторах).
export function costOf(model, starts, grid, weights = DEFAULT_WEIGHTS) {
  return simulate(model, starts, grid, weights).cost;
}

export { SKIP };

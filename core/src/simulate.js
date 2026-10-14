// Штрафні коефіцієнти цільової функції (у «балах дискомфорту»).
export const DEFAULT_WEIGHTS = {
  baseShedPerHour: 1, // година без постійного навантаження, помножена на його пріоритет
  applianceFailure: 10, // прилад не відпрацював (перерваний або не запланований), множиться на пріоритет
  preferencePerHour: 0.3, // година зсуву від бажаного часу запуску, множиться на пріоритет
  endShortfall: 20, // недозаряд станції в кінці доби (частка ємності) відносно цільового рівня
};

const SKIP = -1;

// Покрокова імітація доби для заданого плану.
// starts[i] — номер слоту запуску приладу i або -1, якщо прилад не запускається.
// grid[t] — 1, якщо в слоті t є світло, 0 — відключення.
export function simulate(model, starts, grid, weights = DEFAULT_WEIGHTS, options = {}) {
  const { T, slotHours, gridMaxW, battery, baseLoads, appliances, loadOrder } = model;
  const trace = options.trace ? [] : null;

  const failed = new Uint8Array(appliances.length);
  let energy = battery ? battery.initialWh : 0;
  let minEnergy = energy;
  let shedBasePoints = 0;
  let shedBaseWh = 0;
  let gridWh = 0;
  let batteryWh = 0;

  for (let t = 0; t < T; t++) {
    const gridOn = grid[t] === 1;
    let capacity;
    if (gridOn) {
      capacity = gridMaxW;
    } else if (battery) {
      capacity = Math.min(battery.inverterMaxW, (Math.max(0, energy - battery.minWh) * battery.etaDis) / slotHours);
    } else {
      capacity = 0;
    }

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
        const allowed = gridOn || load.allowOnBattery;
        if (allowed && served + load.powerW <= capacity) {
          served += load.powerW;
        } else {
          failed[i] = 1; // цикл приладу перервано, далі він не працює
        }
      }
    }

    let chargeW = 0;
    if (gridOn) {
      gridWh += served * slotHours;
      if (battery) {
        const room = (battery.capacityWh - energy) / (battery.etaCh * slotHours);
        chargeW = Math.max(0, Math.min(battery.maxChargeW, gridMaxW - served, room));
        energy += chargeW * battery.etaCh * slotHours;
        gridWh += chargeW * slotHours;
      }
    } else if (battery) {
      energy -= (served * slotHours) / battery.etaDis;
      batteryWh += served * slotHours;
    }
    if (energy < minEnergy) minEnergy = energy;

    if (trace) {
      trace.push({ slot: t, gridOn, demandW: demandAt(model, starts, t), servedW: served, chargeW, energyWh: energy });
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
    weights.endShortfall * endShortfall;

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

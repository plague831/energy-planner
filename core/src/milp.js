// Точна математична модель задачі на опублікованому графіку як задача змішаного цілочисельного
// лінійного програмування (MILP), як у EMHASS. Розв'язується HiGHS (WebAssembly) і використовується
// в експерименті як еталон: нижня оцінка штрафу, до якої може наблизитися будь-який метод.
//
// Відмінності від імітатора (через які MILP дає саме нижню оцінку):
// - імітатор заряджає станцію за правилом «якомога швидше, коли є світло», а MILP обирає заряджання оптимально;
// - імітатор вимикає постійні навантаження за пріоритетом жадібно, а MILP — оптимально.
// Модель охоплює одну добу без генераторів і сонячних панелей.
import { SKIP } from './simulate.js';

export function buildNominalMilp(model, weights) {
  const { T, slotHours: dt, gridMaxW, battery, baseLoads, appliances, plannedGrid: g } = model;
  if ((model.generators ?? []).length || model.solar) throw new Error('MILP-модель не підтримує генератори і сонячні панелі');
  const obj = [];
  const cons = [];
  const binaries = [];
  const bounds = [];
  let constant = 0;
  const term = (coef, v) => `${coef >= 0 ? '+' : '-'} ${Math.abs(coef)} ${v}`;

  // Прилади: x_i_s — старт у слоті s, z_i — не вмикати сьогодні.
  const runAt = Array.from({ length: T }, () => []); // [i, s] для слоту t
  appliances.forEach((a, i) => {
    const starts = [];
    for (let s = a.earliest; s <= a.latestStart && s !== SKIP; s++) {
      // Прилад, який не можна живити від станції, не може працювати під час відключення (інакше він переривається).
      let ok = true;
      for (let t = s; t < s + a.duration; t++) if (!g[t] && !a.allowOnBattery) ok = false;
      if (!ok) continue;
      starts.push(s);
      binaries.push(`x_${i}_${s}`);
      for (let t = s; t < s + a.duration; t++) runAt[t].push([i, s]);
      const pref = a.preferred !== null ? weights.preferencePerHour * a.priority * Math.abs(s - a.preferred) * dt : 0;
      if (pref) obj.push(term(pref, `x_${i}_${s}`));
    }
    binaries.push(`z_${i}`);
    obj.push(term(weights.applianceFailure * a.priority, `z_${i}`));
    cons.push(` a${i}: ${starts.map((s) => `+ x_${i}_${s}`).join(' ')} + z_${i} = 1`);
  });

  // Постійні навантаження: b_j_t = 1 — увімкнене. Штраф за вимкнення: константа мінус w·Δ·b.
  baseLoads.forEach((b, j) => {
    for (let t = 0; t < T; t++) {
      if (!b.activeMask[t]) continue;
      binaries.push(`b_${j}_${t}`);
      constant += weights.baseShedPerHour * b.priority * dt;
      obj.push(term(-weights.baseShedPerHour * b.priority * dt, `b_${j}_${t}`));
    }
  });

  const load = (t) =>
    [
      ...baseLoads.flatMap((b, j) => (b.activeMask[t] ? [`+ ${b.powerW} b_${j}_${t}`] : [])),
      ...runAt[t].map(([i, s]) => `+ ${appliances[i].powerW} x_${i}_${s}`),
    ].join(' ') || '+ 0 dummy';

  for (let t = 0; t < T; t++) {
    if (g[t]) {
      // Світло є: навантаження й заряджання в межах вводу.
      cons.push(` grid${t}: ${load(t)}${battery ? ` + 1 c_${t}` : ''} <= ${gridMaxW}`);
      if (battery) {
        bounds.push(` 0 <= c_${t} <= ${battery.maxChargeW}`);
        cons.push(` e${t}: E_${t + 1} - E_${t} - ${battery.etaCh * dt} c_${t} = 0`);
      }
    } else if (battery) {
      // Відключення: навантаження зі станції в межах інвертора і запасу енергії.
      cons.push(` inv${t}: ${load(t)} <= ${battery.inverterMaxW}`);
      cons.push(` e${t}: E_${t + 1} - E_${t} ${load(t).replace(/\+ (\d+(?:\.\d+)?) /g, (_, p) => `+ ${(Number(p) * dt) / battery.etaDis} `)} = 0`);
    } else {
      cons.push(` off${t}: ${load(t)} <= 0`);
    }
  }
  if (battery) {
    cons.push(` e0fix: E_0 = ${battery.initialWh}`);
    for (let t = 0; t <= T; t++) bounds.push(` ${t === 0 ? 0 : battery.minWh} <= E_${t} <= ${battery.capacityWh}`);
    // Недозаряд на кінець доби: sh ≥ E_target − E_T.
    cons.push(` short: sh + E_${T} >= ${battery.targetEndWh}`);
    bounds.push(' sh >= 0');
    obj.push(term(weights.endShortfall / battery.capacityWh, 'sh'));
  }

  const lp = [
    'Minimize',
    ` obj: ${obj.join(' ') || '0 dummy'}`,
    'Subject To',
    ...cons,
    'Bounds',
    ...bounds,
    ' dummy = 0',
    'Binary',
    ` ${binaries.join(' ')}`,
    'End',
  ].join('\n');
  return { lp, constant };
}

// Розв'язує MILP і повертає план (хромосому) та нижню оцінку штрафу.
export async function solveNominalMilp(model, weights, { timeLimitSec = 30 } = {}) {
  const highs = await (await import('highs')).default();
  const { lp, constant } = buildNominalMilp(model, weights);
  const started = performance.now();
  const res = highs.solve(lp, { time_limit: timeLimitSec, mip_rel_gap: 1e-6 });
  const ms = performance.now() - started;
  const starts = model.appliances.map((a, i) => {
    const chosen = Object.entries(res.Columns).find(([name, col]) => name.startsWith(`x_${i}_`) && col.Primal > 0.5);
    return chosen ? Number(chosen[0].split('_')[2]) : SKIP;
  });
  return { status: res.Status, bound: res.ObjectiveValue + constant, starts, ms };
}

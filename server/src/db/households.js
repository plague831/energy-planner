import { buildModel } from '@energy-planner/core';
import { aggregateBattery, POWER_SOURCE_KINDS } from '@energy-planner/core/sources';
import { transaction } from './pool.js';

// Перетворення між рядками таблиць і об'єктом домогосподарства у форматі ядра
// ({ grid, sources, battery, baseLoads, appliances }), який використовує і форма на сайті.
// Кожне джерело живлення зберігається окремим рядком power_sources, а battery (еквівалентна
// станція для планувальника) щоразу обчислюється з них.

const hhmm = (t) => (t == null ? undefined : t.slice(0, 5));
const orNull = (v) => (v === undefined || v === '' ? null : v);
const num = (v) => (v == null ? undefined : Number(v));

// Рядок power_sources → джерело у форматі сайту (лише поля, що стосуються його типу).
function sourceFromRow(r) {
  const common = { id: r.code, kind: r.kind, name: r.name };
  if (r.kind === 'battery') {
    return {
      ...common,
      ...(r.model ? { model: r.model } : {}),
      capacityWh: r.capacity_wh,
      initialSocPct: num(r.initial_soc_pct),
      minSocPct: num(r.min_soc_pct),
      targetEndSocPct: num(r.target_end_soc_pct),
      maxChargeW: r.max_charge_w,
      inverterMaxW: r.inverter_max_w,
    };
  }
  if (r.kind === 'generator') return { ...common, ratedW: r.rated_w, tankHoursAtHalf: num(r.tank_hours_at_half), fuelPct: num(r.fuel_pct) };
  return {
    ...common,
    peakW: r.peak_w,
    ...(r.sun_hours != null ? { sunHours: num(r.sun_hours) } : {}),
    forecast: r.use_forecast,
    ...(r.use_forecast ? { place: r.place ?? undefined, lat: num(r.lat), lon: num(r.lon) } : {}),
  };
}

// Джерела з запиту. Старий формат (одна станція в battery без sources) теж приймається.
function sourcesOf(data) {
  if (Array.isArray(data.sources)) return data.sources;
  return data.battery ? [{ kind: 'battery', name: 'Зарядна станція', ...data.battery }] : [];
}

export async function listHouseholds(db, userId) {
  const { rows } = await db.query(
    `SELECT h.id, h.name, h.updated_at,
            (SELECT count(*) FROM appliances a WHERE a.household_id = h.id)::int AS appliance_count
       FROM households h WHERE h.user_id = $1 ORDER BY h.id`,
    [userId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, applianceCount: r.appliance_count, updatedAt: r.updated_at }));
}

// Повертає домогосподарство користувача або null, якщо його немає чи воно чуже.
export async function getHousehold(db, userId, id) {
  const { rows } = await db.query('SELECT * FROM households WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows[0]) return null;
  const h = rows[0];
  const [sourceRows, baseLoads, appliances] = await Promise.all([
    db.query('SELECT * FROM power_sources WHERE household_id = $1 ORDER BY position', [id]),
    db.query('SELECT * FROM base_loads WHERE household_id = $1 ORDER BY position', [id]),
    db.query('SELECT * FROM appliances WHERE household_id = $1 ORDER BY position', [id]),
  ]);
  const sources = sourceRows.rows.map(sourceFromRow);
  const battery = aggregateBattery(sources);
  if (battery && battery.model === undefined) delete battery.model;
  return {
    id: Number(h.id),
    name: h.name,
    updatedAt: h.updated_at,
    grid: { maxPowerW: h.grid_max_power_w },
    sources,
    battery,
    baseLoads: baseLoads.rows.map((r) => ({
      id: r.code,
      name: r.name,
      powerW: r.power_w,
      priority: r.priority,
      from: hhmm(r.active_from),
      to: hhmm(r.active_to),
    })),
    appliances: appliances.rows.map((r) => ({
      id: r.code,
      name: r.name,
      powerW: r.power_w,
      durationMin: r.duration_min,
      earliest: hhmm(r.earliest),
      latest: hhmm(r.latest),
      preferredStart: hhmm(r.preferred_start),
      priority: r.priority,
      allowOnBattery: r.allow_on_battery,
    })),
  };
}

// Перевіряє дані так само, як їх перевірятиме планувальник, щоб у базу не потрапило те,
// з чим план потім не складеться. Кидає помилку з поясненням українською.
export function validateHousehold(data) {
  if (!data || typeof data !== 'object') throw new Error('Не передано дані домогосподарства');
  const name = String(data.name ?? '').trim();
  if (!name) throw new Error('Вкажіть назву домогосподарства');
  const sources = sourcesOf(data);
  for (const [i, src] of sources.entries()) {
    if (!POWER_SOURCE_KINDS.includes(src?.kind)) throw new Error(`Поле sources[${i}].kind має бути одним із: ${POWER_SOURCE_KINDS.join(', ')}`);
    if (src.kind === 'solar' && !(Number(src.sunHours) >= 0) && !(src.forecast && Number.isFinite(Number(src.lat)) && Number.isFinite(Number(src.lon)))) {
      throw new Error(`Для сонячних панелей sources[${i}] вкажіть sunHours або прогноз з координатами (forecast, lat, lon)`);
    }
  }
  buildModel({ ...data, sources, battery: aggregateBattery(sources), outages: [] });
  return name;
}

export async function createHousehold(db, userId, data) {
  const name = validateHousehold(data);
  return transaction(db, async (client) => {
    const { rows } = await client.query(
      'INSERT INTO households (user_id, name, grid_max_power_w) VALUES ($1, $2, $3) RETURNING id',
      [userId, name, data.grid?.maxPowerW ?? 5000],
    );
    await writeContents(client, rows[0].id, data);
    return Number(rows[0].id);
  });
}

// Повністю замінює вміст домогосподарства (форма на сайті редагує його цілком).
export async function updateHousehold(db, userId, id, data) {
  const name = validateHousehold(data);
  return transaction(db, async (client) => {
    const { rowCount } = await client.query(
      'UPDATE households SET name = $3, grid_max_power_w = $4, updated_at = now() WHERE id = $1 AND user_id = $2',
      [id, userId, name, data.grid?.maxPowerW ?? 5000],
    );
    if (!rowCount) return false;
    await client.query('DELETE FROM power_sources WHERE household_id = $1', [id]);
    await client.query('DELETE FROM base_loads WHERE household_id = $1', [id]);
    await client.query('DELETE FROM appliances WHERE household_id = $1', [id]);
    await writeContents(client, id, data);
    return true;
  });
}

export async function deleteHousehold(db, userId, id) {
  const { rowCount } = await db.query('DELETE FROM households WHERE id = $1 AND user_id = $2', [id, userId]);
  return rowCount > 0;
}

async function writeContents(client, householdId, data) {
  for (const [i, src] of sourcesOf(data).entries()) {
    const battery = src.kind === 'battery';
    const generator = src.kind === 'generator';
    const solar = src.kind === 'solar';
    const forecast = solar && Boolean(src.forecast);
    await client.query(
      `INSERT INTO power_sources (household_id, position, code, kind, name, model, capacity_wh, initial_soc_pct, min_soc_pct,
                                  target_end_soc_pct, max_charge_w, inverter_max_w, rated_w, tank_hours_at_half, fuel_pct,
                                  peak_w, sun_hours, use_forecast, place, lat, lon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        householdId,
        i,
        src.id ?? `${src.kind}-${i + 1}`,
        src.kind,
        src.name ?? `Джерело ${i + 1}`,
        battery ? orNull(src.model) : null,
        battery ? src.capacityWh : null,
        battery ? (src.initialSocPct ?? 100) : null,
        battery ? (src.minSocPct ?? 10) : null,
        battery ? (src.targetEndSocPct ?? 60) : null,
        battery ? (src.maxChargeW ?? 500) : null,
        battery ? (src.inverterMaxW ?? 1000) : null,
        generator ? src.ratedW : null,
        generator ? src.tankHoursAtHalf : null,
        generator ? (src.fuelPct ?? 100) : null,
        solar ? src.peakW : null,
        solar ? orNull(src.sunHours) : null,
        forecast,
        forecast ? orNull(src.place) : null,
        forecast ? src.lat : null,
        forecast ? src.lon : null,
      ],
    );
  }
  for (const [i, l] of (data.baseLoads ?? []).entries()) {
    await client.query(
      `INSERT INTO base_loads (household_id, position, code, name, power_w, priority, active_from, active_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [householdId, i, l.id ?? `base-${i + 1}`, l.name ?? `Постійне навантаження ${i + 1}`, l.powerW, l.priority ?? 3, orNull(l.from), orNull(l.to)],
    );
  }
  for (const [i, a] of (data.appliances ?? []).entries()) {
    await client.query(
      `INSERT INTO appliances (household_id, position, code, name, power_w, duration_min, earliest, latest, preferred_start, priority, allow_on_battery)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        householdId,
        i,
        a.id ?? `appliance-${i + 1}`,
        a.name ?? `Прилад ${i + 1}`,
        a.powerW,
        a.durationMin,
        orNull(a.earliest),
        orNull(a.latest),
        orNull(a.preferredStart),
        a.priority ?? 3,
        a.allowOnBattery !== false,
      ],
    );
  }
}

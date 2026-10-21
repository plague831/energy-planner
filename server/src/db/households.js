import { buildModel } from '@energy-planner/core';
import { transaction } from './pool.js';

// Перетворення між рядками таблиць і об'єктом домогосподарства у форматі ядра
// ({ grid, battery, baseLoads, appliances }), який використовує і форма на сайті.

const hhmm = (t) => (t == null ? undefined : t.slice(0, 5));
const orNull = (v) => (v === undefined || v === '' ? null : v);

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
  const [battery, baseLoads, appliances] = await Promise.all([
    db.query('SELECT * FROM batteries WHERE household_id = $1', [id]),
    db.query('SELECT * FROM base_loads WHERE household_id = $1 ORDER BY position', [id]),
    db.query('SELECT * FROM appliances WHERE household_id = $1 ORDER BY position', [id]),
  ]);
  const b = battery.rows[0];
  return {
    id: Number(h.id),
    name: h.name,
    updatedAt: h.updated_at,
    grid: { maxPowerW: h.grid_max_power_w },
    battery: b
      ? {
          capacityWh: b.capacity_wh,
          initialSocPct: b.initial_soc_pct,
          minSocPct: b.min_soc_pct,
          targetEndSocPct: b.target_end_soc_pct,
          maxChargeW: b.max_charge_w,
          inverterMaxW: b.inverter_max_w,
        }
      : null,
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
  buildModel({ ...data, outages: [] });
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
    await client.query('DELETE FROM batteries WHERE household_id = $1', [id]);
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
  const b = data.battery;
  if (b) {
    await client.query(
      `INSERT INTO batteries (household_id, capacity_wh, initial_soc_pct, min_soc_pct, target_end_soc_pct, max_charge_w, inverter_max_w)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [householdId, b.capacityWh, b.initialSocPct ?? 100, b.minSocPct ?? 10, b.targetEndSocPct ?? 60, b.maxChargeW ?? 500, b.inverterMaxW ?? 1000],
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

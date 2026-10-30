-- Кілька джерел резервного живлення на домогосподарство: зарядні станції, генератори, сонячні панелі.
-- Замінює таблицю batteries, де могла бути лише одна станція. Спільні поля (тип, назва, порядок)
-- в одній таблиці, а параметри кожного типу — у своїх стовпцях; CHECK гарантує, що для типу задано
-- все потрібне.

CREATE TABLE power_sources (
  id                  bigserial PRIMARY KEY,
  household_id        bigint NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  position            integer NOT NULL,
  code                text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('battery', 'generator', 'solar')),
  name                text NOT NULL,

  -- Зарядна станція
  model               text,
  capacity_wh         integer CHECK (capacity_wh > 0),
  initial_soc_pct     real CHECK (initial_soc_pct BETWEEN 0 AND 100),
  min_soc_pct         real CHECK (min_soc_pct BETWEEN 0 AND 100),
  target_end_soc_pct  real CHECK (target_end_soc_pct BETWEEN 0 AND 100),
  max_charge_w        integer CHECK (max_charge_w > 0),
  inverter_max_w      integer CHECK (inverter_max_w > 0),

  -- Генератор
  rated_w             integer CHECK (rated_w > 0),
  tank_hours_at_half  real CHECK (tank_hours_at_half > 0),
  fuel_pct            real CHECK (fuel_pct BETWEEN 0 AND 100),

  -- Сонячні панелі: сонячні години або з прогнозу погоди для місця (place, lat, lon), або задані вручну
  peak_w              integer CHECK (peak_w > 0),
  sun_hours           real CHECK (sun_hours >= 0),
  use_forecast        boolean NOT NULL DEFAULT false,
  place               text,
  lat                 real CHECK (lat BETWEEN -90 AND 90),
  lon                 real CHECK (lon BETWEEN -180 AND 180),

  UNIQUE (household_id, position),
  CHECK (kind <> 'battery' OR (capacity_wh IS NOT NULL AND initial_soc_pct IS NOT NULL AND min_soc_pct IS NOT NULL
                               AND target_end_soc_pct IS NOT NULL AND max_charge_w IS NOT NULL AND inverter_max_w IS NOT NULL)),
  CHECK (kind <> 'generator' OR (rated_w IS NOT NULL AND tank_hours_at_half IS NOT NULL AND fuel_pct IS NOT NULL)),
  CHECK (kind <> 'solar' OR (peak_w IS NOT NULL AND (sun_hours IS NOT NULL OR (use_forecast AND lat IS NOT NULL AND lon IS NOT NULL))))
);
CREATE INDEX power_sources_household_idx ON power_sources (household_id);

-- Наявні станції переносяться без змін.
INSERT INTO power_sources (household_id, position, code, kind, name, capacity_wh, initial_soc_pct, min_soc_pct,
                           target_end_soc_pct, max_charge_w, inverter_max_w)
SELECT household_id, 0, 'battery-1', 'battery', 'Зарядна станція', capacity_wh, initial_soc_pct, min_soc_pct,
       target_end_soc_pct, max_charge_w, inverter_max_w
  FROM batteries;

DROP TABLE batteries;

-- Початкова схема: користувачі, сесії, домогосподарства з приладами,
-- збережені графіки відключень і історія складених планів.

CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- У cookie лежить випадковий токен, у базі тільки його SHA-256.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE households (
  id               bigserial PRIMARY KEY,
  user_id          bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name             text NOT NULL,
  grid_max_power_w integer NOT NULL DEFAULT 5000 CHECK (grid_max_power_w > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX households_user_idx ON households (user_id);

-- Зарядна станція (не більше однієї на домогосподарство).
CREATE TABLE batteries (
  household_id        bigint PRIMARY KEY REFERENCES households (id) ON DELETE CASCADE,
  capacity_wh         integer NOT NULL CHECK (capacity_wh > 0),
  initial_soc_pct     real NOT NULL DEFAULT 100 CHECK (initial_soc_pct BETWEEN 0 AND 100),
  min_soc_pct         real NOT NULL DEFAULT 10 CHECK (min_soc_pct BETWEEN 0 AND 100),
  target_end_soc_pct  real NOT NULL DEFAULT 60 CHECK (target_end_soc_pct BETWEEN 0 AND 100),
  max_charge_w        integer NOT NULL DEFAULT 500 CHECK (max_charge_w > 0),
  inverter_max_w      integer NOT NULL DEFAULT 1000 CHECK (inverter_max_w > 0)
);

-- Постійні навантаження (холодильник, роутер). Якщо active_from/active_to порожні, працюють цілодобово.
CREATE TABLE base_loads (
  id           bigserial PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  position     integer NOT NULL,
  code         text NOT NULL,
  name         text NOT NULL,
  power_w      real NOT NULL CHECK (power_w > 0),
  priority     smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  active_from  time,
  active_to    time
);
CREATE INDEX base_loads_household_idx ON base_loads (household_id);

-- Прилади, час роботи яких планується.
CREATE TABLE appliances (
  id               bigserial PRIMARY KEY,
  household_id     bigint NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  position         integer NOT NULL,
  code             text NOT NULL,
  name             text NOT NULL,
  power_w          real NOT NULL CHECK (power_w > 0),
  duration_min     integer NOT NULL CHECK (duration_min > 0),
  earliest         time,
  latest           time,
  preferred_start  time,
  priority         smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  allow_on_battery boolean NOT NULL DEFAULT true
);
CREATE INDEX appliances_household_idx ON appliances (household_id);

-- Графік відключень (наприклад, на конкретну дату або для своєї черги).
CREATE TABLE outage_schedules (
  id           bigserial PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name         text NOT NULL,
  day          date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outage_schedules_household_idx ON outage_schedules (household_id);

CREATE TABLE outage_intervals (
  id          bigserial PRIMARY KEY,
  schedule_id bigint NOT NULL REFERENCES outage_schedules (id) ON DELETE CASCADE,
  position    integer NOT NULL,
  starts_at   time NOT NULL,
  ends_at     time NOT NULL
);
CREATE INDEX outage_intervals_schedule_idx ON outage_intervals (schedule_id);

-- Історія планів: вхідні дані зберігаються знімком, щоб план можна було відтворити
-- навіть після зміни приладів.
CREATE TABLE plans (
  id            bigserial PRIMARY KEY,
  household_id  bigint NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  schedule_id   bigint REFERENCES outage_schedules (id) ON DELETE SET NULL,
  algorithm     text NOT NULL,
  input         jsonb NOT NULL,
  result        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plans_household_idx ON plans (household_id, created_at DESC);

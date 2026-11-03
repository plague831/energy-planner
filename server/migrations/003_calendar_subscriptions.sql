-- Підписки на календар (посилання .ics). Раніше зберігались у файлі server/data/calendars.json,
-- але на хостингу диск між перезапусками стирається, тож за наявності бази вони живуть тут.
-- Обліковий запис не потрібен: токен у посиланні знає лише власник.

CREATE TABLE calendar_subscriptions (
  token      text PRIMARY KEY,
  household  jsonb NOT NULL,
  choice     jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

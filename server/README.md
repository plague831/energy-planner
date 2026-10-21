# Сервер

Express 5 + PostgreSQL. Без бази даних працює тільки планування без входу (`/api/plan`); кабінет потребує `DATABASE_URL`.

## Запуск з базою даних

```bash
docker compose -f server/docker-compose.yml up -d   # PostgreSQL 16, бази planner і planner_test
cp server/.env.example server/.env
npm run dev:server                                   # міграції застосовуються при старті
```

Міграції лежать у `server/migrations/*.sql` і виконуються по черзі; застосовані записуються в таблицю `schema_migrations`. Окремо їх можна запустити командою `npm run migrate --workspace server`.

Тести кабінету йдуть на базі з `TEST_DATABASE_URL` (її схема очищається перед кожним запуском). Якщо змінну не задано, ці тести пропускаються.

## Схема бази

| Таблиця | Що зберігає |
|---|---|
| `users` | Користувачі: пошта, ім'я, хеш пароля (scrypt) |
| `sessions` | Сесії входу; у базі лише SHA-256 токена з cookie |
| `households` | Домогосподарства користувача, обмеження потужності мережі |
| `batteries` | Зарядна станція домогосподарства (не більше однієї) |
| `base_loads` | Постійні навантаження |
| `appliances` | Прилади, час роботи яких планується |
| `outage_schedules`, `outage_intervals` | Збережені графіки відключень та їхні інтервали |
| `plans` | Історія планів: знімок вхідних даних і результат |

## API

Усі запити й відповіді у JSON. Помилки мають вигляд `{ "error": "текст українською" }`.

### Без входу

| Метод | Адреса | Що робить |
|---|---|---|
| GET | `/api/health` | Перевірка стану |
| GET | `/api/algorithms` | Список методів `[{ id, name }]` |
| GET | `/api/defaults` | Демонстраційне домогосподарство, ваги, параметри невизначеності |
| POST | `/api/plan` | План для довільних даних `{ household, algorithm, uncertainty?, weights? }` |

### Обліковий запис

Вхід зберігається в cookie `sid` (httpOnly, 30 днів). Клієнт на тому ж домені нічого додатково робити не мусить; при `fetch` з іншого порту в розробці запити йдуть через проксі Vite, тож cookie теж працює.

| Метод | Адреса | Тіло | Відповідь |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password, name? }` (пароль від 8 символів) | `201 { user }`, `409` якщо пошта зайнята |
| POST | `/api/auth/login` | `{ email, password }` | `200 { user }`, `401` при невірних даних |
| POST | `/api/auth/logout` | | `204` |
| GET | `/api/auth/me` | | `200 { user }` або `401` |

`user` = `{ id, email, name, createdAt }`.

### Кабінет (потрібен вхід, інакше `401`)

Чужі записи для користувача не існують: на них приходить `404`.

**Домогосподарства.** Формат такий самий, як `household` у `/api/plan`, тільки без `outages` і з полями `id`, `name`, `updatedAt`:

```json
{
  "id": 1, "name": "Квартира", "updatedAt": "...",
  "grid": { "maxPowerW": 5000 },
  "battery": { "capacityWh": 1024, "initialSocPct": 70, "minSocPct": 10, "targetEndSocPct": 60, "maxChargeW": 600, "inverterMaxW": 1800 },
  "baseLoads": [{ "id": "fridge", "name": "Холодильник", "powerW": 60, "priority": 5, "from": "17:00", "to": "23:30" }],
  "appliances": [{ "id": "washer", "name": "Пральна машина", "powerW": 500, "durationMin": 90, "earliest": "07:00", "latest": "23:00", "preferredStart": "19:00", "priority": 3, "allowOnBattery": true }]
}
```

`battery` може бути `null`. Поля часу, яких немає, у відповіді відсутні.

| Метод | Адреса | Що робить |
|---|---|---|
| GET | `/api/households` | Список `[{ id, name, applianceCount, updatedAt }]` |
| POST | `/api/households` | Створити, відповідь `201` з повним об'єктом |
| GET | `/api/households/:id` | Повний об'єкт |
| PUT | `/api/households/:id` | Замінити повністю (форма редагує все разом) |
| DELETE | `/api/households/:id` | Видалити разом із графіками й планами, `204` |

Дані перевіряються тим самим кодом, що й у планувальнику, тож при помилці (`400`) текст той самий, що бачить користувач на сторінці плану.

**Графіки відключень.** `{ id, householdId, name, day, updatedAt, outages: [{ from, to }] }`, де `day` це дата `РРРР-ММ-ДД` або `null`.

| Метод | Адреса | Що робить |
|---|---|---|
| GET | `/api/households/:id/schedules` | Графіки домогосподарства (новіші дати першими) |
| POST | `/api/households/:id/schedules` | Створити `{ name, day?, outages }` |
| GET / PUT / DELETE | `/api/schedules/:id` | Прочитати, замінити, видалити |

**Плани.**

| Метод | Адреса | Що робить |
|---|---|---|
| POST | `/api/households/:id/plans` | Скласти й зберегти план. Тіло `{ scheduleId?, outages?, algorithm?, uncertainty?, weights? }`: відключення беруться зі збереженого графіка, а якщо `scheduleId` немає, то з `outages`. Відповідь `201` така сама, як у `/api/plan`, плюс `id`, `createdAt`, `scheduleId` |
| GET | `/api/households/:id/plans` | Історія (до 100): `[{ id, scheduleId, algorithm, algorithmName, createdAt, schedule, robustness }]` |
| GET | `/api/plans/:id` | Повний збережений план разом із `input` (знімок даних, з якими його складено) |
| DELETE | `/api/plans/:id` | Видалити, `204` |

Якщо графік видалити, збережені плани лишаються, у них просто `scheduleId: null`.

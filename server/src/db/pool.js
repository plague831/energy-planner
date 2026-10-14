import pg from 'pg';

// Дати (тип date) повертаємо рядком РРРР-ММ-ДД, без перетворення в часовий пояс сервера.
pg.types.setTypeParser(1082, (value) => value);

// Пул з'єднань з PostgreSQL. Рядок підключення береться з DATABASE_URL,
// наприклад postgres://planner:planner@localhost:5432/planner.
export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) return null;
  return new pg.Pool({ connectionString });
}

// Виконує fn усередині транзакції і повертає її результат.
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

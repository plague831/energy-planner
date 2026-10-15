import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;
const KEY_LENGTH = 64;

// Пароль зберігається як "scrypt$<сіль>$<хеш>", обидві частини в base64.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const expectedBuf = Buffer.from(expected, 'base64');
  const hash = await scrypt(password, Buffer.from(salt, 'base64'), expectedBuf.length);
  return timingSafeEqual(hash, expectedBuf);
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function destroySession(db, token) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function findSessionUser(db, token) {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.name, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ? publicUser(rows[0]) : null;
}

export function publicUser(row) {
  return { id: Number(row.id), email: row.email, name: row.name, createdAt: row.created_at };
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setSessionCookie(res, { token, expiresAt }) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Додає req.user, якщо в запиті є дійсна сесія.
export function loadUser(db) {
  return async (req, res, next) => {
    try {
      req.user = await findSessionUser(db, readCookie(req, SESSION_COOKIE));
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Потрібно увійти в обліковий запис' });
  next();
}

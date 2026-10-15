import { Router } from 'express';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  readCookie,
  publicUser,
  requireUser,
  SESSION_COOKIE,
} from '../auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export function authRouter(db) {
  const router = Router();

  router.post('/register', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const name = String(req.body?.name ?? '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Некоректна адреса електронної пошти' });
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Пароль має містити щонайменше ${MIN_PASSWORD} символів` });
    }
    const { rows } = await db.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING id, email, name, created_at`,
      [email, name, await hashPassword(password)],
    );
    if (!rows[0]) return res.status(409).json({ error: 'Користувач з такою поштою вже зареєстрований' });
    setSessionCookie(res, await createSession(db, rows[0].id));
    res.status(201).json({ user: publicUser(rows[0]) });
  });

  router.post('/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Невірна пошта або пароль' });
    }
    setSessionCookie(res, await createSession(db, rows[0].id));
    res.json({ user: publicUser(rows[0]) });
  });

  router.post('/logout', async (req, res) => {
    await destroySession(db, readCookie(req, SESSION_COOKIE));
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

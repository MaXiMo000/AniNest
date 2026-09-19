import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, SESSION_COOKIE, SESSION_MAX_AGE_MS,
} from '../lib/auth.js';

export const authRouter = Router();

const cookieOpts = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_MAX_AGE_MS,
});

const registerSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers, and underscores only.'),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Must include a letter and a number.'),
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
    }
    const { username, email, password } = parsed.data;

    const passwordHash = await hashPassword(password);

    let userId;
    try {
      const info = await db.execute({
        sql: 'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        args: [username, email, passwordHash],
      });
      userId = Number(info.lastInsertRowid);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'That username or email is already registered.' });
      }
      throw err;
    }

    const { token } = await createSession(userId);
    res.cookie(SESSION_COOKIE, token, cookieOpts());
    const created = await db.execute({ sql: 'SELECT created_at FROM users WHERE id = ?', args: [userId] });
    res.status(201).json({ user: { id: userId, username, email, createdAt: created.rows[0].created_at } });
  } catch (err) { next(err); }
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input.' });
    const { identifier, password } = parsed.data;

    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ? OR username = ?',
      args: [identifier.toLowerCase(), identifier],
    });
    const user = result.rows[0];

    // Same generic message whether the account doesn't exist or the password
    // is wrong, and we always run bcrypt.compare (against a dummy hash if no
    // user was found) so response timing doesn't reveal which case it was.
    const dummyHash = '$2a$12$C6UzMDM.H6dfI/f/IKcEeOoRTvVCjMxNzO7RCUEuHpB7Zr8/2ZLBW';
    const ok = await verifyPassword(password, user?.password_hash || dummyHash);
    if (!user || !ok) return res.status(401).json({ error: 'Invalid username/email or password.' });

    const userId = Number(user.id);
    const { token } = await createSession(userId);
    res.cookie(SESSION_COOKIE, token, cookieOpts());
    res.json({ user: { id: userId, username: user.username, email: user.email, createdAt: user.created_at } });
  } catch (err) { next(err); }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  } catch (err) { next(err); }
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

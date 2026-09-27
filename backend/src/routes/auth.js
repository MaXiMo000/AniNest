import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, destroyOtherSessions, destroyAllSessionsForUser,
  setPassword, createPasswordReset, consumePasswordReset, SESSION_COOKIE, SESSION_MAX_AGE_MS,
} from '../lib/auth.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { requireAuth } from '../middleware/session.js';
import { exportUserData, deleteUserData } from '../lib/account.js';
import { isMailEnabled, sendMail } from '../lib/mailer.js';

export const authRouter = Router();

const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = () => ({
  httpOnly: true,
  // First-party in production (the frontend proxies /api/*, see render.yaml),
  // so Lax is enough and keeps the session off every cross-site request.
  // Same reasoning as the CSRF cookie in middleware/csrf.js.
  secure: isProd,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_MAX_AGE_MS,
});

const passwordField = z.string().min(8).max(200).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Must include a letter and a number.');

const registerSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers, and underscores only.'),
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordField,
  turnstileToken: z.string().max(4000).optional(),
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
    }
    const { username, email, password, turnstileToken } = parsed.data;

    const humanCheck = await verifyTurnstile(turnstileToken, req.ip);
    if (!humanCheck) return res.status(400).json({ error: 'Bot check failed — please try again.' });

    const taken = await db.execute({ sql: 'SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', args: [username] });
    if (taken.rows.length) return res.status(409).json({ error: 'That username or email is already registered.' });

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
    res.status(201).json({ user: { id: userId, username, email, createdAt: created.rows[0].created_at, isAdmin: false } });
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
      // Usernames log in with any capitalisation; the exact spelling wins if
      // two look-alike accounts predate case-insensitive usernames.
      sql: 'SELECT * FROM users WHERE email = ? OR username = ? COLLATE NOCASE ORDER BY username = ? DESC LIMIT 1',
      args: [identifier.toLowerCase(), identifier, identifier],
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
    res.json({
      user: {
        id: userId, username: user.username, email: user.email, createdAt: user.created_at,
        isAdmin: Boolean(Number(user.is_admin)),
      },
    });
  } catch (err) { next(err); }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' });
    res.status(204).end();
  } catch (err) { next(err); }
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

async function passwordMatches(userId, plain) {
  const row = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [userId] });
  return Boolean(row.rows[0]) && verifyPassword(plain, row.rows[0].password_hash);
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordField,
});

// Signs out every other device too: a password change is usually because
// someone else might know the old one.
authRouter.post('/password', requireAuth, async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
    if (!(await passwordMatches(req.user.id, parsed.data.currentPassword))) {
      return res.status(401).json({ error: 'Your current password is wrong.' });
    }
    await setPassword(req.user.id, parsed.data.newPassword);
    await destroyOtherSessions(req.user.id, req.cookies?.[SESSION_COOKIE]);
    res.status(204).end();
  } catch (err) { next(err); }
});

authRouter.post('/logout-others', requireAuth, async (req, res, next) => {
  try {
    await destroyOtherSessions(req.user.id, req.cookies?.[SESSION_COOKIE]);
    res.status(204).end();
  } catch (err) { next(err); }
});

authRouter.get('/export', requireAuth, async (req, res, next) => {
  try {
    const data = await exportUserData(req.user.id);
    res.set('Content-Disposition', `attachment; filename="aninest-${req.user.username}.json"`);
    res.json(data);
  } catch (err) { next(err); }
});

const deleteSchema = z.object({ password: z.string().min(1).max(200) });

authRouter.post('/delete-account', requireAuth, async (req, res, next) => {
  try {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter your password to confirm.' });
    if (!(await passwordMatches(req.user.id, parsed.data.password))) {
      return res.status(401).json({ error: 'That password is wrong.' });
    }
    await deleteUserData(req.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' });
    res.status(204).end();
  } catch (err) { next(err); }
});

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

// Same answer whether or not the email has an account, so this can't be
// used to find out who is registered.
authRouter.post('/forgot', async (req, res, next) => {
  try {
    if (!isMailEnabled()) return res.status(503).json({ error: 'Password reset by email isn’t set up on this site yet.' });
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter the email you signed up with.' });
    const found = await db.execute({ sql: 'SELECT id, username FROM users WHERE email = ?', args: [parsed.data.email] });
    const user = found.rows[0];
    if (user) {
      const token = await createPasswordReset(Number(user.id));
      const origin = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
      await sendMail({
        to: parsed.data.email,
        subject: 'Reset your AniNest password',
        text: `Hi ${user.username},\n\nReset your AniNest password here (the link works once, for 30 minutes):\n${origin}/#/reset-password?token=${token}\n\nIf you didn't ask for this, ignore this email and nothing changes.`,
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const resetSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  password: passwordField,
});

authRouter.post('/reset', async (req, res, next) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.path[0] === 'password' ? parsed.error.issues[0].message : 'That reset link is invalid.' });
    const userId = await consumePasswordReset(parsed.data.token);
    if (!userId) return res.status(400).json({ error: 'That reset link is invalid or has expired. Ask for a new one.' });
    await setPassword(userId, parsed.data.password);
    await destroyAllSessionsForUser(userId);
    res.status(204).end();
  } catch (err) { next(err); }
});

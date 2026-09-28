import crypto from 'node:crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { db } from '../lib/db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, destroyOtherSessions, destroyAllSessionsForUser,
  setPassword, createPasswordReset, consumePasswordReset, consumeEmailVerification, SESSION_COOKIE, SESSION_MAX_AGE_MS,
} from '../lib/auth.js';
import {
  sendVerificationEmail, sendPasswordChangedEmail, sendSecurityNotice, noteSignIn, passwordResetEmail, DEVICE_COOKIE,
} from '../lib/accountMail.js';
import {
  verifyTotp, newSecret, otpauthUri, encryptSecret, decryptSecret, totpAvailable, newRecoveryCodes, hashRecoveryCode,
} from '../lib/totp.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { requireAuth } from '../middleware/session.js';
import { exportUserData, deleteUserData } from '../lib/account.js';
import { isMailEnabled, sendMail } from '../lib/mailer.js';
import { throttleKey, lockedFor, recordFailure, clearFailures } from '../lib/loginThrottle.js';

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

const DEVICE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

// Remembers this browser for the account (lib/accountMail.js emails the
// owner about sign-ins from new ones) and keeps its device cookie fresh.
async function rememberDevice(req, res, user) {
  const device = await noteSignIn(user, { deviceCookie: req.cookies?.[DEVICE_COOKIE], userAgent: req.get('user-agent'), ip: req.ip });
  res.cookie(DEVICE_COOKIE, device, { ...cookieOpts(), maxAge: DEVICE_MAX_AGE_MS });
}

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
    await rememberDevice(req, res, { id: userId });
    sendVerificationEmail({ id: userId, username, email });
    const created = await db.execute({ sql: 'SELECT created_at FROM users WHERE id = ?', args: [userId] });
    res.status(201).json({ user: { id: userId, username, email, createdAt: created.rows[0].created_at, isAdmin: false, isPrivate: false, emailVerified: false } });
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

    const key = throttleKey(user, identifier);
    const wait = await lockedFor(key);
    if (wait) {
      const minutes = Math.ceil(wait / 60000);
      return res.status(429).json({ error: `Too many wrong passwords for this account. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.` });
    }

    // Same generic message whether the account doesn't exist or the password
    // is wrong, and we always run bcrypt.compare (against a dummy hash if no
    // user was found) so response timing doesn't reveal which case it was.
    const dummyHash = '$2a$12$C6UzMDM.H6dfI/f/IKcEeOoRTvVCjMxNzO7RCUEuHpB7Zr8/2ZLBW';
    const ok = await verifyPassword(password, user?.password_hash || dummyHash);
    if (!user || !ok) {
      await recordFailure(key);
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }
    // With two-factor login on, the password only earns a short-lived ticket
    // for the code step. The failure count isn't cleared yet: wrong codes
    // count toward the same lock as wrong passwords.
    if (Number(user.totp_enabled)) {
      return res.json({ twoFactor: true, ticket: await createLoginChallenge(Number(user.id)) });
    }
    await clearFailures(key);
    await finishSignIn(req, res, user);
  } catch (err) { next(err); }
});

async function finishSignIn(req, res, user) {
  const userId = Number(user.id);
  const { token } = await createSession(userId);
  res.cookie(SESSION_COOKIE, token, cookieOpts());
  await rememberDevice(req, res, { id: userId });
  res.json({
    user: {
      id: userId, username: user.username, email: user.email, createdAt: user.created_at,
      isAdmin: Boolean(Number(user.is_admin)), isPrivate: Boolean(Number(user.is_private)),
      emailVerified: Boolean(Number(user.email_verified)),
    },
  });
}

// ---- Two-factor login ----

const CHALLENGE_MS = 5 * 60 * 1000;
const CHALLENGE_TRIES = 5;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

async function createLoginChallenge(userId) {
  const ticket = crypto.randomBytes(32).toString('hex');
  await db.batch([
    { sql: 'DELETE FROM login_challenges WHERE user_id = ? OR expires_at < ?', args: [userId, Date.now()] },
    { sql: 'INSERT INTO login_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)', args: [sha256(ticket), userId, Date.now() + CHALLENGE_MS] },
  ], 'write');
  return ticket;
}

// A 6-digit code from the app (each usable once), or one of the recovery
// codes (burned on use). Returns true when it checks out.
async function checkSecondFactor(user, code) {
  const clean = String(code || '').trim();
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decryptSecret(user.totp_secret), clean, { lastStep: Number(user.totp_last_step) });
    if (step == null) return false;
    // Guarded so two requests racing with the same code can't both win.
    const res = await db.execute({
      sql: 'UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?',
      args: [step, user.id, step],
    });
    return res.rowsAffected === 1;
  }
  const res = await db.execute({
    sql: 'DELETE FROM totp_recovery_codes WHERE user_id = ? AND code_hash = ?',
    args: [user.id, hashRecoveryCode(clean)],
  });
  return res.rowsAffected === 1;
}

const secondStepSchema = z.object({
  ticket: z.string().regex(/^[0-9a-f]{64}$/),
  code: z.string().trim().min(6).max(20),
});

authRouter.post('/login/2fa', async (req, res, next) => {
  try {
    const parsed = secondStepSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter the 6-digit code from your app, or a recovery code.' });
    const found = await db.execute({ sql: 'SELECT user_id, expires_at, attempts FROM login_challenges WHERE token_hash = ?', args: [sha256(parsed.data.ticket)] });
    const challenge = found.rows[0];
    if (!challenge || Number(challenge.expires_at) < Date.now() || Number(challenge.attempts) >= CHALLENGE_TRIES) {
      return res.status(401).json({ error: 'That sign-in timed out. Log in again.', restart: true });
    }
    await db.execute({ sql: 'UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?', args: [sha256(parsed.data.ticket)] });
    const user = (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [challenge.user_id] })).rows[0];
    const key = throttleKey(user, '');
    if (await lockedFor(key)) return res.status(429).json({ error: 'Too many wrong tries for this account. Try again in a few minutes.', restart: true });
    if (!user || !Number(user.totp_enabled) || !(await checkSecondFactor(user, parsed.data.code))) {
      await recordFailure(key);
      return res.status(401).json({ error: 'That code didn’t work. Check your app’s clock and try the newest code.' });
    }
    await db.execute({ sql: 'DELETE FROM login_challenges WHERE user_id = ?', args: [user.id] });
    await clearFailures(key);
    await finishSignIn(req, res, user);
  } catch (err) { next(err); }
});

// Status, setup (password first), turning it on with a first code, turning it
// off (password and a code), and fresh recovery codes (a code).
authRouter.get('/2fa', requireAuth, async (req, res, next) => {
  try {
    const row = (await db.execute({
      sql: 'SELECT totp_enabled, (SELECT COUNT(*) FROM totp_recovery_codes WHERE user_id = users.id) AS codes FROM users WHERE id = ?',
      args: [req.user.id],
    })).rows[0];
    res.json({ available: totpAvailable(), enabled: Boolean(Number(row.totp_enabled)), recoveryCodesLeft: Number(row.codes) });
  } catch (err) { next(err); }
});

const passwordOnly = z.object({ password: z.string().min(1).max(200) });
const codeOnly = z.object({ code: z.string().trim().min(6).max(20) });

authRouter.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    if (!totpAvailable()) return res.status(503).json({ error: 'Two-factor login isn’t set up on this site yet.' });
    const parsed = passwordOnly.safeParse(req.body);
    if (!parsed.success || !(await passwordMatches(req.user.id, parsed.data.password))) {
      return res.status(401).json({ error: 'That password is wrong.' });
    }
    const current = (await db.execute({ sql: 'SELECT totp_enabled FROM users WHERE id = ?', args: [req.user.id] })).rows[0];
    if (Number(current.totp_enabled)) return res.status(409).json({ error: 'Two-factor login is already on.' });
    const secret = newSecret();
    await db.execute({ sql: 'UPDATE users SET totp_secret = ?, totp_last_step = -1 WHERE id = ?', args: [encryptSecret(secret), req.user.id] });
    const uri = otpauthUri(secret, req.user.username);
    res.json({ secret, uri, qr: await QRCode.toString(uri, { type: 'svg', margin: 1 }) });
  } catch (err) { next(err); }
});

authRouter.post('/2fa/enable', requireAuth, async (req, res, next) => {
  try {
    const parsed = codeOnly.safeParse(req.body);
    const user = (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.user.id] })).rows[0];
    if (Number(user.totp_enabled)) return res.status(409).json({ error: 'Two-factor login is already on.' });
    if (!user.totp_secret) return res.status(409).json({ error: 'Start the setup again.' });
    const step = parsed.success && verifyTotp(decryptSecret(user.totp_secret), parsed.data.code);
    if (step == null || step === false) return res.status(400).json({ error: 'That code didn’t match. Type the newest code from your app.' });
    const codes = newRecoveryCodes();
    await db.batch([
      { sql: 'UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', args: [step, req.user.id] },
      { sql: 'DELETE FROM totp_recovery_codes WHERE user_id = ?', args: [req.user.id] },
      ...codes.map((c) => ({ sql: 'INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES (?, ?)', args: [req.user.id, hashRecoveryCode(c)] })),
    ], 'write');
    sendSecurityNotice(req.user.id, 'Two-factor login is on for your AniNest account', 'Two-factor login was turned on for your AniNest account');
    res.json({ recoveryCodes: codes });
  } catch (err) { next(err); }
});

const disableSchema = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(20) });

authRouter.post('/2fa/disable', requireAuth, async (req, res, next) => {
  try {
    const parsed = disableSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter your password and a code.' });
    const user = (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.user.id] })).rows[0];
    if (!Number(user.totp_enabled)) return res.status(409).json({ error: 'Two-factor login is already off.' });
    if (!(await passwordMatches(req.user.id, parsed.data.password)) || !(await checkSecondFactor(user, parsed.data.code))) {
      return res.status(401).json({ error: 'The password or the code is wrong.' });
    }
    await db.batch([
      { sql: 'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = -1 WHERE id = ?', args: [req.user.id] },
      { sql: 'DELETE FROM totp_recovery_codes WHERE user_id = ?', args: [req.user.id] },
    ], 'write');
    sendSecurityNotice(req.user.id, 'Two-factor login is off for your AniNest account', 'Two-factor login was turned off for your AniNest account');
    res.status(204).end();
  } catch (err) { next(err); }
});

authRouter.post('/2fa/recovery-codes', requireAuth, async (req, res, next) => {
  try {
    const parsed = codeOnly.safeParse(req.body);
    const user = (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.user.id] })).rows[0];
    if (!Number(user.totp_enabled)) return res.status(409).json({ error: 'Turn on two-factor login first.' });
    if (!parsed.success || !(await checkSecondFactor(user, parsed.data.code))) return res.status(401).json({ error: 'That code didn’t work.' });
    const codes = newRecoveryCodes();
    await db.batch([
      { sql: 'DELETE FROM totp_recovery_codes WHERE user_id = ?', args: [req.user.id] },
      ...codes.map((c) => ({ sql: 'INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES (?, ?)', args: [req.user.id, hashRecoveryCode(c)] })),
    ], 'write');
    res.json({ recoveryCodes: codes });
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

// The emailed link (#/verify-email?token=) works signed in or out: the token
// is the proof, and all it can do is mark that one address as confirmed.
authRouter.post('/verify-email', async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' && /^[0-9a-f]{64}$/.test(req.body.token) ? req.body.token : null;
    const userId = token && await consumeEmailVerification(token);
    if (!userId) return res.status(400).json({ error: 'That link is invalid or has expired. Send a new one from your account page.' });
    await db.execute({ sql: 'UPDATE users SET email_verified = 1 WHERE id = ?', args: [userId] });
    res.status(204).end();
  } catch (err) { next(err); }
});

authRouter.post('/verify-email/resend', requireAuth, async (req, res, next) => {
  try {
    if (!isMailEnabled()) return res.status(503).json({ error: 'Email isn’t set up on this site yet.' });
    if (req.user.emailVerified) return res.status(409).json({ error: 'Your email is already confirmed.' });
    sendVerificationEmail(req.user);
    res.status(204).end();
  } catch (err) { next(err); }
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
    sendPasswordChangedEmail(req.user.id);
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
      // In the background: waiting on the mail server only when the account
      // exists would make registered emails answer noticeably slower.
      createPasswordReset(Number(user.id))
        .then((token) => sendMail({ to: parsed.data.email, ...passwordResetEmail(user.username, token) }))
        .catch((err) => req.log.error({ err }, 'password reset email failed'));
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
    // The lockout message points people here, so a reset has to lift it.
    await clearFailures(throttleKey({ id: userId }));
    sendPasswordChangedEmail(userId);
    res.status(204).end();
  } catch (err) { next(err); }
});

const privacySchema = z.object({ private: z.boolean() });

authRouter.post('/privacy', requireAuth, async (req, res, next) => {
  try {
    const parsed = privacySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input.' });
    await db.execute({ sql: 'UPDATE users SET is_private = ? WHERE id = ?', args: [parsed.data.private ? 1 : 0, req.user.id] });
    res.json({ isPrivate: parsed.data.private });
  } catch (err) { next(err); }
});

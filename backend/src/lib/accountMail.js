import crypto from 'node:crypto';
import { db } from './db.js';
import { logger } from './logger.js';
import { isMailEnabled, sendMail } from './mailer.js';
import { createEmailVerification } from './auth.js';

// Account emails: the verification link, and security alerts (password
// changed, sign-in from a new device). All sent in the background: a slow
// or failing mail server must never hold up or break signing in. Alerts only
// go to verified addresses, so a typo'd or borrowed email at sign-up can't
// be used to send mail to someone who never asked for it.

const origin = () => (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
const background = (label, fn) => {
  if (!isMailEnabled()) return;
  fn().catch((err) => logger.error({ err, label }, 'account email failed'));
};

export function sendVerificationEmail(user) {
  background('verify', async () => {
    const token = await createEmailVerification(user.id);
    await sendMail({
      to: user.email,
      subject: 'Confirm your AniNest email',
      text: `Hi ${user.username},\n\nConfirm this is your email by opening this link (it works once, for 2 days):\n${origin()}/#/verify-email?token=${token}\n\nIf you didn't make an AniNest account, ignore this email.`,
    });
  });
}

async function verifiedEmail(userId) {
  const row = (await db.execute({ sql: 'SELECT username, email, email_verified FROM users WHERE id = ?', args: [userId] })).rows[0];
  return row && Number(row.email_verified) ? row : null;
}

const when = () => `${new Date().toUTCString().replace('GMT', 'UTC')}`;
const help = () => `If this wasn't you, reset your password now: ${origin()}/#/forgot-password\nThen use "Log out other devices" on your account page.`;

export function sendPasswordChangedEmail(userId) {
  background('password-changed', async () => {
    const u = await verifiedEmail(userId);
    if (!u) return;
    await sendMail({
      to: u.email,
      subject: 'Your AniNest password was changed',
      text: `Hi ${u.username},\n\nThe password for your AniNest account was changed on ${when()}.\n\nIf that was you, there's nothing to do.\n${help()}`,
    });
  });
}

// "Chrome on Windows" from a User-Agent, or a plain fallback. Only for the
// email text; nothing depends on it.
export function describeDevice(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

export const DEVICE_COOKIE = 'aninest_device';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Called after a successful sign-in (or sign-up). Remembers this browser for
// the account and returns the device cookie value to (re)set. Emails the
// owner when a browser they haven't used before signs in, except for the
// very first one we see (sign-up, or accounts from before this existed), so
// nobody gets an alert for their own usual device.
export async function noteSignIn(user, { deviceCookie, userAgent, ip }) {
  const device = /^[0-9a-f]{64}$/.test(deviceCookie || '') ? deviceCookie : crypto.randomBytes(32).toString('hex');
  const deviceHash = hash(device);
  const [known, count] = await Promise.all([
    db.execute({ sql: 'SELECT 1 FROM known_devices WHERE user_id = ? AND device_hash = ?', args: [user.id, deviceHash] }),
    db.execute({ sql: 'SELECT COUNT(*) AS n FROM known_devices WHERE user_id = ?', args: [user.id] }),
  ]);
  await db.execute({
    sql: `INSERT INTO known_devices (user_id, device_hash) VALUES (?, ?)
          ON CONFLICT(user_id, device_hash) DO UPDATE SET last_seen = datetime('now')`,
    args: [user.id, deviceHash],
  });
  if (!known.rows.length && Number(count.rows[0].n) > 0) {
    background('new-device', async () => {
      const u = await verifiedEmail(user.id);
      if (!u) return;
      await sendMail({
        to: u.email,
        subject: 'New sign-in to your AniNest account',
        text: `Hi ${u.username},\n\nYour AniNest account was just signed in from a device we haven't seen before:\n\n  ${describeDevice(userAgent)}\n  ${when()}${ip ? `\n  IP address ${ip}` : ''}\n\nIf that was you, there's nothing to do.\n${help()}`,
      });
    });
  }
  return device;
}

import crypto from 'node:crypto';
import { db } from './db.js';
import { logger } from './logger.js';
import { isMailEnabled, sendMail } from './mailer.js';
import { createEmailVerification } from './auth.js';
import { renderEmail } from './emailTemplate.js';

// Account emails: the verification link, and security alerts (password
// changed, sign-in from a new device). All sent in the background: a slow
// or failing mail server must never hold up or break signing in. Alerts only
// go to verified addresses, so a typo'd or borrowed email at sign-up can't
// be used to send mail to someone who never asked for it.

const origin = () => (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
const footer = (why) => ({
  footer: [why, 'AniNest, your anime and manga home base.'],
  footerLinks: [{ label: 'Open AniNest', url: `${origin()}/#/` }, { label: 'Account settings', url: `${origin()}/#/account` }],
});
const when = () => new Date().toUTCString().replace('GMT', 'UTC');

// The password reset email (routes/auth.js sends it).
export function passwordResetEmail(username, token) {
  const url = `${origin()}/#/reset-password?token=${token}`;
  return {
    subject: 'Reset your AniNest password',
    ...renderEmail({
      preheader: 'Choose a new password. The link works for 30 minutes.',
      heading: 'Reset your password',
      greeting: `Hi ${username},`,
      paragraphs: ['Someone (hopefully you) asked to reset the password for your AniNest account. Choose a new one with the button below.'],
      button: { label: 'Choose a new password', url },
      note: 'The link works once, for 30 minutes. If you didn’t ask for this, ignore this email: your password stays the same.',
      ...footer('You got this because a password reset was requested for your AniNest account.'),
    }),
  };
}
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
      ...renderEmail({
        preheader: 'One click and you’re all set.',
        heading: 'Confirm your email',
        greeting: `Welcome to AniNest, ${user.username}!`,
        paragraphs: ['Confirm this is your email address. It turns on the weekly email and lets us warn you about new sign-ins and password changes.'],
        button: { label: 'Confirm my email', url: `${origin()}/#/verify-email?token=${token}` },
        note: 'The link works once, for 2 days. If you didn’t make an AniNest account, you can ignore this email.',
        ...footer('You got this because this address was used to sign up for AniNest.'),
      }),
    });
  });
}

async function verifiedEmail(userId) {
  const row = (await db.execute({ sql: 'SELECT username, email, email_verified FROM users WHERE id = ?', args: [userId] })).rows[0];
  return row && Number(row.email_verified) ? row : null;
}

// The "if this wasn't you" part every security email ends with.
const notYou = {
  button: { label: 'This wasn’t me: reset my password', url: `${origin()}/#/forgot-password` },
  note: 'If that was you, there’s nothing to do. If it wasn’t, reset your password, then use “Log out other devices” on your account page.',
};

// A short "this changed on your account" email to a confirmed address.
export function sendSecurityNotice(userId, subject, what) {
  background(subject, async () => {
    const u = await verifiedEmail(userId);
    if (!u) return;
    await sendMail({
      to: u.email,
      subject,
      ...renderEmail({
        preheader: `${what}.`,
        heading: subject.replace(/ for your AniNest account$| on your AniNest account$/, ''),
        greeting: `Hi ${u.username},`,
        paragraphs: [`${what}.`],
        details: [{ label: 'When', value: when() }],
        ...notYou,
        ...footer('You got this because something changed on your AniNest account.'),
      }),
    });
  });
}

export const sendPasswordChangedEmail = (userId) => sendSecurityNotice(userId, 'Your AniNest password was changed', 'The password for your AniNest account was changed');

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
        ...renderEmail({
          preheader: `Signed in from ${describeDevice(userAgent)}.`,
          heading: 'New sign-in to your account',
          greeting: `Hi ${u.username},`,
          paragraphs: ['Your AniNest account was just signed in from a device we haven’t seen before.'],
          details: [
            { label: 'Device', value: describeDevice(userAgent) },
            { label: 'When', value: when() },
            ...(ip ? [{ label: 'IP address', value: ip }] : []),
          ],
          ...notYou,
          ...footer('You got this because of a sign-in to your AniNest account.'),
        }),
      });
    });
  }
  return device;
}

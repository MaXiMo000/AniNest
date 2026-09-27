import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Session tokens are opaque random values handed to the client as a cookie.
// We never store the raw token server-side — only its SHA-256 hash — so a
// leaked/dumped database row can't be replayed as a live session cookie.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.execute({
    sql: 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    args: [tokenHash, userId, expiresAt],
  });
  return { token, expiresAt };
}

export async function destroySession(token) {
  if (!token) return;
  await db.execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [hashToken(token)] });
}

export async function destroyAllSessionsForUser(userId) {
  await db.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [userId] });
}

// "Log out everywhere else": every session but the one making the request.
export async function destroyOtherSessions(userId, keepToken) {
  await db.execute({
    sql: 'DELETE FROM sessions WHERE user_id = ? AND token_hash != ?',
    args: [userId, hashToken(keepToken || '')],
  });
}

export async function setPassword(userId, plain) {
  await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [await hashPassword(plain), userId] });
}

// Single-use tokens for emailed links: password resets (30 minutes) and
// email verification (2 days). Only the hash is stored, and asking again
// replaces any earlier link, so only the newest email works.
const EMAIL_TOKENS = {
  password_resets: 30 * 60 * 1000,
  email_verifications: 2 * 24 * 60 * 60 * 1000,
};

async function createEmailToken(table, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.batch([
    { sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [userId] },
    {
      sql: `INSERT INTO ${table} (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
      args: [hashToken(token), userId, new Date(Date.now() + EMAIL_TOKENS[table]).toISOString()],
    },
  ], 'write');
  return token;
}

// Returns the user id and burns the token, or null for an unknown, used or
// expired one.
async function consumeEmailToken(table, token) {
  const res = await db.execute({
    sql: `DELETE FROM ${table} WHERE token_hash = ? RETURNING user_id, expires_at`,
    args: [hashToken(token)],
  });
  const row = res.rows[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return Number(row.user_id);
}

export const createPasswordReset = (userId) => createEmailToken('password_resets', userId);
export const consumePasswordReset = (token) => consumeEmailToken('password_resets', token);
export const createEmailVerification = (userId) => createEmailToken('email_verifications', userId);
export const consumeEmailVerification = (token) => consumeEmailToken('email_verifications', token);

export async function getUserForToken(token) {
  if (!token) return null;
  const result = await db.execute({
    sql: `
      SELECT s.expires_at, u.id, u.username, u.email, u.created_at, u.is_admin, u.is_private, u.email_verified
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `,
    args: [hashToken(token)],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [hashToken(token)] });
    return null;
  }
  return {
    id: Number(row.id), username: row.username, email: row.email, createdAt: row.created_at,
    isAdmin: Boolean(Number(row.is_admin)), isPrivate: Boolean(Number(row.is_private)),
    emailVerified: Boolean(Number(row.email_verified)),
  };
}

export async function pruneExpiredSessions() {
  await db.execute("DELETE FROM sessions WHERE expires_at < datetime('now')");
}

export const SESSION_COOKIE = 'aninest_sid';
export const SESSION_MAX_AGE_MS = SESSION_TTL_MS;

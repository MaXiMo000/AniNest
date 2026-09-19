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

export async function getUserForToken(token) {
  if (!token) return null;
  const result = await db.execute({
    sql: `
      SELECT s.expires_at, u.id, u.username, u.email, u.created_at
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
  return { id: Number(row.id), username: row.username, email: row.email, createdAt: row.created_at };
}

export async function pruneExpiredSessions() {
  await db.execute("DELETE FROM sessions WHERE expires_at < datetime('now')");
}

export const SESSION_COOKIE = 'aninest_sid';
export const SESSION_MAX_AGE_MS = SESSION_TTL_MS;

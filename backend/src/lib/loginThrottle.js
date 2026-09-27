import { db } from './db.js';

// Per-account brute-force brake, on top of the per-IP authLimiter: someone
// rotating IPs can still only try MAX_FAILURES passwords against one account
// per LOCK_MS. Unknown usernames/emails are throttled exactly the same way,
// so the lockout doesn't reveal which accounts exist.
const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES) || 10;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

export function throttleKey(user, identifier) {
  return user ? `id:${Number(user.id)}` : `name:${identifier.toLowerCase()}`;
}

// Milliseconds until this account can try again, or 0.
export async function lockedFor(key) {
  const res = await db.execute({ sql: 'SELECT locked_until FROM login_failures WHERE key = ?', args: [key] });
  const until = Number(res.rows[0]?.locked_until || 0);
  return Math.max(0, until - Date.now());
}

export async function recordFailure(key) {
  const now = Date.now();
  // A failure older than the window starts a fresh count.
  await db.execute({
    sql: `INSERT INTO login_failures (key, failures, first_failed_at, locked_until) VALUES (?, 1, ?, 0)
          ON CONFLICT(key) DO UPDATE SET
            failures = CASE WHEN first_failed_at < ? THEN 1 ELSE failures + 1 END,
            first_failed_at = CASE WHEN first_failed_at < ? THEN excluded.first_failed_at ELSE first_failed_at END`,
    args: [key, now, now - WINDOW_MS, now - WINDOW_MS],
  });
  await db.execute({
    sql: 'UPDATE login_failures SET locked_until = ?, failures = 0 WHERE key = ? AND failures >= ?',
    args: [now + LOCK_MS, key, MAX_FAILURES],
  });
}

export async function clearFailures(key) {
  await db.execute({ sql: 'DELETE FROM login_failures WHERE key = ?', args: [key] });
}

export async function pruneLoginFailures() {
  const cutoff = Date.now() - Math.max(WINDOW_MS, LOCK_MS);
  await db.execute({ sql: 'DELETE FROM login_failures WHERE first_failed_at < ? AND locked_until < ?', args: [cutoff, Date.now()] });
}

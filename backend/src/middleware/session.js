import { getUserForToken, SESSION_COOKIE } from '../lib/auth.js';

// Attaches req.user (or null) on every request based on the session cookie.
// Does not reject unauthenticated requests — that's requireAuth's job — so
// public routes can still optionally know "is someone logged in".
export async function attachUser(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    req.user = (await getUserForToken(token)) || null;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  next();
}

// A 404 (not a 403) for a non-admin is deliberate — it doesn't confirm to a
// logged-in-but-not-admin user that these admin routes exist at all, same
// spirit as not leaking whether a username exists on login.
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (!req.user.isAdmin) return res.status(404).json({ error: 'Not found.' });
  next();
}

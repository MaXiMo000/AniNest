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

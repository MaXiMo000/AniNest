import { Router } from 'express';
import { db } from '../lib/db.js';
import { xpForUser } from '../lib/xpStats.js';

export const usersRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Same shape the registration form enforces (auth.js) — anything else can't
// possibly be a real username, so we 404 without touching the database.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function parseGenres(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((g) => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

// Public, unauthenticated: only non-sensitive fields ever leave this route
// (username, join date, favorites, reviews) — never email or password_hash.
usersRouter.get('/:username', asyncRoute(async (req, res) => {
  const { username } = req.params;
  if (!USERNAME_RE.test(username)) return res.status(404).json({ error: 'User not found.' });

  const userResult = await db.execute({
    sql: 'SELECT id, username, created_at FROM users WHERE username = ?',
    args: [username],
  });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const mangaReviewsResult = await db.execute({
    sql: 'SELECT manga_id, rating, body, created_at, updated_at FROM manga_reviews WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100',
    args: [user.id],
  });

  const [favoritesResult, reviewsResult, xp] = await Promise.all([
    db.execute({
      sql: 'SELECT mal_id, title, image, score, type, status, genres, episodes, episodes_watched, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC LIMIT 200',
      args: [user.id],
    }),
    db.execute({
      sql: 'SELECT mal_id, rating, body, created_at, updated_at FROM reviews WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100',
      args: [user.id],
    }),
    // Derived, not stored - see lib/xp.js. Same computation the XP
    // leaderboard uses, and the badges come out of it too, so a profile's
    // badges and its XP can never disagree.
    xpForUser(user.id),
  ]);

  const { badges = [], ...xpSummary } = xp || {};

  res.json({
    user: { username: user.username, createdAt: user.created_at },
    favorites: favoritesResult.rows.map(({ genres, ...row }) => ({ ...row, genres: parseGenres(genres) })),
    reviews: reviewsResult.rows,
    mangaReviews: mangaReviewsResult.rows,
    badges,
    xp: xp ? xpSummary : null,
  });
}));

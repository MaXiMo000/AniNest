import { Router } from 'express';
import { db } from '../lib/db.js';
import { computeBadges } from '../lib/badges.js';
import { xpForUser } from '../lib/xpStats.js';

export const usersRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Same shape the registration form enforces (auth.js) — anything else can't
// possibly be a real username, so we 404 without touching the database.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

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

  const [favoritesResult, reviewsResult, favoritesCountResult, reviewsCountResult, completedCountResult, streakResult] = await Promise.all([
    db.execute({
      sql: 'SELECT mal_id, title, image, score, type, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC LIMIT 200',
      args: [user.id],
    }),
    db.execute({
      sql: 'SELECT mal_id, rating, body, created_at, updated_at FROM reviews WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100',
      args: [user.id],
    }),
    // Separate COUNT queries rather than trusting the LIMIT 200/100 rows
    // above - a badge threshold has to reflect the true total, not just
    // however many rows this response happens to also be returning.
    db.execute({ sql: 'SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?', args: [user.id] }),
    db.execute({ sql: 'SELECT (SELECT COUNT(*) FROM reviews WHERE user_id = ?) + (SELECT COUNT(*) FROM manga_reviews WHERE user_id = ?) AS count', args: [user.id, user.id] }),
    db.execute({ sql: "SELECT COUNT(*) AS count FROM favorites WHERE user_id = ? AND status = 'completed'", args: [user.id] }),
    db.execute({ sql: 'SELECT MAX(best_streak) AS best FROM game_scores WHERE user_id = ?', args: [user.id] }),
  ]);

  const badges = computeBadges({
    favoritesCount: Number(favoritesCountResult.rows[0].count),
    reviewsCount: Number(reviewsCountResult.rows[0].count),
    completedCount: Number(completedCountResult.rows[0].count),
    bestStreak: Number(streakResult.rows[0].best) || 0,
    createdAt: user.created_at,
  });

  res.json({
    user: { username: user.username, createdAt: user.created_at },
    favorites: favoritesResult.rows,
    reviews: reviewsResult.rows,
    mangaReviews: mangaReviewsResult.rows,
    badges,
    // Derived, not stored - see lib/xp.js. Same computation the XP leaderboard uses.
    xp: await xpForUser(user.id),
  });
}));

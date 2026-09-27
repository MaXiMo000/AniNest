import { Router } from 'express';
import { db } from '../lib/db.js';
import { xpForUser } from '../lib/xpStats.js';
import { requireAuth } from '../middleware/session.js';
import { tasteMatch, MIN_LIST } from '../lib/taste.js';
import { fillMissingGenres } from '../lib/favoriteGenres.js';

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

// Follower counts, and whether the signed-in viewer follows this person.
async function followSummary(userId, viewerId) {
  const counts = await db.execute({
    sql: `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
                 (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
                 (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND followee_id = ?) AS mine`,
    args: [userId, userId, viewerId ?? 0, userId],
  });
  const row = counts.rows[0] || {};
  return { followers: Number(row.followers) || 0, following: Number(row.following) || 0, isFollowing: Boolean(Number(row.mine)) };
}

async function findUser(username) {
  const found = await db.execute({
    sql: 'SELECT id, username, is_private FROM users WHERE username = ? COLLATE NOCASE ORDER BY username = ? DESC LIMIT 1',
    args: [username, username],
  });
  return found.rows[0] || null;
}

// Public, unauthenticated: only non-sensitive fields ever leave this route
// (username, join date, favorites, reviews) — never email or password_hash.
usersRouter.get('/:username', asyncRoute(async (req, res) => {
  const { username } = req.params;
  if (!USERNAME_RE.test(username)) return res.status(404).json({ error: 'User not found.' });

  const userResult = await db.execute({
    // Any capitalisation finds the profile; the exact spelling wins if two
    // look-alike accounts predate case-insensitive usernames.
    sql: 'SELECT id, username, created_at, is_private FROM users WHERE username = ? COLLATE NOCASE ORDER BY username = ? DESC LIMIT 1',
    args: [username, username],
  });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // A private profile shows its name, level and badges to others, but not
  // its lists or reviews. The owner always sees everything.
  if (Number(user.is_private) && req.user?.id !== Number(user.id)) {
    const { badges = [], ...xpSummary } = (await xpForUser(user.id)) || {};
    return res.json({
      user: { username: user.username, createdAt: user.created_at },
      follows: await followSummary(Number(user.id), req.user?.id),
      private: true,
      favorites: [],
      reviews: [],
      mangaReviews: [],
      badges,
      xp: xpSummary.total != null ? xpSummary : null,
    });
  }

  const mangaReviewsResult = await db.execute({
    sql: 'SELECT manga_id, rating, body, created_at, updated_at FROM manga_reviews WHERE user_id = ? AND hidden = 0 ORDER BY updated_at DESC LIMIT 100',
    args: [user.id],
  });

  const [favoritesResult, reviewsResult, xp, follows] = await Promise.all([
    db.execute({
      sql: 'SELECT mal_id, title, image, score, type, status, genres, episodes, episodes_watched, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC LIMIT 200',
      args: [user.id],
    }),
    db.execute({
      sql: 'SELECT mal_id, rating, body, created_at, updated_at FROM reviews WHERE user_id = ? AND hidden = 0 ORDER BY updated_at DESC LIMIT 100',
      args: [user.id],
    }),
    // Derived, not stored - see lib/xp.js. Same computation the XP
    // leaderboard uses, and the badges come out of it too, so a profile's
    // badges and its XP can never disagree.
    xpForUser(user.id),
    followSummary(Number(user.id), req.user?.id),
  ]);

  const { badges = [], ...xpSummary } = xp || {};

  res.json({
    user: { username: user.username, createdAt: user.created_at },
    follows,
    favorites: favoritesResult.rows.map(({ genres, ...row }) => ({ ...row, genres: parseGenres(genres) })),
    reviews: reviewsResult.rows,
    mangaReviews: mangaReviewsResult.rows,
    badges,
    xp: xp ? xpSummary : null,
  });
}));

async function tasteInput(userId) {
  const [favs, reviews] = await Promise.all([
    db.execute({ sql: 'SELECT mal_id, title, image, status, genres FROM favorites WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT mal_id, rating FROM reviews WHERE user_id = ?', args: [userId] }),
  ]);
  return {
    favorites: favs.rows.map((f) => ({ ...f, mal_id: Number(f.mal_id), genres: parseGenres(f.genres) })),
    ratings: new Map(reviews.rows.map((r) => [Number(r.mal_id), Number(r.rating)])),
  };
}

// "You and alex: 82% taste match" on a profile, for the signed-in viewer.
// `match` is null when either list is shorter than `minList`.
usersRouter.get('/:username/taste-match', requireAuth, asyncRoute(async (req, res) => {
  const { username } = req.params;
  if (!USERNAME_RE.test(username)) return res.status(404).json({ error: 'User not found.' });
  const found = await db.execute({
    sql: 'SELECT id, is_private FROM users WHERE username = ? COLLATE NOCASE ORDER BY username = ? DESC LIMIT 1',
    args: [username, username],
  });
  const other = found.rows[0];
  if (!other) return res.status(404).json({ error: 'User not found.' });
  if (Number(other.is_private)) return res.json({ match: null, private: true, minList: MIN_LIST });
  if (Number(other.id) === req.user.id) return res.status(400).json({ error: 'That’s you!' });

  // Older favorites have no genres yet; without them the match is rougher, not wrong.
  await Promise.all([fillMissingGenres(req.user.id), fillMissingGenres(Number(other.id))])
    .catch((err) => req.log.warn({ err }, 'genre backfill failed - matching with what we have'));
  const [mine, theirs] = await Promise.all([tasteInput(req.user.id), tasteInput(Number(other.id))]);
  res.json({ match: tasteMatch(mine, theirs), minList: MIN_LIST });
}));

// Follow someone to see their list and review activity in your feed
// (routes/feed.js). A private account can be followed, but its activity
// stays out of the feed until it goes public.
const MAX_FOLLOWING = 500;

usersRouter.post('/:username/follow', requireAuth, asyncRoute(async (req, res) => {
  const { username } = req.params;
  if (!USERNAME_RE.test(username)) return res.status(404).json({ error: 'User not found.' });
  const other = await findUser(username);
  if (!other) return res.status(404).json({ error: 'User not found.' });
  if (Number(other.id) === req.user.id) return res.status(400).json({ error: 'You can’t follow yourself.' });
  const count = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?', args: [req.user.id] });
  if (Number(count.rows[0]?.n) >= MAX_FOLLOWING) return res.status(429).json({ error: `You can follow up to ${MAX_FOLLOWING} people.` });
  await db.execute({ sql: 'INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)', args: [req.user.id, Number(other.id)] });
  res.json(await followSummary(Number(other.id), req.user.id));
}));

usersRouter.delete('/:username/follow', requireAuth, asyncRoute(async (req, res) => {
  const { username } = req.params;
  if (!USERNAME_RE.test(username)) return res.status(404).json({ error: 'User not found.' });
  const other = await findUser(username);
  if (!other) return res.status(404).json({ error: 'User not found.' });
  await db.execute({ sql: 'DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', args: [req.user.id, Number(other.id)] });
  res.json(await followSummary(Number(other.id), req.user.id));
}));

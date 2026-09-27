import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { buildWrapped } from '../lib/wrapped.js';

// AniNest Wrapped: your own year in anime (lib/wrapped.js). Private: it reads
// only the signed-in user's rows; sharing happens through the PNG card the
// page draws, which the user downloads or shares themselves.
export const wrappedRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const parseJson = (text) => {
  try { return JSON.parse(text || '[]'); } catch { return []; }
};

wrappedRouter.get('/', requireAuth, asyncRoute(async (req, res) => {
  const thisYear = new Date().getUTCFullYear();
  const year = req.query.year === undefined ? thisYear : Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > thisYear) return res.status(400).json({ error: 'Pick a year up to this one.' });
  // The browser's Date#getTimezoneOffset, so days and months are the viewer's own.
  const tz = Number(req.query.tz ?? 0);
  const tzOffsetMin = Number.isInteger(tz) && Math.abs(tz) <= 840 ? tz : 0;

  // A day either side of the year, so a timezone shift can't drop the edges.
  const from = `${year - 1}-12-31 00:00:00`;
  const to = `${year + 1}-01-02 00:00:00`;
  const [logs, favs, reviews] = await Promise.all([
    db.execute({
      sql: 'SELECT mal_id, episode, watched_at FROM episode_log WHERE user_id = ? AND watched_at >= ? AND watched_at < ?',
      args: [req.user.id, from, to],
    }),
    db.execute({ sql: 'SELECT mal_id, title, image, type, genres, episodes FROM favorites WHERE user_id = ?', args: [req.user.id] }),
    db.execute({ sql: 'SELECT mal_id, rating FROM reviews WHERE user_id = ?', args: [req.user.id] }),
  ]);

  res.json({
    username: req.user.username,
    ...buildWrapped({
      year,
      tzOffsetMin,
      logs: logs.rows,
      favorites: favs.rows.map((f) => ({ ...f, genres: parseJson(f.genres) })),
      reviews: reviews.rows.map((r) => ({ mal_id: Number(r.mal_id), rating: Number(r.rating) })),
    }),
  });
}));

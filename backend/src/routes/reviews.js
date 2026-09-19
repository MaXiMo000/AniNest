import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';

export const reviewsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function parseMalId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Public: anyone can read reviews for an anime, no account needed. Includes
// the caller's own review separately (if signed in) so the frontend can show
// an "edit" form instead of a fresh "write a review" one.
reviewsRouter.get('/:malId', asyncRoute(async (req, res) => {
  const malId = parseMalId(req.params.malId);
  if (!malId) return res.status(400).json({ error: 'Invalid anime id.' });

  const [listResult, aggResult] = await Promise.all([
    db.execute({
      sql: `
        SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.username
        FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.mal_id = ?
        ORDER BY r.updated_at DESC
        LIMIT 100
      `,
      args: [malId],
    }),
    db.execute({ sql: 'SELECT AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE mal_id = ?', args: [malId] }),
  ]);

  let myReview = null;
  if (req.user) {
    const mine = await db.execute({
      sql: 'SELECT rating, body FROM reviews WHERE mal_id = ? AND user_id = ?',
      args: [malId, req.user.id],
    });
    myReview = mine.rows[0] || null;
  }

  const agg = aggResult.rows[0];
  res.json({
    reviews: listResult.rows,
    average: agg.avg != null ? Math.round(Number(agg.avg) * 10) / 10 : null,
    count: Number(agg.count),
    myReview,
  });
}));

const reviewSchema = z.object({
  mal_id: z.number().int().positive(),
  rating: z.number().int().min(1).max(10),
  body: z.string().trim().max(2000).optional().or(z.literal('')),
});

reviewsRouter.post('/', requireAuth, asyncRoute(async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { mal_id: malId, rating, body } = parsed.data;

  await db.execute({
    sql: `
      INSERT INTO reviews (user_id, mal_id, rating, body, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, mal_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, updated_at = datetime('now')
    `,
    args: [req.user.id, malId, rating, body || null],
  });

  res.status(201).json({ ok: true });
}));

reviewsRouter.delete('/:malId', requireAuth, asyncRoute(async (req, res) => {
  const malId = parseMalId(req.params.malId);
  if (!malId) return res.status(400).json({ error: 'Invalid anime id.' });
  await db.execute({ sql: 'DELETE FROM reviews WHERE user_id = ? AND mal_id = ?', args: [req.user.id, malId] });
  res.status(204).end();
}));

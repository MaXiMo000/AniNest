import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';

// Manga reviews: same behaviour as routes/reviews.js (public read, one review
// per user per title, edit = re-post, delete your own), keyed by the MangaDex
// UUID instead of a MAL id.
export const mangaReviewsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public: anyone can read reviews for a manga. Includes the caller's own
// review separately (if signed in) so the page can show "edit" instead of
// a fresh "write a review" form.
mangaReviewsRouter.get('/:mangaId', asyncRoute(async (req, res) => {
  const { mangaId } = req.params;
  if (!UUID_RE.test(mangaId)) return res.status(400).json({ error: 'Invalid manga id.' });

  const [listResult, aggResult] = await Promise.all([
    db.execute({
      sql: `
        SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.username
        FROM manga_reviews r JOIN users u ON u.id = r.user_id
        WHERE r.manga_id = ?
        ORDER BY r.updated_at DESC
        LIMIT 100
      `,
      args: [mangaId],
    }),
    db.execute({ sql: 'SELECT AVG(rating) AS avg, COUNT(*) AS count FROM manga_reviews WHERE manga_id = ?', args: [mangaId] }),
  ]);

  let myReview = null;
  if (req.user) {
    const mine = await db.execute({
      sql: 'SELECT rating, body FROM manga_reviews WHERE manga_id = ? AND user_id = ?',
      args: [mangaId, req.user.id],
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
  manga_id: z.string().trim().regex(UUID_RE, 'Invalid manga id.'),
  rating: z.number().int().min(1).max(10),
  body: z.string().trim().max(2000).optional().or(z.literal('')),
});

mangaReviewsRouter.post('/', requireAuth, asyncRoute(async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { manga_id: mangaId, rating, body } = parsed.data;

  await db.execute({
    sql: `
      INSERT INTO manga_reviews (user_id, manga_id, rating, body, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, manga_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, updated_at = datetime('now')
    `,
    args: [req.user.id, mangaId, rating, body || null],
  });

  res.status(201).json({ ok: true });
}));

mangaReviewsRouter.delete('/:mangaId', requireAuth, asyncRoute(async (req, res) => {
  const { mangaId } = req.params;
  if (!UUID_RE.test(mangaId)) return res.status(400).json({ error: 'Invalid manga id.' });
  await db.execute({ sql: 'DELETE FROM manga_reviews WHERE user_id = ? AND manga_id = ?', args: [req.user.id, mangaId] });
  res.status(204).end();
}));

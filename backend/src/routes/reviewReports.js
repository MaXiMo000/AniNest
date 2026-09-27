import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth, requireAdmin } from '../middleware/session.js';

// Reporting a review (any signed-in user) and the admin queue that acts on
// reports. `kind` picks the table: anime reviews or manga reviews.
export const reviewReportsRouter = Router();
export const adminReviewReportsRouter = Router();
adminReviewReportsRouter.use(requireAdmin);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const TABLES = { anime: 'reviews', manga: 'manga_reviews' };

const reportSchema = z.object({
  kind: z.enum(['anime', 'manga']),
  reviewId: z.number().int().positive(),
  reason: z.string().trim().max(300).optional(),
});

reviewReportsRouter.post('/', requireAuth, asyncRoute(async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid report.' });
  const { kind, reviewId, reason } = parsed.data;
  const found = await db.execute({ sql: `SELECT user_id FROM ${TABLES[kind]} WHERE id = ?`, args: [reviewId] });
  const review = found.rows[0];
  if (!review) return res.status(404).json({ error: 'That review is gone.' });
  if (Number(review.user_id) === req.user.id) return res.status(400).json({ error: 'You can’t report your own review.' });
  // Reporting twice is a no-op, not an error.
  await db.execute({
    sql: 'INSERT OR IGNORE INTO review_reports (kind, review_id, reporter_id, reason) VALUES (?, ?, ?, ?)',
    args: [kind, reviewId, req.user.id, reason || null],
  });
  res.status(201).json({ ok: true });
}));

// Open reports, one row per reported review, most-reported first.
adminReviewReportsRouter.get('/', asyncRoute(async (_req, res) => {
  const rows = [];
  for (const [kind, table] of Object.entries(TABLES)) {
    const titleCol = kind === 'anime' ? 'r.mal_id' : 'r.manga_id';
    // eslint-disable-next-line no-await-in-loop
    const result = await db.execute({
      sql: `SELECT rr.review_id, COUNT(*) AS reports, GROUP_CONCAT(rr.reason, ' | ') AS reasons,
                   r.rating, r.body, ${titleCol} AS title_id, u.username
            FROM review_reports rr
            JOIN ${table} r ON r.id = rr.review_id
            JOIN users u ON u.id = r.user_id
            WHERE rr.kind = ? AND r.hidden = 0
            GROUP BY rr.review_id`,
      args: [kind],
    });
    rows.push(...result.rows.map((r) => ({ kind, ...r, reviewId: Number(r.review_id), reports: Number(r.reports) })));
  }
  rows.sort((a, b) => b.reports - a.reports);
  res.json({ reports: rows });
}));

const actionParams = (req) => {
  const kind = TABLES[req.params.kind] ? req.params.kind : null;
  const id = Number(req.params.id);
  return kind && Number.isInteger(id) && id > 0 ? { kind, id } : null;
};

adminReviewReportsRouter.post('/:kind/:id/hide', asyncRoute(async (req, res) => {
  const p = actionParams(req);
  if (!p) return res.status(400).json({ error: 'Invalid review.' });
  await db.batch([
    { sql: `UPDATE ${TABLES[p.kind]} SET hidden = 1 WHERE id = ?`, args: [p.id] },
    { sql: 'DELETE FROM review_reports WHERE kind = ? AND review_id = ?', args: [p.kind, p.id] },
  ], 'write');
  res.json({ ok: true });
}));

adminReviewReportsRouter.post('/:kind/:id/dismiss', asyncRoute(async (req, res) => {
  const p = actionParams(req);
  if (!p) return res.status(400).json({ error: 'Invalid review.' });
  await db.execute({ sql: 'DELETE FROM review_reports WHERE kind = ? AND review_id = ?', args: [p.kind, p.id] });
  res.json({ ok: true });
}));

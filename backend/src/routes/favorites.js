import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';

export const favoritesRouter = Router();
favoritesRouter.use(requireAuth);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

favoritesRouter.get('/', asyncRoute(async (req, res) => {
  const result = await db.execute({
    sql: 'SELECT mal_id, title, image, score, type, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC',
    args: [req.user.id],
  });
  res.json({ favorites: result.rows });
}));

// Re-parsing through `new URL()` and storing its normalized .toString() (not
// the raw client input) closes a stored-XSS path: a string can contain a raw
// `"` and still pass a plain `.url()` check (the WHATWG parser percent-encodes
// invalid characters instead of rejecting them), but that raw quote would
// then break out of a `src="${image}"` attribute wherever we render it. The
// http/https-only check also blocks `javascript:`/`data:` schemes outright.
const httpUrl = z.string().trim().max(2000).transform((val, ctx) => {
  try {
    const url = new URL(val);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    return url.toString();
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Image must be a valid http(s) URL.' });
    return z.NEVER;
  }
});

const addSchema = z.object({
  mal_id: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  image: httpUrl.optional().or(z.literal('')),
  score: z.number().min(0).max(10).nullable().optional(),
  type: z.string().trim().max(30).optional(),
});

const MAX_FAVORITES_PER_USER = 500;

favoritesRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { mal_id: malId, title, image, score, type } = parsed.data;

  const countResult = await db.execute({ sql: 'SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?', args: [req.user.id] });
  if (Number(countResult.rows[0].count) >= MAX_FAVORITES_PER_USER) {
    return res.status(429).json({ error: `You've hit the ${MAX_FAVORITES_PER_USER}-favorite limit.` });
  }

  await db.execute({
    sql: `
      INSERT INTO favorites (user_id, mal_id, title, image, score, type)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, mal_id) DO NOTHING
    `,
    args: [req.user.id, malId, title, image || null, score ?? null, type || null],
  });

  res.status(201).json({ ok: true });
}));

favoritesRouter.delete('/:malId', asyncRoute(async (req, res) => {
  const malId = Number(req.params.malId);
  if (!Number.isInteger(malId) || malId <= 0) return res.status(400).json({ error: 'Invalid anime id.' });
  await db.execute({ sql: 'DELETE FROM favorites WHERE user_id = ? AND mal_id = ?', args: [req.user.id, malId] });
  res.status(204).end();
}));

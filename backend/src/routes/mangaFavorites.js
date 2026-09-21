import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';

export const mangaFavoritesRouter = Router();
mangaFavoritesRouter.use(requireAuth);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

mangaFavoritesRouter.get('/', asyncRoute(async (req, res) => {
  const result = await db.execute({
    sql: 'SELECT manga_id, title, image, format, status, added_at FROM manga_favorites WHERE user_id = ? ORDER BY added_at DESC',
    args: [req.user.id],
  });
  res.json({ favorites: result.rows });
}));

// Same stored-XSS closure as favorites.js's httpUrl - re-parsing through
// `new URL()` and storing its normalized .toString() (not the raw client
// input) blocks a raw `"` breaking out of a `src="${image}"` attribute, and
// the http/https-only check blocks `javascript:`/`data:` schemes outright.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_STATUS_VALUES = ['reading', 'plan_to_read', 'completed', 'dropped'];

const addSchema = z.object({
  manga_id: z.string().trim().regex(UUID_RE, 'Invalid manga id.'),
  title: z.string().trim().min(1).max(300),
  image: httpUrl.optional().or(z.literal('')),
  format: z.string().trim().max(30).optional(),
  status: z.enum(READ_STATUS_VALUES).nullable().optional(),
});

const MAX_FAVORITES_PER_USER = 500;

mangaFavoritesRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { manga_id: mangaId, title, image, format, status } = parsed.data;

  // Only enforce the cap on a genuinely new entry - same reasoning as
  // favorites.js: changing status/refreshing metadata on an existing
  // favorite isn't "adding" another one.
  const existing = await db.execute({ sql: 'SELECT id FROM manga_favorites WHERE user_id = ? AND manga_id = ?', args: [req.user.id, mangaId] });
  if (!existing.rows.length) {
    const countResult = await db.execute({ sql: 'SELECT COUNT(*) AS count FROM manga_favorites WHERE user_id = ?', args: [req.user.id] });
    if (Number(countResult.rows[0].count) >= MAX_FAVORITES_PER_USER) {
      return res.status(429).json({ error: `You've hit the ${MAX_FAVORITES_PER_USER}-favorite limit.` });
    }
  }

  // A plain heart-toggle never sends a `status` key - only overwrite it
  // when the caller explicitly included the field (even as `null`, to
  // clear it), same rule as favorites.js.
  const hasStatusField = Object.prototype.hasOwnProperty.call(req.body, 'status');

  await db.execute({
    sql: `
      INSERT INTO manga_favorites (user_id, manga_id, title, image, format, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, manga_id) DO UPDATE SET
        title = excluded.title,
        image = excluded.image,
        format = excluded.format,
        status = ${hasStatusField ? 'excluded.status' : 'manga_favorites.status'}
    `,
    args: [req.user.id, mangaId, title, image || null, format || null, status ?? null],
  });

  res.status(201).json({ ok: true });
}));

mangaFavoritesRouter.delete('/:mangaId', asyncRoute(async (req, res) => {
  const mangaId = req.params.mangaId;
  if (!UUID_RE.test(mangaId)) return res.status(400).json({ error: 'Invalid manga id.' });
  await db.execute({ sql: 'DELETE FROM manga_favorites WHERE user_id = ? AND manga_id = ?', args: [req.user.id, mangaId] });
  res.status(204).end();
}));

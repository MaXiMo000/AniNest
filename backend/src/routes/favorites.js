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
    sql: 'SELECT mal_id, title, image, score, type, status, episodes, episodes_watched, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC',
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

const STATUS_VALUES = ['watching', 'plan_to_watch', 'completed', 'dropped'];

const addSchema = z.object({
  mal_id: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  image: httpUrl.optional().or(z.literal('')),
  score: z.number().min(0).max(10).nullable().optional(),
  type: z.string().trim().max(30).optional(),
  // Distinct from a plain favorite/heart - a lightweight "mini tracker"
  // status. Nullable so a client can explicitly clear it back to "no status".
  status: z.enum(STATUS_VALUES).nullable().optional(),
  genres: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  episodes: z.number().int().min(0).max(5000).nullable().optional(),
});

const MAX_FAVORITES_PER_USER = 500;
const MAX_EPISODES = 5000;
const MAX_LOGGED_STEP = 30;

favoritesRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { mal_id: malId, title, image, score, type, status, genres, episodes } = parsed.data;

  // Only enforce the cap on a genuinely new entry - changing the status (or
  // refreshing title/image/score) on an existing favorite isn't "adding"
  // another one, and shouldn't be blocked by an already-full list.
  const existing = await db.execute({ sql: 'SELECT id FROM favorites WHERE user_id = ? AND mal_id = ?', args: [req.user.id, malId] });
  if (!existing.rows.length) {
    const countResult = await db.execute({ sql: 'SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?', args: [req.user.id] });
    if (Number(countResult.rows[0].count) >= MAX_FAVORITES_PER_USER) {
      return res.status(429).json({ error: `You've hit the ${MAX_FAVORITES_PER_USER}-favorite limit.` });
    }
  }

  // A plain heart-toggle never sends a `status` key at all, and must not
  // clobber a status the anime already has - only overwrite it when the
  // caller explicitly included the field (even as `null`, to clear it).
  const hasStatusField = Object.prototype.hasOwnProperty.call(req.body, 'status');

  await db.execute({
    sql: `
      INSERT INTO favorites (user_id, mal_id, title, image, score, type, status, genres, episodes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, mal_id) DO UPDATE SET
        title = excluded.title,
        image = excluded.image,
        score = excluded.score,
        type = excluded.type,
        status = ${hasStatusField ? 'excluded.status' : 'favorites.status'},
        genres = COALESCE(excluded.genres, favorites.genres),
        episodes = COALESCE(excluded.episodes, favorites.episodes)
    `,
    args: [
      req.user.id, malId, title, image || null, score ?? null, type || null, status ?? null,
      genres?.length ? JSON.stringify(genres) : null, episodes ?? null,
    ],
  });

  res.status(201).json({ ok: true });
}));

favoritesRouter.delete('/:malId', asyncRoute(async (req, res) => {
  const malId = Number(req.params.malId);
  if (!Number.isInteger(malId) || malId <= 0) return res.status(400).json({ error: 'Invalid anime id.' });
  await db.execute({ sql: 'DELETE FROM favorites WHERE user_id = ? AND mal_id = ?', args: [req.user.id, malId] });
  res.status(204).end();
}));

// Episode progress on an anime already in the list. `episodes` is the length
// the client knows right now; null (airing, unknown) keeps the saved one, the
// same rule as the list POST above. Moving onto a show marks it watching; reaching the
// last episode marks it completed, and stepping back off the end reopens it.
const progressSchema = z.object({
  episodes_watched: z.number().int().min(0).max(MAX_EPISODES),
  episodes: z.number().int().positive().max(MAX_EPISODES).nullable().optional(),
});

favoritesRouter.post('/:malId/progress', asyncRoute(async (req, res) => {
  const malId = Number(req.params.malId);
  if (!Number.isInteger(malId) || malId <= 0) return res.status(400).json({ error: 'Invalid anime id.' });
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });

  const existing = await db.execute({
    sql: 'SELECT status, episodes_watched, episodes FROM favorites WHERE user_id = ? AND mal_id = ?',
    args: [req.user.id, malId],
  });
  const row = existing.rows[0];
  if (!row) return res.status(404).json({ error: 'Add this anime to your list first.' });

  const total = parsed.data.episodes ?? row.episodes;
  const watched = total ? Math.min(parsed.data.episodes_watched, total) : parsed.data.episodes_watched;
  const previous = Number(row.episodes_watched) || 0;
  const status = nextStatus(row.status, watched, total);

  const statements = [{
    sql: `UPDATE favorites SET episodes_watched = ?, episodes = ?, status = ?, progress_at = datetime('now')
          WHERE user_id = ? AND mal_id = ?`,
    args: [watched, total ?? null, status, req.user.id, malId],
  }];
  // Only small forward steps are logged as "watched now". Jumping 0 -> 500 is
  // someone catching the tracker up on a show they watched years ago, and
  // logging it as today would wreck any "watched this year" number.
  if (watched > previous && watched - previous <= MAX_LOGGED_STEP) {
    for (let ep = previous + 1; ep <= watched; ep += 1) {
      statements.push({ sql: 'INSERT OR IGNORE INTO episode_log (user_id, mal_id, episode) VALUES (?, ?, ?)', args: [req.user.id, malId, ep] });
    }
  } else if (watched < previous) {
    statements.push({ sql: 'DELETE FROM episode_log WHERE user_id = ? AND mal_id = ? AND episode > ?', args: [req.user.id, malId, watched] });
  }
  await db.batch(statements, 'write');

  res.json({ episodes_watched: watched, episodes: total ?? null, status });
}));

function nextStatus(current, watched, total) {
  if (total && watched >= total) return 'completed';
  if (current === 'completed' && total && watched < total) return 'watching';
  if (watched > 0 && (!current || current === 'plan_to_watch')) return 'watching';
  return current ?? null;
}

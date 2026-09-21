import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { anilistUserAnimeList } from '../lib/anilist.js';

export const importRouter = Router();
importRouter.use(requireAuth);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Matches favorites.js's own cap - duplicated rather than shared, since it's
// one stable number and importing a shared constant for it isn't worth the
// coupling between two otherwise-independent route files.
const MAX_FAVORITES_PER_USER = 500;

const importSchema = z.object({
  username: z.string().trim().min(1).max(50),
});

// Imports a public AniList user's anime list into the caller's own
// favorites, mapping AniList's watch status onto ours. Always overwrites an
// already-favorited title's title/image/score/status from AniList - unlike
// a plain heart-toggle (which never touches status if the request doesn't
// include the field), this route's whole purpose is "make my AniNest list
// match my AniList list," so a full overwrite on conflict is the intended
// behavior, not an oversight.
importRouter.post('/anilist', asyncRoute(async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter an AniList username.' });
  const { username } = parsed.data;

  const entries = await anilistUserAnimeList(username);
  if (entries === null) return res.status(404).json({ error: `No AniList user named "${username}".` });
  if (!entries.length) return res.json({ added: 0, updated: 0, skipped: 0, total: 0 });

  const [existingResult, countResult] = await Promise.all([
    db.execute({ sql: 'SELECT mal_id FROM favorites WHERE user_id = ?', args: [req.user.id] }),
    db.execute({ sql: 'SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?', args: [req.user.id] }),
  ]);
  const existingIds = new Set(existingResult.rows.map((r) => Number(r.mal_id)));
  let remainingCapacity = MAX_FAVORITES_PER_USER - Number(countResult.rows[0].count);

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const statements = [];
  for (const e of entries) {
    if (existingIds.has(e.mal_id)) {
      updated += 1;
    } else if (remainingCapacity > 0) {
      remainingCapacity -= 1;
      added += 1;
    } else {
      skipped += 1;
      continue;
    }
    statements.push({
      sql: `
        INSERT INTO favorites (user_id, mal_id, title, image, score, type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, mal_id) DO UPDATE SET
          title = excluded.title, image = excluded.image, score = excluded.score,
          type = excluded.type, status = excluded.status
      `,
      args: [req.user.id, e.mal_id, e.title, e.image || null, e.score, e.type, e.status],
    });
  }

  if (statements.length) await db.batch(statements, 'write');

  res.json({ added, updated, skipped, total: entries.length });
}));

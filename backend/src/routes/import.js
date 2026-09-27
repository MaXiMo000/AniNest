import { Router, raw } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { anilistUserAnimeList, anilistBasicsForMalIds } from '../lib/anilist.js';
import { parseMalXml } from '../lib/malImport.js';
import { logger } from '../lib/logger.js';

export const importRouter = Router();
importRouter.use(requireAuth);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Matches favorites.js's own cap - duplicated rather than shared, since it's
// one stable number and importing a shared constant for it isn't worth the
// coupling between two otherwise-independent route files.
const MAX_FAVORITES_PER_USER = 500;

// Which entries fit under the favorites cap: titles already on the list are
// always updated, new ones are added until the cap, the rest are skipped.
async function planImport(userId, entries) {
  const [existingResult, countResult] = await Promise.all([
    db.execute({ sql: 'SELECT mal_id FROM favorites WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?', args: [userId] }),
  ]);
  const existingIds = new Set(existingResult.rows.map((r) => Number(r.mal_id)));
  let remainingCapacity = MAX_FAVORITES_PER_USER - Number(countResult.rows[0].count);
  const toWrite = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;
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
    toWrite.push(e);
  }
  return { toWrite, added, updated, skipped };
}

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

  const { toWrite, added, updated, skipped } = await planImport(req.user.id, entries);
  const statements = toWrite.map((e) => ({
    sql: `
      INSERT INTO favorites (user_id, mal_id, title, image, score, type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, mal_id) DO UPDATE SET
        title = excluded.title, image = excluded.image, score = excluded.score,
        type = excluded.type, status = excluded.status
    `,
    args: [req.user.id, e.mal_id, e.title, e.image || null, e.score, e.type, e.status],
  }));

  if (statements.length) await db.batch(statements, 'write');

  res.json({ added, updated, skipped, total: entries.length });
}));

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
let lookup = anilistBasicsForMalIds;
// Test hook: the suite never calls AniList.
export function setMalImportLookup(fn) { lookup = fn || anilistBasicsForMalIds; }

// Imports a MyAnimeList export file (the .xml.gz from MAL's export page, or
// the unzipped .xml), sent as the raw request body. Brings over status,
// episode progress and your 1-10 scores; covers and community scores come
// from AniList. Like the AniList import, list entries are overwritten; a
// score only becomes a rating where you haven't rated the show here yet.
importRouter.post('/mal', raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), asyncRoute(async (req, res) => {
  const entries = Buffer.isBuffer(req.body) && req.body.length ? parseMalXml(req.body) : null;
  if (!entries) return res.status(400).json({ error: 'That doesn’t look like a MyAnimeList anime list export.' });
  if (!entries.length) return res.json({ added: 0, updated: 0, skipped: 0, rated: 0, total: 0 });

  const { toWrite, added, updated, skipped } = await planImport(req.user.id, entries);
  let basics = new Map();
  try {
    basics = await lookup(toWrite.map((e) => e.mal_id));
  } catch (err) {
    logger.warn({ err }, 'MAL import: AniList lookup failed, importing without covers');
  }
  const ratings = toWrite.filter((e) => e.my_score != null);
  const results = !toWrite.length ? [] : await db.batch([
    ...toWrite.map((e) => {
      const b = basics.get(e.mal_id);
      return {
        sql: `
          INSERT INTO favorites (user_id, mal_id, title, image, score, type, status, episodes, episodes_watched)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, mal_id) DO UPDATE SET
            title = excluded.title, image = COALESCE(excluded.image, favorites.image),
            score = COALESCE(excluded.score, favorites.score), type = excluded.type, status = excluded.status,
            episodes = COALESCE(excluded.episodes, favorites.episodes), episodes_watched = excluded.episodes_watched
        `,
        args: [req.user.id, e.mal_id, b?.title || e.title, b?.image || null, b?.score ?? null, b?.type || e.type, e.status, e.episodes, e.episodes_watched],
      };
    }),
    ...ratings.map((e) => ({
      sql: 'INSERT INTO reviews (user_id, mal_id, rating) VALUES (?, ?, ?) ON CONFLICT(user_id, mal_id) DO NOTHING',
      args: [req.user.id, e.mal_id, e.my_score],
    })),
  ], 'write');
  const rated = results.slice(toWrite.length).reduce((n, r) => n + r.rowsAffected, 0);

  res.json({ added, updated, skipped, rated, total: entries.length });
}));

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/session.js';
import { cached } from '../lib/cache.js';
import { anilistSourceMaterial } from '../lib/anilist.js';

// Manga continuation guide: "the anime ends at chapter 87, so start at 88".
// The source title comes from AniList's relations and works with zero users;
// the chapter is community-submitted, one answer per person per anime, and
// the page shows the most common one with how many people agree.
export const continuationsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const DAY_MS = 24 * 60 * 60 * 1000;
let sourceOf = anilistSourceMaterial;
// Test hook: the suite never calls AniList.
export function setContinuationSource(fn) { sourceOf = fn || anilistSourceMaterial; }

// rows: [{ last_chapter, volume }] -> the most common chapter (ties go to the
// later chapter, since an anime rarely stops earlier than people think), with
// the most common volume among the people who gave it.
export function consensus(rows) {
  if (!rows.length) return null;
  const byChapter = new Map();
  for (const r of rows) {
    const ch = Number(r.last_chapter);
    byChapter.set(ch, [...(byChapter.get(ch) || []), r.volume == null ? null : Number(r.volume)]);
  }
  const [lastChapter, volumes] = [...byChapter].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0];
  const volCounts = new Map();
  for (const v of volumes.filter((x) => x != null)) volCounts.set(v, (volCounts.get(v) || 0) + 1);
  const volume = [...volCounts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
  return { lastChapter, nextChapter: Math.floor(lastChapter) + 1, volume, agree: volumes.length, total: rows.length };
}

const malIdOf = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function view(malId, userId) {
  const [source, rows] = await Promise.all([
    cached(`continuation:source:${malId}`, DAY_MS, () => sourceOf(malId)).catch((err) => {
      logger.warn({ err, malId }, 'continuation: source lookup failed');
      return null;
    }),
    db.execute({ sql: 'SELECT user_id, last_chapter, volume FROM manga_continuations WHERE mal_id = ?', args: [malId] }),
  ]);
  const mine = rows.rows.find((r) => Number(r.user_id) === userId);
  return {
    source,
    consensus: consensus(rows.rows),
    mine: mine ? { lastChapter: Number(mine.last_chapter), volume: mine.volume == null ? null : Number(mine.volume) } : null,
  };
}

continuationsRouter.get('/:malId', asyncRoute(async (req, res) => {
  const malId = malIdOf(req.params.malId);
  if (!malId) return res.status(400).json({ error: 'Invalid anime id.' });
  res.json(await view(malId, req.user?.id));
}));

const submitSchema = z.object({
  last_chapter: z.number().min(1).max(5000).multipleOf(0.1),
  volume: z.number().int().min(1).max(500).nullable().optional(),
});

continuationsRouter.post('/:malId', requireAuth, asyncRoute(async (req, res) => {
  const malId = malIdOf(req.params.malId);
  if (!malId) return res.status(400).json({ error: 'Invalid anime id.' });
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the last chapter the anime covers (a number up to 5000).' });
  await db.execute({
    sql: `INSERT INTO manga_continuations (mal_id, user_id, last_chapter, volume) VALUES (?, ?, ?, ?)
          ON CONFLICT(mal_id, user_id) DO UPDATE SET last_chapter = excluded.last_chapter, volume = excluded.volume, updated_at = datetime('now')`,
    args: [malId, req.user.id, Math.round(parsed.data.last_chapter * 10) / 10, parsed.data.volume ?? null],
  });
  res.json(await view(malId, req.user.id));
}));

continuationsRouter.delete('/:malId', requireAuth, asyncRoute(async (req, res) => {
  const malId = malIdOf(req.params.malId);
  if (!malId) return res.status(400).json({ error: 'Invalid anime id.' });
  await db.execute({ sql: 'DELETE FROM manga_continuations WHERE mal_id = ? AND user_id = ?', args: [malId, req.user.id] });
  res.json(await view(malId, req.user.id));
}));

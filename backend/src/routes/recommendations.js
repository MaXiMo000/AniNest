import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { recommendations as recommendationsFor } from '../lib/animeSource.js';
import { cached } from '../lib/cache.js';

export const recommendationsRouter = Router();
recommendationsRouter.use(requireAuth);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Only the most-recently-favorited handful, not every favorite (a user can
// have up to 500) - keeps this to a bounded number of upstream calls and
// keeps the result grounded in a user's *current* taste rather than
// something they favorited years ago and may not even like anymore.
const SEED_LIMIT = 15;
const RESULT_LIMIT = 10;
const MIN_SEEDS_FOR_RECOMMENDATIONS = 3;
// Shorter than animeSource's own 30min detail TTL - this is personalized
// and should feel reasonably fresh after a user favorites something new,
// without re-running the full aggregation (up to 15 upstream calls) on
// every Home page load.
const TTL_MS = 15 * 60 * 1000;

// Only ever called with seeds.length >= MIN_SEEDS_FOR_RECOMMENDATIONS - the
// cheap "not enough favorites yet" case is handled by the route below
// BEFORE this (and its cache) gets involved. Caching that free, DB-only
// check for a full TTL_MS window would otherwise strand a user who favorites
// their first few anime right after an earlier empty check - they'd see no
// recommendations for up to TTL_MS even though real ones are now computable.
async function buildAggregateRecommendations(seeds) {
  const favIds = new Set(seeds.map((s) => s.mal_id));
  const lists = await Promise.all(
    seeds.map((s) => recommendationsFor(s.mal_id).catch(() => ({ data: [] }))),
  );

  // Tally how many of the seed favorites' recommendation lists each
  // candidate anime shows up in - the more overlap, the stronger the
  // signal that it fits this user's actual taste, not just one favorite's.
  const tally = new Map();
  lists.forEach((list, i) => {
    const seedTitle = seeds[i].title;
    for (const rec of list.data || []) {
      const entry = rec.entry;
      const id = Number(entry?.mal_id);
      if (!id || !entry.title || favIds.has(id)) continue;
      if (!tally.has(id)) tally.set(id, { entry, count: 0, becauseOf: [] });
      const t = tally.get(id);
      t.count += 1;
      if (t.becauseOf.length < 3 && !t.becauseOf.includes(seedTitle)) t.becauseOf.push(seedTitle);
    }
  });

  const recommendations = [...tally.values()]
    .sort((a, b) => b.count - a.count || (b.entry.score || 0) - (a.entry.score || 0))
    .slice(0, RESULT_LIMIT)
    .map(({ entry, count, becauseOf }) => ({ ...entry, count, becauseOf }));

  return { basedOn: seeds, recommendations };
}

recommendationsRouter.get('/mine', asyncRoute(async (req, res) => {
  const favResult = await db.execute({
    sql: 'SELECT mal_id, title FROM favorites WHERE user_id = ? ORDER BY added_at DESC LIMIT ?',
    args: [req.user.id, SEED_LIMIT],
  });
  const seeds = favResult.rows.map((r) => ({ mal_id: Number(r.mal_id), title: r.title }));

  if (seeds.length < MIN_SEEDS_FOR_RECOMMENDATIONS) {
    return res.json({ basedOn: seeds, recommendations: [] });
  }

  const result = await cached(`recs:agg:${req.user.id}`, TTL_MS, () => buildAggregateRecommendations(seeds));
  res.json(result);
}));

import { logger } from './logger.js';
import * as animeSource from './animeSource.js';

// Keeps the most-visited anime pages fast: every WARM_EVERY_MS, the details of
// the top and currently-airing shows are fetched into the caches (in memory,
// and api_cache in the database, which survives restarts), so a first visit
// doesn't wait on AniList or Jikan. Paced one show at a time. Off in tests and
// with WARM_CACHE=off.

const WARM_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_RUN_MS = 5 * 60 * 1000;
const PACE_MS = 1500;
const LIMIT = 60;

let sources = {
  lists: () => Promise.all([
    animeSource.seasonNow(1),
    animeSource.topAnime(1, 'airing'),
    animeSource.topAnime(1),
    animeSource.topAnime(2),
  ].map((p) => p.catch(() => ({ data: [] })))),
  detail: (id) => animeSource.fullById(id),
  pause: (ms) => new Promise((r) => { setTimeout(r, ms); }),
};
// Test hook: the suite never calls the anime APIs or waits.
export function setWarmupSources(s) { sources = { ...sources, ...s }; }

// Returns how many shows were warmed. A failure on one show doesn't stop the rest.
export async function warmPopular(limit = LIMIT) {
  const lists = await sources.lists();
  const ids = [...new Set(lists.flatMap((l) => (l.data || []).map((a) => Number(a.mal_id))).filter((id) => id > 0))].slice(0, limit);
  let warmed = 0;
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await sources.detail(id);
      warmed += 1;
    } catch (err) {
      logger.warn({ err: err?.message, id }, 'cache warm-up: one show failed');
    }
    // eslint-disable-next-line no-await-in-loop
    await sources.pause(PACE_MS);
  }
  return warmed;
}

export function startCacheWarmup() {
  if (process.env.NODE_ENV === 'test' || process.env.WARM_CACHE === 'off') return;
  const run = () => warmPopular()
    .then((n) => logger.info({ warmed: n }, 'cache warm-up done'))
    .catch((err) => logger.error({ err }, 'cache warm-up failed'));
  setTimeout(run, FIRST_RUN_MS).unref();
  setInterval(run, WARM_EVERY_MS).unref();
}

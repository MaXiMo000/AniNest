import { db } from './db.js';
import { logger } from './logger.js';

// A cache that lives in the database, behind the in-memory one (cache.js).
// The in-memory cache is wiped by every deploy/restart and never outlives a
// third-party outage; this one does both. The point is resilience against
// Jikan / AniList / AnimeThemes / MangaDex being down or rate-limited:
//
//   - fresh copy (younger than `freshMs`)  -> served straight from our DB,
//     the upstream isn't touched at all
//   - stale or missing                     -> ask the upstream, store the answer
//   - upstream FAILS and we hold any copy  -> serve that copy, however old,
//     rather than an error. Slightly out-of-date beats a broken page.
//   - upstream fails and we hold nothing   -> the error propagates as before
//
// Only ever used for bounded key spaces (per-anime/per-manga detail, a few
// list pages) - never for free-text search, which would grow without limit.
export async function persistentCached(key, freshMs, fn) {
  let row = null;
  try {
    const res = await db.execute({ sql: 'SELECT value, fetched_at FROM api_cache WHERE cache_key = ?', args: [key] });
    row = res.rows[0] || null;
  } catch (err) {
    logger.warn({ err, key }, 'persistent cache read failed - continuing without it');
  }

  if (row && Date.now() - Number(row.fetched_at) < freshMs) return JSON.parse(row.value);

  try {
    const value = await fn();
    if (value !== undefined) {
      db.execute({
        sql: `INSERT INTO api_cache (cache_key, value, fetched_at) VALUES (?, ?, ?)
              ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
        args: [key, JSON.stringify(value), Date.now()],
      }).catch((err) => logger.warn({ err, key }, 'persistent cache write failed'));
    }
    return value;
  } catch (err) {
    // A definitive answer ("not found", "forbidden", a deliberate safety 404)
    // is not an outage and must not be papered over with an old copy - e.g. a
    // manga later re-rated as adult has to stay rejected. Only network
    // failures, 5xx, timeouts and rate limits (429/408) fall back to the copy.
    const definitive = err?.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 408;
    if (row && !definitive) {
      logger.warn({ err, key, ageMs: Date.now() - Number(row.fetched_at) }, 'upstream failed - serving the stored copy');
      return JSON.parse(row.value);
    }
    throw err;
  }
}

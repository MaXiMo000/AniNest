import { db } from './db.js';
import { logger } from './logger.js';
import * as animeSource from './animeSource.js';

// A small local copy of title/cover/score for anime we list without a
// per-show upstream call (the "Free in my country" page). Missing rows are
// fetched in the background, a few at a time, through the same cached
// detail lookup the anime pages use.

let fetchDetail = async (malId) => (await animeSource.fullById(malId)).data;
// Test hook: the suite never calls AniList/Jikan.
export function setTitleFetcher(fn) {
  fetchDetail = fn || (async (malId) => (await animeSource.fullById(malId)).data);
}

export async function titlesFor(ids) {
  if (!ids.length) return new Map();
  const res = await db.execute({
    sql: `SELECT mal_id, title, image, score, type, episodes FROM anime_titles WHERE mal_id IN (${ids.map(() => '?').join(',')})`,
    args: ids,
  });
  return new Map(res.rows.map((r) => [Number(r.mal_id), {
    mal_id: Number(r.mal_id), title: r.title, image: r.image, score: r.score == null ? null : Number(r.score), type: r.type,
    episodes: r.episodes == null ? null : Number(r.episodes),
  }]));
}

let running = null;

// Fills up to `max` missing titles. Only one run at a time; a second call
// while one is going just waits for it.
export function backfillTitles(ids, max = 8) {
  if (running) return running;
  running = (async () => {
    let done = 0;
    for (const malId of ids.slice(0, max)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const a = await fetchDetail(malId);
        if (!a?.title) continue;
        const image = a.images?.jpg?.large_image_url || a.images?.webp?.large_image_url || a.images?.jpg?.image_url || null;
        // eslint-disable-next-line no-await-in-loop
        await db.execute({
          sql: `INSERT INTO anime_titles (mal_id, title, image, score, type, episodes) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(mal_id) DO UPDATE SET title = excluded.title, image = excluded.image, score = excluded.score,
                  type = excluded.type, episodes = excluded.episodes, updated_at = datetime('now')`,
          args: [malId, a.title, image, a.score ?? null, a.type ?? null, a.episodes ?? null],
        });
        done += 1;
      } catch (err) {
        logger.warn({ err, malId }, 'anime title backfill failed for one show');
      }
    }
    return done;
  })().finally(() => { running = null; });
  return running;
}

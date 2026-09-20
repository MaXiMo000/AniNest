import { db } from './db.js';
import * as animeSource from './animeSource.js';

// Wider than one page (which is a narrow top-9.0-9.1 score band) so the
// puzzle doesn't cycle through the same ~20 obvious answers - mirrors the
// spread used for the games' shared client-side pool, just sourced directly
// from topAnime rather than season/genre topups since we only need one pick.
const POOL_PAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// Matches Guess the Anime's own MIN_SYNOPSIS_LEN - a synopsis has to be long
// enough that redacting the title still leaves a real clue.
const MIN_SYNOPSIS_LEN = 60;
// The day this feature shipped is puzzle #1. Whatever the actual ship date
// ends up being, this only affects the *number* shown, never which anime is
// picked (that's derived from the date string itself, not this constant).
const EPOCH_MS = Date.UTC(2026, 8, 20);

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function puzzleNumberFor(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) - EPOCH_MS;
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

// djb2 - simple and deterministic, not cryptographic. All we need is "the
// same date string always maps to the same pool index."
function hashStr(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function imageOf(anime) {
  return (
    anime?.images?.jpg?.large_image_url
    || anime?.images?.jpg?.image_url
    || anime?.images?.webp?.large_image_url
    || anime?.images?.webp?.image_url
    || ''
  );
}

async function buildPool() {
  const pages = await Promise.all(
    POOL_PAGES.map((page) => animeSource.topAnime(page).catch(() => ({ data: [] }))),
  );
  const seen = new Set();
  const pool = [];
  for (const page of pages) {
    for (const a of page.data || []) {
      const id = Number(a?.mal_id);
      if (!id || seen.has(id)) continue;
      if (!a.title || !a.score || (a.synopsis || '').length < MIN_SYNOPSIS_LEN || !imageOf(a)) continue;
      seen.add(id);
      pool.push(a);
    }
  }
  // Sorted for determinism - upstream page ordering can shift slightly
  // between cache refreshes (ties, etc.), and a stable pool order is what
  // makes "hash the date into an index" reproducible at all.
  pool.sort((a, b) => a.mal_id - b.mal_id);
  return pool;
}

function rowToChallenge(row) {
  return {
    date: row.date,
    puzzleNumber: puzzleNumberFor(row.date),
    answer: {
      mal_id: Number(row.mal_id),
      title: row.title,
      image: row.image,
      synopsis: row.synopsis,
      score: row.score,
    },
  };
}

// Picks (and persists) the single mystery anime every visitor gets for
// today's UTC date. Persisted in the `daily_challenges` table, not the
// in-memory cache, specifically so a Render free-tier cold start/redeploy
// mid-day can't hand out a second, different puzzle to later visitors - the
// first successful pick for a date wins for everyone, permanently.
export async function getDailyChallenge() {
  const date = todayUTC();
  const existing = await db.execute({ sql: 'SELECT * FROM daily_challenges WHERE date = ?', args: [date] });
  if (existing.rows.length) return rowToChallenge(existing.rows[0]);

  const pool = await buildPool();
  if (!pool.length) throw new Error("Not enough anime data available to build today's challenge.");
  const pick = pool[hashStr(date) % pool.length];
  const synopsis = String(pick.synopsis || '').replace(/\(Source:.*$/is, '').trim().slice(0, 600);

  await db.execute({
    sql: `
      INSERT INTO daily_challenges (date, mal_id, title, image, synopsis, score)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO NOTHING
    `,
    args: [date, pick.mal_id, pick.title, imageOf(pick), synopsis, pick.score],
  });

  // Re-select rather than trust the local `pick` - if a concurrent request
  // won the race and inserted first, this returns THAT row, so every caller
  // this instance serves agrees with what actually landed in the DB.
  const final = await db.execute({ sql: 'SELECT * FROM daily_challenges WHERE date = ?', args: [date] });
  return rowToChallenge(final.rows[0]);
}

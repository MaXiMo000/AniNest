import crypto from 'node:crypto';
import { db } from './db.js';
import * as animeSource from './animeSource.js';

// The anime every server-judged game deals from (lib/hlGame.js,
// lib/roundGames.js): top anime sampled across many pages (page 1 alone is a
// narrow 9.0-9.1 score band), the current season, and top-rated per genre so
// thin genres aren't missing. Rebuilt every 6 hours; a run keeps dealing from
// the version it started on, so a refresh mid-run can't change its answers.

const TOP_PAGES = [1, 3, 6, 10, 15, 20, 30, 40];
const GENRES = [1, 2, 4, 7, 8, 10, 14, 18, 19, 22, 24, 30, 36, 37, 40, 41];

async function livePool() {
  const lists = await Promise.all([
    ...TOP_PAGES.map((p) => animeSource.topAnime(p).catch(() => ({ data: [] }))),
    ...[1, 2].map((p) => animeSource.seasonNow(p).catch(() => ({ data: [] }))),
    ...GENRES.map((g) => animeSource.search({ genres: String(g), order_by: 'score', sort: 'desc', page: 1 }).catch(() => ({ data: [] }))),
  ]);
  const seen = new Set();
  const out = [];
  for (const a of lists.flatMap((l) => l.data || [])) {
    const id = Number(a?.mal_id);
    if (!id || seen.has(id) || !a.title) continue;
    seen.add(id);
    out.push({
      id,
      title: a.title,
      title_english: a.title_english || null,
      image: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
      score: a.score ?? null,
      members: a.members ?? null,
      episodes: a.episodes ?? null,
      year: a.year ?? null,
      type: a.type || null,
      studio: a.studios?.[0]?.name || null,
      source: a.source || null,
      synopsis: a.synopsis || null,
      genres: (a.genres || []).map((g) => g.name).filter(Boolean),
    });
  }
  return out;
}

// Each pool is stored once, by a hash of its contents (game_pools), and a run
// only records that version: a copy per run would be ~270 KB written at every
// start and read back at every answer. Versions outlive runs (24h) by a day.
const FRESH_MS = 6 * 60 * 60 * 1000;
const KEEP_VERSIONS_MS = 2 * 24 * 60 * 60 * 1000;
const MEMORY_VERSIONS = 4;
let source = livePool;
let pending = null;
let builtAt = 0;
const byVersion = new Map();

function remember(version, pool) {
  byVersion.delete(version);
  byVersion.set(version, pool);
  if (byVersion.size > MEMORY_VERSIONS) byVersion.delete(byVersion.keys().next().value);
}

async function build() {
  const pool = await source();
  const version = crypto.createHash('sha256').update(JSON.stringify(pool)).digest('hex').slice(0, 16);
  await db.batch([
    { sql: 'INSERT OR IGNORE INTO game_pools (version, data, created_at) VALUES (?, ?, ?)', args: [version, JSON.stringify(pool), Date.now()] },
    { sql: 'DELETE FROM game_pools WHERE created_at < ?', args: [Date.now() - KEEP_VERSIONS_MS] },
  ], 'write');
  remember(version, pool);
  return { version, pool };
}

// Test hook: the suite never calls the anime APIs.
export function setGamePool(fn) {
  source = fn || livePool;
  pending = null;
  byVersion.clear();
}

// The current pool and its version.
export function getGamePoolSnapshot() {
  if (!pending || Date.now() - builtAt > FRESH_MS) {
    builtAt = Date.now();
    pending = build().catch((err) => { pending = null; throw err; });
  }
  return pending;
}

export const getGamePool = async () => (await getGamePoolSnapshot()).pool;

// The pool a run was dealt from, or null once that version has been pruned.
export async function getGamePoolVersion(version) {
  if (byVersion.has(version)) return byVersion.get(version);
  const row = (await db.execute({ sql: 'SELECT data FROM game_pools WHERE version = ?', args: [version] })).rows[0];
  if (!row) return null;
  const pool = JSON.parse(row.data);
  remember(version, pool);
  return pool;
}

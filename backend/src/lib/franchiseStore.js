import { db } from './db.js';
import { logger } from './logger.js';
import { anilistMediaWithRelations } from './anilist.js';
import { walkFranchise, buildFranchise, slugify } from './franchise.js';

// Stores franchise guides and builds them on demand. A guide is built the
// first time any member's page asks for it, then served from the database.
// After REBUILD_MS the stored copy is still served while a rebuild runs in the
// background. A stand-alone show is remembered as a "miss" for MISS_MS so its
// page doesn't walk AniList on every visit.
const REBUILD_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_MS = 7 * 24 * 60 * 60 * 1000;
// AniList allows 30 requests a minute for the whole app, so walks are paced
// and run one at a time.
const PACE_MS = 2200;
// A first build of a big franchise can take ~30s. The request waits this long,
// then answers "pending" while the build carries on.
const WAIT_MS = 20000;

let lastCallAt = 0;
async function pacedFetch(batch) {
  const wait = Math.max(0, lastCallAt + PACE_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  return anilistMediaWithRelations(batch);
}

let fetchMedia = pacedFetch;
// Test hook: drive builds from a fixture graph instead of the live API.
export function setFranchiseFetcher(fn) {
  fetchMedia = fn || pacedFetch;
}

let queue = Promise.resolve();
const inFlight = new Map();
function buildOnce(malId) {
  if (inFlight.has(malId)) return inFlight.get(malId);
  const run = queue.then(() => build(malId)).finally(() => inFlight.delete(malId));
  queue = run.catch(() => {});
  inFlight.set(malId, run);
  return run;
}

const missKey = (malId) => `franchise-miss:${malId}`;

async function isMiss(malId) {
  const res = await db.execute({ sql: 'SELECT fetched_at FROM api_cache WHERE cache_key = ?', args: [missKey(malId)] });
  return Boolean(res.rows[0]) && Date.now() - Number(res.rows[0].fetched_at) < MISS_MS;
}

async function uniqueSlug(name) {
  const base = slugify(name);
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await db.execute({ sql: 'SELECT 1 FROM franchises WHERE slug = ?', args: [slug] });
    if (!taken.rows.length) return slug;
  }
}

// Walks AniList from `malId` and saves the result. Returns the franchise id,
// or null when the show stands alone.
async function build(malId) {
  const { nodes, truncated } = await walkFranchise(fetchMedia, malId);
  const built = buildFranchise(nodes);
  if (!built || !built.entries.some((e) => e.mal_id === malId)) {
    await db.execute({
      sql: `INSERT INTO api_cache (cache_key, value, fetched_at) VALUES (?, '1', ?)
            ON CONFLICT(cache_key) DO UPDATE SET fetched_at = excluded.fetched_at`,
      args: [missKey(malId), Date.now()],
    });
    return null;
  }

  // Reuse the franchise any of these entries already belongs to, so the id
  // and slug survive rebuilds. If a capped walk once split one franchise into
  // two, this merges them back into the older one.
  const anilistIds = built.entries.map((e) => e.anilist_id);
  const existing = await db.execute({
    sql: `SELECT DISTINCT franchise_id FROM franchise_entries WHERE anilist_id IN (${anilistIds.map(() => '?').join(',')}) ORDER BY franchise_id`,
    args: anilistIds,
  });
  let franchiseId = existing.rows[0] ? Number(existing.rows[0].franchise_id) : null;
  const statements = [];
  if (franchiseId) {
    statements.push({ sql: "UPDATE franchises SET name = ?, truncated = ?, built_at = datetime('now') WHERE id = ?", args: [built.name, truncated ? 1 : 0, franchiseId] });
    for (const row of existing.rows.slice(1)) statements.push({ sql: 'DELETE FROM franchises WHERE id = ?', args: [Number(row.franchise_id)] });
  } else {
    const inserted = await db.execute({
      sql: 'INSERT INTO franchises (slug, name, truncated) VALUES (?, ?, ?)',
      args: [await uniqueSlug(built.name), built.name, truncated ? 1 : 0],
    });
    franchiseId = Number(inserted.lastInsertRowid);
  }
  statements.push({ sql: 'DELETE FROM franchise_entries WHERE franchise_id = ?', args: [franchiseId] });
  built.entries.forEach((e, position) => {
    statements.push({
      sql: `INSERT INTO franchise_entries (franchise_id, position, anilist_id, mal_id, title, image, format, episodes, start_date, tier, alt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [franchiseId, position, e.anilist_id, e.mal_id, e.title, e.image, e.format, e.episodes, e.start_date, e.tier, e.alt ? 1 : 0],
    });
  });
  statements.push({ sql: 'DELETE FROM api_cache WHERE cache_key = ?', args: [missKey(malId)] });
  await db.batch(statements, 'write');
  return franchiseId;
}

async function summary(franchiseId) {
  const res = await db.execute({
    sql: `SELECT f.slug, f.name, COUNT(e.anilist_id) AS entries, SUM(e.tier = 'essential') AS essential
          FROM franchises f JOIN franchise_entries e ON e.franchise_id = f.id WHERE f.id = ? GROUP BY f.id`,
    args: [franchiseId],
  });
  const row = res.rows[0];
  return row ? { slug: row.slug, name: row.name, entries: Number(row.entries), essential: Number(row.essential) } : null;
}

// The detail-page banner. Resolves to { data } (null for a stand-alone show),
// or { data: null, pending: true } while a first build is still running.
export async function franchiseForAnime(malId) {
  const found = await db.execute({
    sql: `SELECT f.id, f.built_at FROM franchise_entries e JOIN franchises f ON f.id = e.franchise_id
          WHERE e.mal_id = ? ORDER BY f.id LIMIT 1`,
    args: [malId],
  });
  const row = found.rows[0];
  if (row) {
    if (Date.now() - Date.parse(`${row.built_at}Z`) > REBUILD_MS) {
      buildOnce(malId).catch((err) => logger.warn({ err, malId }, 'franchise rebuild failed - keeping the stored copy'));
    }
    return { data: await summary(Number(row.id)) };
  }
  if (await isMiss(malId)) return { data: null };

  const build = buildOnce(malId);
  const timeout = new Promise((resolve) => setTimeout(() => resolve('pending'), WAIT_MS).unref());
  const result = await Promise.race([build, timeout]);
  if (result === 'pending') {
    build.catch((err) => logger.warn({ err, malId }, 'franchise build failed'));
    return { data: null, pending: true };
  }
  return { data: result ? await summary(result) : null };
}

export async function franchiseBySlug(slug) {
  const f = await db.execute({ sql: 'SELECT id, slug, name, truncated, built_at FROM franchises WHERE slug = ?', args: [slug] });
  const row = f.rows[0];
  if (!row) return null;
  const entries = await db.execute({
    sql: `SELECT anilist_id, mal_id, title, image, format, episodes, start_date, tier, alt
          FROM franchise_entries WHERE franchise_id = ? ORDER BY position`,
    args: [row.id],
  });
  return {
    slug: row.slug,
    name: row.name,
    truncated: Boolean(row.truncated),
    built_at: row.built_at,
    entries: entries.rows.map((e) => ({ ...e, alt: Boolean(e.alt) })),
  };
}

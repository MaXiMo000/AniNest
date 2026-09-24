import { db } from './db.js';

// Shared by both dailies: picks today's answer deterministically from the
// date's hash, but never one of the recent answers. Every instance reads the
// same history, so they still agree on the pick (and the INSERT ... ON
// CONFLICT in each daily settles any race).
//
// The no-repeat window is the last ~80% of the pool's size in days (capped
// at a year), so a pool of 250 anime can't repeat for ~200 days, and the
// candidate list never runs dry.
const MAX_WINDOW_DAYS = 365;

export function repeatWindow(poolSize) {
  return Math.max(0, Math.min(MAX_WINDOW_DAYS, Math.floor(poolSize * 0.8)));
}

// Pure: `recentIds` are the ids of recent answers (any order).
export function pickFresh(pool, recentIds, seed, key) {
  const recent = new Set(recentIds.map(String));
  const candidates = pool.filter((item) => !recent.has(String(key(item))));
  const list = candidates.length ? candidates : pool;
  return list[seed % list.length];
}

// The ids of the newest `limit` answers from `table`.`column`, before today.
export async function recentAnswers(table, column, limit, today) {
  if (!limit) return [];
  const rows = await db.execute({
    sql: `SELECT ${column} AS id FROM ${table} WHERE date < ? ORDER BY date DESC LIMIT ?`,
    args: [today, limit],
  });
  return rows.rows.map((r) => r.id);
}

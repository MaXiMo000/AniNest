import { db } from './db.js';
import { mangaSearch } from './mangadex.js';
import { pickFresh, recentAnswers, repeatWindow } from './dailyPick.js';

// The manga twin of lib/dailyChallenge.js: one shared mystery manga per UTC
// date, persisted on first pick so a restart can't hand out a second puzzle.
// The wrong answers are picked and stored with it, so every player sees the
// same four rounds and the puzzle still works when MangaDex is down later.
const POOL_PAGES = [1, 2, 3, 4, 5];
const MIN_SYNOPSIS_LEN = 60;
const DISTRACTOR_COUNT = 12; // 3 per round x 4 rounds
const EPOCH_MS = Date.UTC(2026, 8, 24);

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function puzzleNumberFor(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) - EPOCH_MS;
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

function hashStr(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash;
}

async function buildPool() {
  const pages = await Promise.all(
    POOL_PAGES.map((page) => mangaSearch({ sort: 'popular', page }).catch(() => ({ data: [] }))),
  );
  const seen = new Set();
  const pool = [];
  for (const page of pages) {
    for (const m of page.data || []) {
      if (!m?.id || seen.has(m.id) || !m.title || !m.coverImage) continue;
      seen.add(m.id);
      pool.push(m);
    }
  }
  pool.sort((a, b) => a.id.localeCompare(b.id));
  return pool;
}

// Picks `count` distinct entries after `start`, walking the pool with a
// date-derived stride so the choice is deterministic without being "the
// next twelve alphabetically".
export function pickDistractors(pool, answerIndex, seed, count = DISTRACTOR_COUNT) {
  const out = [];
  const seenTitles = new Set([pool[answerIndex].title.toLowerCase()]);
  const stride = (seed % Math.max(1, pool.length - 1)) + 1;
  for (let step = 1; out.length < count && step <= pool.length * 2; step += 1) {
    const m = pool[(answerIndex + step * stride) % pool.length];
    const key = m.title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    out.push({ id: m.id, title: m.title });
  }
  return out;
}

function rowToChallenge(row) {
  let tags = [];
  let distractors = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch { /* keep empty */ }
  try { distractors = JSON.parse(row.distractors || '[]'); } catch { /* keep empty */ }
  return {
    date: row.date,
    puzzleNumber: puzzleNumberFor(row.date),
    answer: {
      id: row.manga_id,
      title: row.title,
      image: row.image,
      synopsis: row.synopsis,
      year: row.year == null ? null : Number(row.year),
      tags,
    },
    distractors,
  };
}

export async function getMangaDailyChallenge() {
  const date = todayUTC();
  const existing = await db.execute({ sql: 'SELECT * FROM manga_daily_challenges WHERE date = ?', args: [date] });
  if (existing.rows.length) return rowToChallenge(existing.rows[0]);

  const pool = await buildPool();
  const candidates = pool.filter((m) => (m.description || '').length >= MIN_SYNOPSIS_LEN);
  if (candidates.length < 8) throw new Error("Not enough manga data available to build today's challenge.");
  const seed = hashStr(date);
  const recent = await recentAnswers('manga_daily_challenges', 'manga_id', repeatWindow(candidates.length), date);
  const pick = pickFresh(candidates, recent, seed, (m) => m.id);
  const distractors = pickDistractors(pool, pool.indexOf(pick), seed);
  const tags = (pick.tags || []).filter((t) => t.group === 'genre' || t.group === 'theme').slice(0, 4).map((t) => t.name);

  await db.execute({
    sql: `INSERT INTO manga_daily_challenges (date, manga_id, title, image, synopsis, year, tags, distractors)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(date) DO NOTHING`,
    args: [date, pick.id, pick.title, pick.coverImage, String(pick.description).slice(0, 600), pick.year, JSON.stringify(tags), JSON.stringify(distractors)],
  });
  const final = await db.execute({ sql: 'SELECT * FROM manga_daily_challenges WHERE date = ?', args: [date] });
  return rowToChallenge(final.rows[0]);
}

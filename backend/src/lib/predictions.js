import { db } from './db.js';
import { logger } from './logger.js';
import { anilistSeason, anilistBasicsForMalIds } from './anilist.js';
import { seasonOf, seasonStartMs } from './tournament.js';

// Season prediction league (routes/predictions.js). A season's SHOW_COUNT most
// popular shows are snapshotted; everyone guesses each one's final AniList
// score (1.0-10.0). Picks open OPENS_BEFORE_DAYS before the season starts and
// lock LOCKS_AFTER_DAYS in. After the lock, standings use the live score
// (refreshed every REFRESH_MS on read); FINAL_AFTER_DAYS after the season ends
// the last refresh makes the league final.
//
// Points per show: 10, minus one for every 0.1 you're off, never below 0.

export const SHOW_COUNT = 20;
export const OPENS_BEFORE_DAYS = 14;
export const LOCKS_AFTER_DAYS = 14;
export const FINAL_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const MISS_MS = 15 * 60 * 1000;
const MIN_SHOWS = 5;

export function points(guess, actual) {
  if (actual == null) return null;
  return Math.max(0, 10 - Math.round(Math.abs(guess - actual) * 10));
}

// The league the page leads with: next season's opens two weeks early.
export function leagueSeason(nowMs) {
  return seasonOf(new Date(nowMs + OPENS_BEFORE_DAYS * DAY_MS));
}

export function leagueClock({ season, year }) {
  const start = seasonStartMs({ season, year });
  const d = new Date(start);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
  return { opensAt: start - OPENS_BEFORE_DAYS * DAY_MS, locksAt: start + LOCKS_AFTER_DAYS * DAY_MS, finalAt: end + FINAL_AFTER_DAYS * DAY_MS };
}

const imageOf = (a) => a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null;
const liveSources = {
  seasonShows: async (season, year) => (await anilistSeason(season, year, 1)).data
    .map((a) => ({ mal_id: a.mal_id, title: a.title, image: imageOf(a) })),
  scores: async (malIds) => new Map([...await anilistBasicsForMalIds(malIds)].map(([id, b]) => [id, b.score])),
};
let sources = liveSources;
let clock = () => Date.now();
const misses = new Map();
// Test hooks: the suite never calls AniList, and moves the clock itself.
export function setPredictionSources(s) { sources = s || liveSources; misses.clear(); }
export function setPredictionClock(fn) { clock = fn || (() => Date.now()); }
export const now = () => clock();

export async function findLeague(season, year) {
  const res = await db.execute({ sql: 'SELECT * FROM prediction_leagues WHERE season = ? AND year = ?', args: [season, year] });
  return res.rows[0] || null;
}

export async function leagueById(id) {
  const res = await db.execute({ sql: 'SELECT * FROM prediction_leagues WHERE id = ?', args: [id] });
  return res.rows[0] || null;
}

// The season's league, snapshotting its shows on first request. A snapshot
// with too few shows isn't stored and is retried after MISS_MS.
export async function ensureLeague(season, year) {
  const found = await findLeague(season, year);
  const key = `${season}-${year}`;
  if (found || Date.now() - (misses.get(key) || 0) < MISS_MS) return found;
  let shows = [];
  try {
    shows = (await sources.seasonShows(season, year)).slice(0, SHOW_COUNT);
  } catch (err) {
    logger.warn({ err, season, year }, 'prediction league: season list unavailable');
  }
  if (shows.length < MIN_SHOWS) {
    misses.set(key, Date.now());
    return null;
  }
  const lid = '(SELECT id FROM prediction_leagues WHERE season = ? AND year = ?)';
  await db.batch([
    { sql: 'INSERT INTO prediction_leagues (season, year) VALUES (?, ?) ON CONFLICT DO NOTHING', args: [season, year] },
    ...shows.map((s, i) => ({
      sql: `INSERT INTO prediction_shows (league_id, rank, mal_id, title, image) VALUES (${lid}, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      args: [season, year, i + 1, s.mal_id, s.title, s.image],
    })),
  ], 'write');
  return findLeague(season, year);
}

// Live scores after the lock, at most every REFRESH_MS. A failed fetch keeps
// the old scores; the next read tries again.
async function refreshScores(league) {
  const t = now();
  const { locksAt, finalAt } = leagueClock(league);
  if (Number(league.final) || t < locksAt || t - Number(league.scores_at) < REFRESH_MS) return league;
  const shows = await db.execute({ sql: 'SELECT mal_id FROM prediction_shows WHERE league_id = ?', args: [league.id] });
  let scores;
  try {
    scores = await sources.scores(shows.rows.map((r) => Number(r.mal_id)));
  } catch (err) {
    logger.warn({ err, league: league.id }, 'prediction league: score refresh failed');
    return league;
  }
  const final = t >= finalAt ? 1 : 0;
  await db.batch([
    ...shows.rows.map((r) => ({
      sql: 'UPDATE prediction_shows SET score = ? WHERE league_id = ? AND mal_id = ?',
      args: [scores.get(Number(r.mal_id)) ?? null, league.id, r.mal_id],
    })),
    { sql: 'UPDATE prediction_leagues SET scores_at = ?, final = ? WHERE id = ?', args: [t, final, league.id] },
  ], 'write');
  return { ...league, scores_at: t, final };
}

const STANDINGS_SHOWN = 50;

export async function leagueView(league, userId) {
  const fresh = await refreshScores(league);
  const clockTimes = leagueClock(fresh);
  const t = now();
  const open = t >= clockTimes.opensAt && t < clockTimes.locksAt;
  const [showRows, pickRows] = await Promise.all([
    db.execute({ sql: 'SELECT mal_id, title, image, score FROM prediction_shows WHERE league_id = ? ORDER BY rank', args: [fresh.id] }),
    // ponytail: every pick in memory; fine for thousands of players, move the sums into SQL past that.
    db.execute({
      sql: 'SELECT p.user_id, u.username, p.mal_id, p.score FROM predictions p JOIN users u ON u.id = p.user_id WHERE p.league_id = ?',
      args: [fresh.id],
    }),
  ]);
  const actual = new Map(showRows.rows.map((s) => [Number(s.mal_id), s.score == null ? null : Number(s.score)]));
  const players = new Map();
  const guesses = new Map();
  for (const p of pickRows.rows) {
    const malId = Number(p.mal_id);
    const guess = Number(p.score);
    const player = players.get(Number(p.user_id)) || { username: p.username, points: 0, picks: 0, mine: {} };
    player.picks += 1;
    player.points += points(guess, actual.get(malId)) || 0;
    player.mine[malId] = guess;
    players.set(Number(p.user_id), player);
    guesses.set(malId, [...(guesses.get(malId) || []), guess]);
  }
  const ranked = [...players.entries()]
    .sort((a, b) => b[1].points - a[1].points || a[1].username.localeCompare(b[1].username))
    .map(([id, p], i) => ({ id, rank: i + 1, username: p.username, points: p.points, picks: p.picks }));
  const me = players.get(userId);
  const strip = ({ id: _id, ...r }) => r;
  const myRow = ranked.find((r) => r.id === userId);
  const avg = (xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  return {
    id: Number(fresh.id),
    season: fresh.season,
    year: Number(fresh.year),
    opensAt: new Date(clockTimes.opensAt).toISOString(),
    locksAt: new Date(clockTimes.locksAt).toISOString(),
    finalAt: new Date(clockTimes.finalAt).toISOString(),
    open,
    final: Boolean(Number(fresh.final)),
    players: ranked.length,
    shows: showRows.rows.map((s) => {
      const malId = Number(s.mal_id);
      const mine = me?.mine[malId] ?? null;
      const locked = !open && t >= clockTimes.locksAt;
      return {
        mal_id: malId,
        title: s.title,
        image: s.image,
        // Hidden while picks are open, so the page doesn't hand out answers.
        score: locked ? actual.get(malId) : null,
        crowd: locked && guesses.has(malId) ? avg(guesses.get(malId)) : null,
        mine,
        points: locked && mine != null ? points(mine, actual.get(malId)) : null,
      };
    }),
    standings: ranked.slice(0, STANDINGS_SHOWN).map(strip),
    me: myRow ? strip(myRow) : null,
  };
}

// Saves picks ({ mal_id, score|null }); null removes one. Returns an error
// message, or null on success.
export async function savePicks(league, userId, picks) {
  const { opensAt, locksAt } = leagueClock(league);
  const t = now();
  if (t < opensAt) return 'Picks for this season aren’t open yet.';
  if (t >= locksAt) return 'Picks for this season are locked.';
  const shows = await db.execute({ sql: 'SELECT mal_id FROM prediction_shows WHERE league_id = ?', args: [league.id] });
  const known = new Set(shows.rows.map((r) => Number(r.mal_id)));
  if (!picks.every((p) => known.has(p.mal_id))) return 'That show isn’t in this league.';
  await db.batch(picks.map((p) => (p.score == null
    ? { sql: 'DELETE FROM predictions WHERE league_id = ? AND user_id = ? AND mal_id = ?', args: [league.id, userId, p.mal_id] }
    : {
      sql: `INSERT INTO predictions (league_id, user_id, mal_id, score) VALUES (?, ?, ?, ?)
            ON CONFLICT(league_id, user_id, mal_id) DO UPDATE SET score = excluded.score, updated_at = datetime('now')`,
      args: [league.id, userId, p.mal_id, Math.round(p.score * 10) / 10],
    })), 'write');
  return null;
}

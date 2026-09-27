import { db } from './db.js';
import { logger } from './logger.js';
import { anilistSeason } from './anilist.js';
import * as animeSource from './animeSource.js';
import { KINDS, ROUND_DAYS, bracketSize, pickEntries, resolveBracket } from './tournament.js';

// Builds and loads season OP/ED tournaments (lib/tournament.js has the rules).
//
// A build walks the season's most popular shows through the jukebox's own
// theme lookup (animeSource.themes: AnimeThemes, then MAL's song list), one
// show at a time, until both brackets are full. Both brackets come out of the
// same walk. It runs once per season; after that everything is read from our
// tables. A build that finds too few songs (early in a season, or with both
// song sources down) is not stored and is retried after MISS_MS.

const SHOW_LIMIT = 30;
const MISS_MS = 15 * 60 * 1000;
// A first build can take a while (up to SHOW_LIMIT theme lookups). The request
// waits this long, then answers "pending" while the build carries on.
const WAIT_MS = 15000;

const imageOf = (a) => a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null;

async function liveSeasonShows(season, year) {
  const pages = await Promise.all([1, 2].map((p) => anilistSeason(season, year, p)));
  return pages.flatMap((p) => p.data).map((a) => ({ mal_id: a.mal_id, title: a.title, image: imageOf(a) }));
}

let sources = { seasonShows: liveSeasonShows, themes: (malId) => animeSource.themes(malId) };
// Test hook: the suite never calls AniList or AnimeThemes.
export function setTournamentSources(s) {
  sources = s || { seasonShows: liveSeasonShows, themes: (malId) => animeSource.themes(malId) };
  misses.clear();
}

let clock = () => Date.now();
// Test hook: move the round clock without waiting days.
export function setTournamentClock(fn) {
  clock = fn || (() => Date.now());
}
export const now = () => clock();

async function build(season, year) {
  const shows = (await sources.seasonShows(season, year)).slice(0, SHOW_LIMIT);
  const walked = [];
  for (const show of shows) {
    if (KINDS.every((k) => pickEntries(walked, k).length >= 16)) break;
    let themes = [];
    try {
      themes = (await sources.themes(show.mal_id)).data || [];
    } catch (err) {
      logger.warn({ err, malId: show.mal_id }, 'tournament build: no songs for this show');
    }
    walked.push({ ...show, themes });
  }

  const startsAt = new Date(clock()).toISOString();
  let built = 0;
  for (const kind of KINDS) {
    const entries = pickEntries(walked, kind);
    const size = bracketSize(entries.length);
    if (!size) continue;
    const tid = '(SELECT id FROM theme_tournaments WHERE season = ? AND year = ? AND kind = ?)';
    await db.batch([
      {
        sql: `INSERT INTO theme_tournaments (season, year, kind, size, starts_at, round_days) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(season, year, kind) DO NOTHING`,
        args: [season, year, kind, size, startsAt, ROUND_DAYS],
      },
      ...entries.slice(0, size).map((e, i) => ({
        sql: `INSERT INTO theme_tournament_entries (tournament_id, seed, mal_id, anime_title, image, slug, song_title, artist, video_url)
              VALUES (${tid}, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        args: [season, year, kind, i + 1, e.mal_id, e.anime_title, e.image, e.slug, e.title, e.artist, e.videoUrl],
      })),
    ], 'write');
    built += 1;
  }
  return built;
}

const inFlight = new Map();
const misses = new Map();

function buildOnce(season, year) {
  const key = `${season}-${year}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const run = build(season, year)
    .then((built) => {
      if (!built) misses.set(key, Date.now());
      return built;
    })
    .catch((err) => {
      misses.set(key, Date.now());
      logger.warn({ err, season, year }, 'tournament build failed');
      return 0;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

export async function findTournament(season, year, kind) {
  const res = await db.execute({
    sql: 'SELECT id, season, year, kind, size, starts_at, round_days FROM theme_tournaments WHERE season = ? AND year = ? AND kind = ?',
    args: [season, year, kind],
  });
  return res.rows[0] || null;
}

// { row } when the season's bracket exists (building it first if needed),
// { pending: true } while a first build is still running, or {} when the
// season has too few songs right now.
export async function ensureTournament(season, year, kind) {
  const found = await findTournament(season, year, kind);
  if (found) return { row: found };
  const missedAt = misses.get(`${season}-${year}`);
  if (missedAt && Date.now() - missedAt < MISS_MS) return {};

  const timeout = new Promise((resolve) => setTimeout(() => resolve('pending'), WAIT_MS).unref());
  if (await Promise.race([buildOnce(season, year), timeout]) === 'pending') return { pending: true };
  const row = await findTournament(season, year, kind);
  return row ? { row } : {};
}

export async function tournamentById(id) {
  const res = await db.execute({
    sql: 'SELECT id, season, year, kind, size, starts_at, round_days FROM theme_tournaments WHERE id = ?',
    args: [id],
  });
  return res.rows[0] || null;
}

export async function bracketFor(row) {
  const tally = await db.execute({
    sql: 'SELECT round, match, seed, COUNT(*) AS n FROM theme_tournament_votes WHERE tournament_id = ? GROUP BY round, match, seed',
    args: [row.id],
  });
  return resolveBracket(
    { size: Number(row.size), startsAt: Date.parse(row.starts_at), roundDays: Number(row.round_days) },
    tally.rows.map((v) => ({ round: Number(v.round), match: Number(v.match), seed: Number(v.seed), n: Number(v.n) })),
    clock(),
  );
}

// Everything the page needs. Vote counts of a match that is still open are
// hidden until the viewer has voted in it, so early votes don't steer later ones.
export async function tournamentView(row, userId) {
  const [bracket, entries, mine] = await Promise.all([
    bracketFor(row),
    db.execute({
      sql: `SELECT seed, mal_id, anime_title, image, slug, song_title, artist, video_url
            FROM theme_tournament_entries WHERE tournament_id = ? ORDER BY seed`,
      args: [row.id],
    }),
    userId
      ? db.execute({ sql: 'SELECT round, match, seed FROM theme_tournament_votes WHERE tournament_id = ? AND user_id = ?', args: [row.id, userId] })
      : { rows: [] },
  ]);
  const myVotes = Object.fromEntries(mine.rows.map((v) => [`${v.round}:${v.match}`, Number(v.seed)]));
  const iso = (ms) => new Date(ms).toISOString();

  return {
    id: Number(row.id),
    season: row.season,
    year: Number(row.year),
    kind: row.kind,
    size: Number(row.size),
    roundDays: Number(row.round_days),
    startsAt: row.starts_at,
    endsAt: iso(bracket.rounds[bracket.rounds.length - 1].closesAt),
    currentRound: bracket.currentRound,
    finished: bracket.finished,
    champion: bracket.champion,
    entries: entries.rows.map((e) => ({
      seed: Number(e.seed),
      mal_id: Number(e.mal_id),
      anime_title: e.anime_title,
      image: e.image,
      slug: e.slug,
      title: e.song_title,
      artist: e.artist,
      videoUrl: e.video_url,
    })),
    rounds: bracket.rounds.map((r) => ({
      round: r.round,
      name: r.name,
      status: r.status,
      opensAt: iso(r.opensAt),
      closesAt: iso(r.closesAt),
      matches: r.matches.map((m) => {
        const hidden = m.status === 'open' && myVotes[`${r.round}:${m.match}`] === undefined;
        return { ...m, votesA: hidden ? null : m.votesA, votesB: hidden ? null : m.votesB };
      }),
    })),
    myVotes,
  };
}

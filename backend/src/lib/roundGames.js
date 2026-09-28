import crypto from 'node:crypto';
import { db } from './db.js';
import { getGamePoolSnapshot, getGamePoolVersion } from './gamePool.js';
import * as animeSource from './animeSource.js';
import { EMOJI_PUZZLES } from './emojiPuzzles.js';
import { hashString, shuffleSeeded } from './hlGame.js';

// Round-by-round games dealt and judged by the server (routes/games.js
// /rounds/*): Studio Match, Source Material, Emoji Plot, Cast Call, Name That
// Opening, Guess the Anime (Easy/Normal/Hard/Blitz) and Timeline. The server
// builds each round, keeps its answer until the player answers, keeps the
// lives, streak and Blitz clock, and records the score itself when the run
// ends. The browser only draws what it is sent.
//
// Known limit: Name That Opening plays AnimeThemes' own video file, whose
// address names the show. Streaming the clips through this server would hide
// it but costs far more bandwidth than the host allows.

const LIVES = 3;
const MAX_BUILD_TRIES = 8;
const MAX_SKIPS = 3;
const RUN_TTL_MS = 24 * 60 * 60 * 1000;
const SNIPPET_MAX_CHARS = 260;
const MIN_SYNOPSIS_LEN = 60;

// ---- Seeded randomness: [0,1) floats from a stored mulberry32 state ----

function makeRng(state) {
  let s = state >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get state() { return s; },
  };
}

function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The next item not yet used this run (by key), starting over once all are.
export function drawUnused(list, used, rng, key = (a) => a.id) {
  let fresh = list.filter((a) => !used.has(key(a)));
  if (!fresh.length) { used.clear(); fresh = list; }
  const pick = fresh[Math.floor(rng.next() * fresh.length)];
  used.add(key(pick));
  return pick;
}

// The right value plus `count` other distinct values, shuffled, as choices.
export function valueChoices(correct, candidates, rng, count = 3) {
  const others = [...new Set(candidates.filter((c) => c && c !== correct))];
  const picked = [];
  while (others.length && picked.length < count) picked.push(others.splice(Math.floor(rng.next() * others.length), 1)[0]);
  return shuffle([correct, ...picked], rng).map((v) => ({ id: v, label: v }));
}

// The answer plus 3 other shows, never two with the same title (a series and
// its recap film would make the round solvable by elimination).
export function titleChoices(pool, answer, rng, count = 3) {
  const seen = new Set([answer.title.toLowerCase()]);
  const others = [];
  for (const a of shuffle(pool, rng)) {
    if (a.id === answer.id || seen.has(a.title.toLowerCase())) continue;
    seen.add(a.title.toLowerCase());
    others.push(a);
    if (others.length === count) break;
  }
  return shuffle([answer, ...others], rng).map((a) => ({ id: String(a.id), label: a.title }));
}

// Difficulty by fame: Easy is the best-known third, Hard the lesser-known 60%.
export function poolForDifficulty(pool, difficulty) {
  if (difficulty !== 'easy' && difficulty !== 'hard') return pool;
  const byFame = [...pool].sort((a, b) => (b.members || 0) - (a.members || 0));
  return difficulty === 'easy'
    ? byFame.slice(0, Math.max(12, Math.ceil(byFame.length * 0.35)))
    : byFame.slice(Math.floor(byFame.length * 0.4));
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The synopsis without its "(Source: ...)" line and with the show's own title
// blacked out, trimmed to a clue.
export function synopsisSnippet(anime) {
  let text = (anime.synopsis || '').replace(/\(Source:.*$/is, '').trim();
  for (const t of [anime.title, anime.title_english].filter(Boolean)) text = text.replace(new RegExp(escapeRegExp(t), 'gi'), '████');
  if (text.length > SNIPPET_MAX_CHARS) text = `${text.slice(0, SNIPPET_MAX_CHARS).replace(/\s+\S*$/, '')}…`;
  return text || 'No synopsis for this one: go by the cover!';
}

export function normalizeTitle(str = '') {
  return String(str).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}

// A typed answer matches the main or English title, or the part before a
// subtitle ("Frieren" for "Frieren: Beyond Journey's End") if 4+ letters long.
export function typedGuessMatches(guess, anime) {
  const g = normalizeTitle(guess);
  if (g.length < 2) return false;
  for (const t of [anime.title, anime.title_english].filter(Boolean)) {
    if (g === normalizeTitle(t)) return true;
    const head = normalizeTitle(String(t).split(/[:\-–—]/)[0]);
    if (head.length >= 4 && g === head) return true;
  }
  return false;
}

// Four cards with different years (so one order is right), unplayed first.
export function drawDistinctYears(pool, count, rng, avoid = new Set()) {
  const shuffled = shuffle(pool, rng);
  const byYear = new Map();
  for (const a of [...shuffled.filter((x) => !avoid.has(x.id)), ...shuffled.filter((x) => avoid.has(x.id))]) {
    if (!byYear.has(a.year)) byYear.set(a.year, a);
    if (byYear.size === count) break;
  }
  return byYear.size === count ? shuffle([...byYear.values()], rng) : null;
}

export const isChronological = (years) => years.every((y, i) => i === 0 || years[i - 1] <= y);

// ---- The games. build(ctx) returns one round:
//   { view: what the browser sees, answer, reveal, recap: { label, href }, cover? }
// or null to try another. ctx = { pool, rng, used, streak, mode }. ----

const recapFor = (a, label = a.title) => ({ label, href: `#/anime/${a.id}` });

function choiceRound(pool, ctx, value, extra = {}) {
  const anime = drawUnused(pool, ctx.used, ctx.rng);
  return {
    view: { anime: { title: anime.title, image: anime.image }, choices: extra.choices(anime), ...(extra.view || {}) },
    answer: String(value(anime)),
    reveal: extra.reveal(anime),
    recap: recapFor(anime, `${anime.title} — ${value(anime)}`),
  };
}

const SOURCES = ['Manga', 'Light novel', 'Original', 'Video game', 'Visual novel'];

function gtaGame(difficulty, { blitz = false } = {}) {
  return {
    ranked: difficulty !== 'easy',
    lives: blitz ? null : LIVES,
    blitzMs: blitz ? 60_000 : null,
    penaltyMs: 3000,
    minMs: blitz ? 250 : 900,
    typed: !blitz,
    filter: (a) => (a.synopsis || '').length >= MIN_SYNOPSIS_LEN && a.image,
    deck: (pool) => poolForDifficulty(pool, blitz ? 'normal' : difficulty),
    build(pool, ctx) {
      const anime = drawUnused(pool, ctx.used, ctx.rng);
      return {
        view: {
          clues: {
            synopsis: synopsisSnippet(anime),
            genres: anime.genres.slice(0, 4),
            type: anime.type,
            episodes: anime.episodes,
            year: anime.year,
            studio: anime.studio,
            source: anime.source,
          },
          ...(ctx.mode.input === 'typed' ? {} : { choices: titleChoices(pool, anime, ctx.rng) }),
        },
        answer: String(anime.id),
        answerAnime: { title: anime.title, title_english: anime.title_english },
        reveal: { title: anime.title, mal_id: anime.id, image: anime.image },
        recap: recapFor(anime),
        cover: anime.image,
      };
    },
  };
}

export const ROUND_GAMES = {
  'studio-match': {
    ranked: true, lives: LIVES, minMs: 800,
    filter: (a) => a.studio,
    build: (pool, ctx) => {
      if (new Set(pool.map((a) => a.studio)).size < 4) return null;
      return choiceRound(pool, ctx, (a) => a.studio, {
        choices: (a) => valueChoices(a.studio, pool.map((x) => x.studio), ctx.rng),
        reveal: (a) => ({ text: `🏢 ${a.studio}` }),
      });
    },
  },
  'source-guess': {
    ranked: true, lives: LIVES, minMs: 800,
    filter: (a) => a.source,
    build: (pool, ctx) => choiceRound(pool, ctx, (a) => a.source, {
      choices: (a) => valueChoices(a.source, [...pool.map((x) => x.source), ...SOURCES], ctx.rng),
      reveal: (a) => ({ text: `📚 ${a.source}` }),
    }),
  },
  'emoji-plot': {
    ranked: true, lives: LIVES, minMs: 800,
    puzzles: true,
    build: (_pool, ctx) => {
      const p = drawUnused(EMOJI_PUZZLES, ctx.used, ctx.rng, (x) => x.title);
      return {
        view: { emoji: p.emoji, choices: valueChoices(p.title, EMOJI_PUZZLES.map((x) => x.title), ctx.rng) },
        answer: p.title,
        reveal: { text: p.title },
        recap: { label: `${p.emoji} ${p.title}`, href: `#/browse?q=${encodeURIComponent(p.title)}` },
      };
    },
  },
  'cast-call': {
    ranked: true, lives: LIVES, minMs: 800,
    filter: (a) => a.title,
    deck: (pool) => poolForDifficulty(pool, 'easy'),
    async build(pool, ctx) {
      const anime = drawUnused(pool, ctx.used, ctx.rng);
      const chars = (await sources.characters(anime.id)).data || [];
      const main = chars.filter((c) => String(c.role || '').toLowerCase() === 'main');
      const cast = (main.length >= 2 ? main : chars).slice(0, 4)
        .map((c) => ({ name: c.character?.name || 'Unknown', va: c.voiceActors?.[0]?.name || c.voice_actors?.[0]?.person?.name || null }));
      if (cast.length < 2) return null;
      return {
        view: { cast, choices: titleChoices(pool, anime, ctx.rng) },
        answer: String(anime.id),
        reveal: { text: anime.title },
        recap: recapFor(anime),
      };
    },
  },
  'name-that-opening': {
    ranked: true, lives: LIVES, minMs: 800, skippable: true,
    filter: (a) => a.title,
    deck: (pool) => poolForDifficulty(pool, 'easy'),
    async build(pool, ctx) {
      const anime = drawUnused(pool, ctx.used, ctx.rng);
      const openings = ((await sources.themes(anime.id)).data || []).filter((t) => t.type === 'OP' && t.videoUrl);
      if (!openings.length) return null;
      const theme = shuffle(openings, ctx.rng)[0];
      return {
        view: { videoUrl: theme.videoUrl, choices: titleChoices(pool, anime, ctx.rng) },
        answer: String(anime.id),
        reveal: { text: `${anime.title}${theme.title ? ` — “${theme.title}”` : ''}` },
        recap: recapFor(anime, `${anime.title}${theme.title ? ` (${theme.title})` : ''}`),
      };
    },
  },
  'gta-easy': gtaGame('easy'),
  'guess-the-anime': gtaGame('normal'),
  'gta-hard': gtaGame('hard'),
  'gta-blitz': gtaGame('normal', { blitz: true }),
  timeline: {
    ranked: true, lives: LIVES, minMs: 1500,
    filter: (a) => Number(a.year) > 1900 && a.image,
    build(pool, ctx) {
      const count = ctx.streak >= 5 ? 5 : 4;
      const cards = drawDistinctYears(pool, count, ctx.rng, ctx.used) || drawDistinctYears(pool, 4, ctx.rng, ctx.used);
      if (!cards) return null;
      cards.forEach((a) => ctx.used.add(a.id));
      if (ctx.used.size >= pool.length - 5) ctx.used.clear();
      return {
        view: { cards: cards.map((a) => ({ id: String(a.id), title: a.title, image: a.image })) },
        answer: Object.fromEntries(cards.map((a) => [a.id, Number(a.year)])),
        reveal: { years: Object.fromEntries(cards.map((a) => [a.id, Number(a.year)])) },
        recap: { label: cards.map((a) => `${a.title} (${a.year})`).join(', '), href: null },
      };
    },
  },
};

let sources = {
  characters: (id) => animeSource.characters(id),
  themes: (id) => animeSource.themes(id),
};
// Test hook: the suite never calls the anime APIs.
export function setRoundSources(s) {
  sources = s ? { ...sources, ...s } : { characters: (id) => animeSource.characters(id), themes: (id) => animeSource.themes(id) };
}

// ---- Runs ----

// The run's deck, from one pool version: filtered for the game, by difficulty,
// sorted by id. Always rebuilt the same way, so each answer deals from
// exactly the deck the run started with.
const SLIM = ['id', 'title', 'title_english', 'image', 'members', 'year', 'type', 'studio', 'source', 'synopsis', 'genres', 'episodes'];
const slim = (a) => Object.fromEntries(SLIM.map((k) => [k, a[k] ?? null]));

function deckFor(def, fullPool) {
  if (def.puzzles) return [];
  const pool = fullPool.filter(def.filter);
  return (def.deck ? def.deck(pool) : pool).map(slim).sort((a, b) => a.id - b.id);
}

// The deck for a stored run, or null if its pool version is gone (versions
// outlive runs, so only a run abandoned for days hits that). Runs from before
// versions carry their own copy in `pool`.
async function deckOf(row) {
  const def = ROUND_GAMES[row.game];
  if (!row.pool_version) return JSON.parse(row.pool);
  if (def.puzzles) return [];
  const full = await getGamePoolVersion(row.pool_version);
  return full ? deckFor(def, full) : null;
}

async function buildRound(def, pool, ctx) {
  for (let i = 0; i < MAX_BUILD_TRIES; i += 1) {
    let round = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      round = await def.build(pool, ctx);
    } catch {
      round = null; // e.g. the song or cast lookup failed: try another show
    }
    if (round) return round;
  }
  return null;
}

// What the browser gets for the current round: never the answer.
function publicView(run, round, extra = {}) {
  return {
    runId: run.id,
    game: run.game,
    streak: Number(run.streak),
    lives: run.lives == null ? null : Number(run.lives),
    msLeft: run.ends_at == null ? null : Math.max(0, Number(run.ends_at) - Date.now()),
    skipsLeft: Number(run.skips),
    round: { no: Number(run.round_no), ...round.view, ...(round.cover ? { cover: `/api/games/rounds/${run.id}/cover?r=${run.round_no}` } : {}) },
    ...extra,
  };
}

export async function startRoundRun(game, { userId = null, seed = null, input = 'choices' }) {
  const def = ROUND_GAMES[game];
  const { version, pool: fullPool } = def.puzzles ? { version: null, pool: [] } : await getGamePoolSnapshot();
  const pool = deckFor(def, fullPool);
  if (!def.puzzles && pool.length < 8) return null;
  const rng = makeRng(seed ? hashString(`${game}:${seed}`) : crypto.randomBytes(4).readUInt32BE());
  const mode = { input: def.typed && input === 'typed' ? 'typed' : 'choices', seeded: Boolean(seed) };
  // A signed-in player's new run starts with what they saw in recent runs
  // marked used, so it deals unseen shows first. Challenge runs skip this:
  // they have to deal the same rounds to everyone.
  const used = new Set(userId && !seed ? await recentFor(userId, game) : []);
  const round = await buildRound(def, pool, { pool, rng, used, streak: 0, mode });
  if (!round) return null;
  const run = {
    id: crypto.randomBytes(16).toString('hex'), game, streak: 0, lives: def.lives, skips: def.skippable ? MAX_SKIPS : 0,
    round_no: 1, ends_at: def.blitzMs ? Date.now() + def.blitzMs : null,
  };
  await db.batch([
    { sql: 'DELETE FROM round_runs WHERE created_at < ?', args: [Date.now() - RUN_TTL_MS] },
    {
      sql: `INSERT INTO round_runs (id, user_id, game, mode, pool, pool_version, used, rng, round, round_no, streak, lives, skips, dealt_at, ends_at, created_at)
            VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
      args: [run.id, userId, game, JSON.stringify(mode), version, JSON.stringify([...used]), rng.state,
        JSON.stringify(round), run.lives, run.skips, Date.now(), run.ends_at, Date.now()],
    },
  ], 'write');
  // Typed answers come with the list of titles for the suggestions box.
  const titles = mode.input === 'typed' ? [...new Set(pool.flatMap((a) => [a.title, a.title_english].filter(Boolean)))].sort() : undefined;
  return publicView(run, round, titles ? { titles } : {});
}

export async function loadRoundRun(runId, userId) {
  const row = (await db.execute({ sql: 'SELECT * FROM round_runs WHERE id = ? AND finished = 0', args: [runId] })).rows[0];
  if (!row) return null;
  if ((row.user_id == null ? null : Number(row.user_id)) !== (userId ?? null)) return null;
  return row;
}

const timeUp = (row) => row.ends_at != null && Date.now() >= Number(row.ends_at);

async function recentFor(userId, game) {
  const row = (await db.execute({ sql: 'SELECT ids FROM game_recent WHERE user_id = ? AND game = ?', args: [userId, game] })).rows[0];
  return row ? JSON.parse(row.ids) : [];
}

async function endRun(row, fields = {}) {
  const res = await db.execute({
    sql: 'UPDATE round_runs SET finished = 1, streak = ?, lives = ? WHERE id = ? AND round_no = ? AND finished = 0',
    args: [fields.streak ?? Number(row.streak), fields.lives ?? row.lives, row.id, row.round_no],
  });
  if (res.rowsAffected !== 1) return false;
  // Remember what this run dealt (up to half the deck) for the next one.
  if (row.user_id != null && !JSON.parse(row.mode).seeded) {
    const size = ROUND_GAMES[row.game].puzzles ? EMOJI_PUZZLES.length : ((await deckOf(row))?.length || 0);
    const ids = JSON.parse(row.used).slice(-Math.max(1, Math.floor(size / 2)));
    await db.execute({
      sql: `INSERT INTO game_recent (user_id, game, ids) VALUES (?, ?, ?)
            ON CONFLICT(user_id, game) DO UPDATE SET ids = excluded.ids`,
      args: [row.user_id, row.game, JSON.stringify(ids)],
    });
  }
  return true;
}

// Judges one answer. `answer` is a choice id, `typed` a typed title, `order`
// Timeline's card ids oldest first, `giveUp` a typed-mode skip. Returns
//   { correct, reveal, recap, streak, lives, gameOver, next?, retry?, ranked, game }
// or { stale: true } when this round was already answered.
export async function answerRound(row, { answer, typed, order, giveUp }) {
  const def = ROUND_GAMES[row.game];
  const round = JSON.parse(row.round);
  let streak = Number(row.streak);
  let lives = row.lives == null ? null : Number(row.lives);
  // Sent once the round is decided: the right answer, to highlight it.
  const base = { ranked: def.ranked, game: row.game, reveal: round.reveal, recap: round.recap, solution: round.answer };

  if (timeUp(row)) {
    if (!(await endRun(row))) return { stale: true };
    return { ...base, correct: false, timeUp: true, gameOver: true, streak, lives };
  }

  let correct;
  if (row.game === 'timeline') {
    const ids = Object.keys(round.answer);
    const given = (order || []).map(String);
    correct = given.length === ids.length && new Set(given).size === ids.length && given.every((id) => ids.includes(id))
      && isChronological(given.map((id) => round.answer[id]));
  } else if (typed != null && !giveUp) {
    correct = typedGuessMatches(typed, round.answerAnime || {});
    // A typed miss costs a life but the round stays open, until lives run out.
    if (!correct && lives > 1) {
      const res = await db.execute({
        sql: 'UPDATE round_runs SET lives = lives - 1 WHERE id = ? AND round_no = ? AND lives = ? AND finished = 0',
        args: [row.id, row.round_no, lives],
      });
      if (!res.rowsAffected) return { stale: true };
      return { game: row.game, ranked: def.ranked, correct: false, retry: true, streak, lives: lives - 1, gameOver: false };
    }
  } else {
    correct = !giveUp && String(answer) === String(round.answer);
  }

  let endsAt = row.ends_at == null ? null : Number(row.ends_at);
  if (correct) streak += 1;
  else if (endsAt != null) endsAt -= def.penaltyMs;
  else lives -= 1;

  if ((lives != null && lives <= 0) || (endsAt != null && Date.now() >= endsAt)) {
    if (!(await endRun(row, { streak, lives }))) return { stale: true };
    return { ...base, correct, streak, lives, gameOver: true, timeUp: endsAt != null };
  }

  const pool = await deckOf(row);
  const rng = makeRng(Number(row.rng));
  const used = new Set(JSON.parse(row.used));
  const mode = JSON.parse(row.mode);
  // No deck (a pool version long gone) ends the run like running out of rounds.
  const next = pool && await buildRound(def, pool, { pool, rng, used, streak, mode });
  if (!next) {
    if (!(await endRun(row, { streak, lives }))) return { stale: true };
    return { ...base, correct, streak, lives, gameOver: true };
  }
  const res = await db.execute({
    sql: `UPDATE round_runs SET round = ?, round_no = round_no + 1, used = ?, rng = ?, streak = ?, lives = ?, ends_at = ?, dealt_at = ?
          WHERE id = ? AND round_no = ? AND finished = 0`,
    args: [JSON.stringify(next), JSON.stringify([...used]), rng.state, streak, lives, endsAt, Date.now(), row.id, row.round_no],
  });
  if (!res.rowsAffected) return { stale: true };
  const run = { ...row, streak, lives, ends_at: endsAt, round_no: Number(row.round_no) + 1 };
  return { ...base, correct, streak, lives, gameOver: false, next: publicView(run, next) };
}

// A round the browser can't play (a clip that won't load): a new one, no
// penalty, a few times per run.
export async function skipRound(row) {
  const def = ROUND_GAMES[row.game];
  if (!def.skippable || Number(row.skips) <= 0) return null;
  const pool = await deckOf(row);
  if (!pool) return null;
  const rng = makeRng(Number(row.rng));
  const used = new Set(JSON.parse(row.used));
  const next = await buildRound(def, pool, { pool, rng, used, streak: Number(row.streak), mode: JSON.parse(row.mode) });
  if (!next) return null;
  const res = await db.execute({
    sql: `UPDATE round_runs SET round = ?, round_no = round_no + 1, used = ?, rng = ?, skips = skips - 1, dealt_at = ?
          WHERE id = ? AND round_no = ? AND finished = 0`,
    args: [JSON.stringify(next), JSON.stringify([...used]), rng.state, Date.now(), row.id, row.round_no],
  });
  if (!res.rowsAffected) return null;
  return publicView({ ...row, skips: Number(row.skips) - 1, round_no: Number(row.round_no) + 1 }, next);
}

// Blitz: the clock ran out on the page. Ends the run once the server's own
// clock agrees (a second of slack for the network).
export async function finishTimedRun(row) {
  if (row.ends_at == null || Date.now() < Number(row.ends_at) - 1000) return null;
  if (!(await endRun(row))) return null;
  const round = JSON.parse(row.round);
  return { game: row.game, ranked: ROUND_GAMES[row.game].ranked, gameOver: true, timeUp: true, streak: Number(row.streak), reveal: round.reveal, recap: round.recap, solution: round.answer };
}

// The current round's cover (Guess the Anime), for the image proxy.
export function coverUrl(row) {
  return JSON.parse(row.round).cover || null;
}

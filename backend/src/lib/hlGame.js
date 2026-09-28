import crypto from 'node:crypto';
import { db } from './db.js';
import { getGamePoolSnapshot, getGamePoolVersion, setGamePool } from './gamePool.js';

// Higher or Lower, dealt and judged by the server (routes/games.js /hl/*), so
// its four leaderboards hold real streaks: the browser only ever sees the
// champion's number and the challenger's card, and learns the challenger's
// number after it has guessed. Each run stores its own deck, so a pool
// refresh mid-run can't change the answers.

export const HL_GAMES = {
  'higher-lower': (a) => Number(a.score),
  'hl-popularity': (a) => Number(a.members),
  'hl-episodes': (a) => Number(a.episodes),
  'hl-year': (a) => Number(a.year),
};
const VALID = {
  'higher-lower': (v) => v > 0,
  'hl-popularity': (v) => v > 0,
  'hl-episodes': (v) => v > 0,
  'hl-year': (v) => v > 1900,
};
export const SKIPS = 1;
// The least time between seeing a challenger and guessing. The page's own
// reveal animation already takes longer; this only stops scripted play.
export const MIN_GUESS_MS = 700;

// Test hook, kept for the Higher or Lower tests: sets the shared game pool.
export const setHlPool = setGamePool;

// ---- Seeded dealing: "challenge a friend" links deal the same deck. The
// generator's state is stored with the run so reshuffles stay repeatable. ----
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 with its state passed in and out: [float in [0,1), next state].
function rand(state) {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

export function shuffleSeeded(list, state) {
  const out = [...list];
  let s = state;
  for (let i = out.length - 1; i > 0; i -= 1) {
    let r;
    [r, s] = rand(s);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

// A tie counts as a win either way.
export const isCorrect = (direction, champion, challenger) => (direction === 'higher' ? challenger >= champion : challenger <= champion);

// ---- Runs ----

const card = (cards, id, withValue) => {
  const [value, title, image] = cards[id];
  return { mal_id: Number(id), title, image, ...(withValue ? { value } : {}) };
};

function view(run, cards) {
  return {
    runId: run.id,
    streak: Number(run.streak),
    skipsLeft: Number(run.skips),
    champion: card(cards, run.champion, true),
    challenger: card(cards, run.challenger, false),
  };
}

// Next challenger off the deck, reshuffling (without the champion) when empty.
function draw(deck, rngState, cards, champion) {
  let d = deck;
  let s = rngState;
  if (!d.length) [d, s] = shuffleSeeded(Object.keys(cards).map(Number).filter((id) => id !== champion).sort((a, b) => a - b), s);
  return { challenger: d[d.length - 1], deck: d.slice(0, -1), rng: s };
}

// {malId: [value, title, image]} for one mode, from one pool version. A run
// stores the version, not the cards, and rebuilds them the same way.
function cardsFrom(game, pool) {
  const valueOf = HL_GAMES[game];
  return Object.fromEntries(pool.filter((a) => VALID[game](valueOf(a))).map((a) => [a.id, [valueOf(a), a.title, a.image]]));
}

// The run's cards, or null if its pool version is gone. Runs from before
// versions carry their own copy.
async function cardsOf(row) {
  if (!row.pool_version) return JSON.parse(row.cards);
  const pool = await getGamePoolVersion(row.pool_version);
  return pool ? cardsFrom(row.game, pool) : null;
}

export async function startHlRun(game, { userId = null, seed = null }) {
  const { version, pool } = await getGamePoolSnapshot();
  const cards = cardsFrom(game, pool);
  const ids = Object.keys(cards).map(Number).sort((a, b) => a - b);
  if (ids.length < 8) return null;
  const [deck, rng] = shuffleSeeded(ids, seed ? hashString(String(seed)) : crypto.randomBytes(4).readUInt32BE());
  const champion = deck.pop();
  const next = draw(deck, rng, cards, champion);
  const run = {
    id: crypto.randomBytes(16).toString('hex'), streak: 0, skips: SKIPS, champion, challenger: next.challenger,
  };
  await db.batch([
    { sql: 'DELETE FROM hl_runs WHERE created_at < ?', args: [Date.now() - 24 * 60 * 60 * 1000] },
    {
      sql: `INSERT INTO hl_runs (id, user_id, game, cards, pool_version, deck, rng, champion, challenger, streak, skips, dealt_at, created_at)
            VALUES (?, ?, ?, '{}', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      args: [run.id, userId, game, version, JSON.stringify(next.deck), next.rng, champion, next.challenger, SKIPS, Date.now(), Date.now()],
    },
  ], 'write');
  return view(run, cards);
}

// The run, if it belongs to this visitor (a guest run to no account, an
// account's run only to that account) and is still going.
export async function loadHlRun(runId, userId) {
  const row = (await db.execute({ sql: 'SELECT * FROM hl_runs WHERE id = ? AND finished = 0', args: [runId] })).rows[0];
  if (!row) return null;
  if ((row.user_id == null ? null : Number(row.user_id)) !== (userId ?? null)) return null;
  return row;
}

// { correct, value, streak, gameOver, next? }. Guarded on the current
// challenger, so a double-sent guess can't count twice.
export async function guessHl(row, direction) {
  const cards = await cardsOf(row);
  // A run abandoned for days (its pool version pruned) just ends, unscored.
  if (!cards) {
    await db.execute({ sql: 'UPDATE hl_runs SET finished = 1 WHERE id = ?', args: [row.id] });
    return { correct: false, value: null, streak: Number(row.streak), gameOver: true, unscored: true };
  }
  const champ = cards[row.champion][0];
  const value = cards[row.challenger][0];
  const correct = isCorrect(direction, champ, value);
  if (!correct) {
    const res = await db.execute({ sql: 'UPDATE hl_runs SET finished = 1 WHERE id = ? AND challenger = ? AND finished = 0', args: [row.id, row.challenger] });
    return res.rowsAffected ? { correct: false, value, streak: Number(row.streak), gameOver: true } : null;
  }
  const champion = Number(row.challenger);
  const next = draw(JSON.parse(row.deck), Number(row.rng), cards, champion);
  const streak = Number(row.streak) + 1;
  const res = await db.execute({
    sql: `UPDATE hl_runs SET champion = ?, challenger = ?, deck = ?, rng = ?, streak = ?, dealt_at = ?
          WHERE id = ? AND challenger = ? AND finished = 0`,
    args: [champion, next.challenger, JSON.stringify(next.deck), next.rng, streak, Date.now(), row.id, row.challenger],
  });
  if (!res.rowsAffected) return null;
  return {
    correct: true, value, streak, gameOver: false,
    next: view({ ...row, champion, challenger: next.challenger, streak, skips: row.skips }, cards),
  };
}

export async function skipHl(row) {
  if (Number(row.skips) <= 0) return null;
  const cards = await cardsOf(row);
  if (!cards) return null;
  const next = draw(JSON.parse(row.deck), Number(row.rng), cards, Number(row.champion));
  const res = await db.execute({
    sql: 'UPDATE hl_runs SET challenger = ?, deck = ?, rng = ?, skips = skips - 1, dealt_at = ? WHERE id = ? AND challenger = ? AND skips > 0',
    args: [next.challenger, JSON.stringify(next.deck), next.rng, Date.now(), row.id, row.challenger],
  });
  if (!res.rowsAffected) return null;
  return view({ ...row, challenger: next.challenger, skips: Number(row.skips) - 1 }, cards);
}

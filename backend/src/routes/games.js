import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { getDailyChallenge } from '../lib/dailyChallenge.js';
import crypto from 'node:crypto';
import { GAMES, GAME_RULES } from '../lib/games.js';
import { dailyStats } from '../lib/gameStats.js';
import { getMangaDailyChallenge } from '../lib/mangaDaily.js';
import { HL_GAMES, MIN_GUESS_MS, startHlRun, loadHlRun, guessHl, skipHl } from '../lib/hlGame.js';

export const gamesRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Public - today's shared mystery anime, identical for every visitor. The
// frontend still gets the answer's full title/synopsis in the JSON (same as
// Guess the Anime's existing pool-based mechanic) and only redacts it
// visually; there's no server-side "is this guess correct" check to keep
// consistent with how the other games already work, not an oversight.
gamesRouter.get('/daily', asyncRoute(async (req, res) => {
  res.json(await getDailyChallenge());
}));

const dailyResultSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  won: z.boolean(),
  rounds: z.number().int().min(1).max(4),
});

const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

// Records that the signed-in user played a given day's daily challenge, so
// the XP system can award it once per date (the result used to exist only
// in localStorage). Only today's or yesterday's UTC date is accepted - the
// window covers a player finishing just past midnight - so old dates can't
// be back-filled for XP. ON CONFLICT DO NOTHING makes replays idempotent,
// and a second POST can't flip a recorded loss into a win.
gamesRouter.post('/daily/result', requireAuth, asyncRoute(async (req, res) => {
  const parsed = dailyResultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input.' });
  const { date, won, rounds } = parsed.data;
  if (date !== isoDay(0) && date !== isoDay(-1)) return res.status(400).json({ error: 'That daily challenge is no longer open.' });

  const result = await db.execute({
    sql: 'INSERT INTO daily_results (user_id, date, won, rounds) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, date) DO NOTHING',
    args: [req.user.id, date, won ? 1 : 0, rounds],
  });
  res.json({ recorded: Number(result.rowsAffected) > 0 });
}));

// The manga daily: same rules as the anime one above, its own tables.
gamesRouter.get('/manga-daily', asyncRoute(async (req, res) => {
  res.json(await getMangaDailyChallenge());
}));

gamesRouter.post('/manga-daily/result', requireAuth, asyncRoute(async (req, res) => {
  const parsed = dailyResultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input.' });
  const { date, won, rounds } = parsed.data;
  if (date !== isoDay(0) && date !== isoDay(-1)) return res.status(400).json({ error: 'That daily challenge is no longer open.' });

  const result = await db.execute({
    sql: 'INSERT INTO manga_daily_results (user_id, date, won, rounds) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, date) DO NOTHING',
    args: [req.user.id, date, won ? 1 : 0, rounds],
  });
  res.json({ recorded: Number(result.rowsAffected) > 0 });
}));

// A hard ceiling on any streak, well beyond real play (deck sizes and human
// endurance) - a sanity bound on top of the time check below.
const MAX_STREAK = 300;

// The least time one correct round can honestly take lives with each game's
// entry in lib/games.js (GAME_RULES[game].minMsPerRound).
const MAX_RUNS_PER_HOUR = 200;
const RUN_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

const scoreSchema = z.object({
  streak: z.number().int().min(0).max(MAX_STREAK),
  run_id: z.string().regex(/^[0-9a-f]{32}$/),
});

// Only ever raises a player's best for a game, never lowers it, and logs
// every accepted score for the weekly board and stats. Returns the best.
async function recordScore(userId, game, streak) {
  await db.execute({
    sql: 'INSERT INTO game_score_log (user_id, game, score, created_at) VALUES (?, ?, ?, ?)',
    args: [userId, game, streak, Date.now()],
  });
  await db.execute({
    sql: `
      INSERT INTO game_scores (user_id, game, best_streak, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, game) DO UPDATE SET
        updated_at = CASE WHEN excluded.best_streak > best_streak THEN excluded.updated_at ELSE updated_at END,
        best_streak = MAX(best_streak, excluded.best_streak)
    `,
    args: [userId, game, streak],
  });
  const row = await db.execute({ sql: 'SELECT best_streak FROM game_scores WHERE user_id = ? AND game = ?', args: [userId, game] });
  return Number(row.rows[0].best_streak);
}

async function tooManyRuns(userId) {
  const since = Date.now() - 60 * 60 * 1000;
  const recent = await db.execute({
    sql: `SELECT (SELECT COUNT(*) FROM game_runs WHERE user_id = ? AND started_at > ?)
               + (SELECT COUNT(*) FROM hl_runs WHERE user_id = ? AND created_at > ?) AS n`,
    args: [userId, since, userId, since],
  });
  return Number(recent.rows[0].n) >= MAX_RUNS_PER_HOUR;
}

// ---- Higher or Lower, dealt and judged by the server (lib/hlGame.js).
// Anyone can play; only a signed-in player's run reaches the leaderboard,
// recorded by the server when the run ends. ----

const hlStartSchema = z.object({
  game: z.enum(Object.keys(HL_GAMES)),
  seed: z.string().regex(/^[a-z0-9]{1,16}$/).nullable().optional(),
});

gamesRouter.post('/hl/start', asyncRoute(async (req, res) => {
  const parsed = hlStartSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Unknown game.' });
  if (req.user && await tooManyRuns(req.user.id)) return res.status(429).json({ error: 'Slow down a little.' });
  const run = await startHlRun(parsed.data.game, { userId: req.user?.id ?? null, seed: parsed.data.seed || null });
  if (!run) return res.status(503).json({ error: 'Not enough anime data for this mode right now. Try another one!' });
  res.status(201).json(run);
}));

const hlGuessSchema = z.object({ direction: z.enum(['higher', 'lower']) });
const runIdOk = (id) => /^[0-9a-f]{32}$/.test(id);

gamesRouter.post('/hl/:runId/guess', asyncRoute(async (req, res) => {
  const parsed = hlGuessSchema.safeParse(req.body);
  const row = parsed.success && runIdOk(req.params.runId) ? await loadHlRun(req.params.runId, req.user?.id) : null;
  if (!row) return res.status(404).json({ error: 'That game has ended. Start a new one!' });
  if (Date.now() - Number(row.dealt_at) < MIN_GUESS_MS) return res.status(429).json({ error: 'Too fast! Take a look first.' });
  const out = await guessHl(row, parsed.data.direction);
  if (!out) return res.status(409).json({ error: 'That round was already answered.' });
  if (out.gameOver && row.user_id != null) out.best = await recordScore(Number(row.user_id), row.game, out.streak);
  res.json(out);
}));

gamesRouter.post('/hl/:runId/skip', asyncRoute(async (req, res) => {
  const row = runIdOk(req.params.runId) ? await loadHlRun(req.params.runId, req.user?.id) : null;
  if (!row) return res.status(404).json({ error: 'That game has ended. Start a new one!' });
  const next = await skipHl(row);
  if (!next) return res.status(409).json({ error: 'No skips left.' });
  res.json(next);
}));

// Called when a signed-in player starts a game. The returned run id is
// single-use and is the only thing that lets a score be submitted.
// Higher or Lower's modes don't use this: the server judges those itself.
gamesRouter.post('/:game/start', requireAuth, asyncRoute(async (req, res) => {
  const { game } = req.params;
  if (!GAMES.includes(game)) return res.status(400).json({ error: 'Unknown game.' });
  if (HL_GAMES[game]) return res.status(400).json({ error: 'This game is scored by the server.' });

  if (await tooManyRuns(req.user.id)) return res.status(429).json({ error: 'Slow down a little.' });

  // Housekeeping: old runs are useless (a score can't be plausible days later).
  await db.execute({ sql: 'DELETE FROM game_runs WHERE started_at < ?', args: [Date.now() - RUN_RETENTION_MS] });

  const runId = crypto.randomBytes(16).toString('hex');
  await db.execute({
    sql: 'INSERT INTO game_runs (id, user_id, game, started_at) VALUES (?, ?, ?, ?)',
    args: [runId, req.user.id, game, Date.now()],
  });
  res.status(201).json({ runId });
}));

// Only ever raises a user's own best for a game, never lowers it - a client
// re-posting a stale/lower streak (e.g. two tabs) can't clobber a better one
// already on record.
gamesRouter.post('/:game/score', requireAuth, asyncRoute(async (req, res) => {
  const { game } = req.params;
  if (!GAMES.includes(game)) return res.status(400).json({ error: 'Unknown game.' });
  if (HL_GAMES[game]) return res.status(400).json({ error: 'This game is scored by the server.' });
  const parsed = scoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { streak, run_id: runId } = parsed.data;

  // Claim the run atomically FIRST: a run can be submitted exactly once, so a
  // rejected attempt can't be retried with a different number to probe the
  // threshold, and two concurrent requests can't both succeed.
  const claim = await db.execute({
    sql: 'UPDATE game_runs SET submitted = 1 WHERE id = ? AND user_id = ? AND game = ? AND submitted = 0',
    args: [runId, req.user.id, game],
  });
  if (!Number(claim.rowsAffected)) return res.status(400).json({ error: 'Unknown or already-used game run.' });

  const run = await db.execute({ sql: 'SELECT started_at FROM game_runs WHERE id = ?', args: [runId] });
  const elapsedMs = Date.now() - Number(run.rows[0].started_at);
  const rules = GAME_RULES[game];
  if (streak * rules.minMsPerRound > elapsedMs || (rules.maxScore && streak > rules.maxScore)) {
    return res.status(400).json({ error: "That score doesn't add up for the time played." });
  }

  res.json({ best: await recordScore(req.user.id, game, streak) });
}));

const LEADERBOARD_LIMIT = 20;
const WEEK_MS = 7 * 86_400_000;

// Public - no account needed to see who's on top, same spirit as public
// profiles. If the caller is signed in and has a score, also reports their
// own rank (even when it's outside the top 20) so "you're #47" is possible
// without fetching the whole table.
//
// ?period=week ranks each player's best score from the last 7 days (from
// game_score_log) instead of their all-time best; the row shape is the same.
gamesRouter.get('/:game/leaderboard', asyncRoute(async (req, res) => {
  const { game } = req.params;
  if (!GAMES.includes(game)) return res.status(400).json({ error: 'Unknown game.' });
  const weekly = req.query.period === 'week';

  if (weekly) {
    const since = Date.now() - WEEK_MS;
    const top = await db.execute({
      sql: `
        SELECT u.username, MAX(l.score) AS best_streak, MIN(l.created_at) AS first_at
        FROM game_score_log l JOIN users u ON u.id = l.user_id
        WHERE l.game = ? AND l.created_at > ?
        GROUP BY l.user_id
        ORDER BY best_streak DESC, first_at ASC
        LIMIT ${LEADERBOARD_LIMIT}
      `,
      args: [game, since],
    });
    let myRank = null;
    let myBest = null;
    if (req.user) {
      const mine = await db.execute({
        sql: 'SELECT MAX(score) AS best FROM game_score_log WHERE user_id = ? AND game = ? AND created_at > ?',
        args: [req.user.id, game, since],
      });
      if (mine.rows[0].best != null) {
        myBest = Number(mine.rows[0].best);
        const ahead = await db.execute({
          sql: `SELECT COUNT(*) AS ahead FROM (
                  SELECT user_id, MAX(score) AS best FROM game_score_log
                  WHERE game = ? AND created_at > ? GROUP BY user_id
                ) WHERE best > ?`,
          args: [game, since, myBest],
        });
        myRank = Number(ahead.rows[0].ahead) + 1;
      }
    }
    const leaderboard = top.rows.map((r) => ({ username: r.username, best_streak: Number(r.best_streak) }));
    return res.json({ leaderboard, myRank, myBest, period: 'week' });
  }

  const top = await db.execute({
    sql: `
      SELECT u.username, gs.best_streak, gs.updated_at
      FROM game_scores gs JOIN users u ON u.id = gs.user_id
      WHERE gs.game = ?
      ORDER BY gs.best_streak DESC, gs.updated_at ASC
      LIMIT ${LEADERBOARD_LIMIT}
    `,
    args: [game],
  });

  let myRank = null;
  let myBest = null;
  if (req.user) {
    const mine = await db.execute({ sql: 'SELECT best_streak FROM game_scores WHERE user_id = ? AND game = ?', args: [req.user.id, game] });
    if (mine.rows.length) {
      myBest = Number(mine.rows[0].best_streak);
      const ahead = await db.execute({
        sql: 'SELECT COUNT(*) AS ahead FROM game_scores WHERE game = ? AND best_streak > ?',
        args: [game, myBest],
      });
      myRank = Number(ahead.rows[0].ahead) + 1;
    }
  }

  res.json({ leaderboard: top.rows, myRank, myBest, period: 'all' });
}));

// The signed-in player's own numbers across every game: best (all-time and
// this week), plays and leaderboard rank per game, plus both dailies' win
// streaks and guess distributions. Powers the "My Game Stats" page.
gamesRouter.get('/me/stats', requireAuth, asyncRoute(async (req, res) => {
  const uid = req.user.id;
  const since = Date.now() - WEEK_MS;
  const [bests, plays, weekly, daily, mangaDaily] = await Promise.all([
    db.execute({ sql: 'SELECT game, best_streak FROM game_scores WHERE user_id = ?', args: [uid] }),
    db.execute({ sql: 'SELECT game, COUNT(*) AS n, SUM(score) AS total FROM game_score_log WHERE user_id = ? GROUP BY game', args: [uid] }),
    db.execute({ sql: 'SELECT game, MAX(score) AS best FROM game_score_log WHERE user_id = ? AND created_at > ? GROUP BY game', args: [uid, since] }),
    db.execute({ sql: 'SELECT date, won, rounds FROM daily_results WHERE user_id = ? ORDER BY date', args: [uid] }),
    db.execute({ sql: 'SELECT date, won, rounds FROM manga_daily_results WHERE user_id = ? ORDER BY date', args: [uid] }),
  ]);

  const games = {};
  const ensure = (g) => { games[g] ||= { best: 0, plays: 0, total: 0, weekBest: 0, rank: null }; return games[g]; };
  for (const r of bests.rows) ensure(r.game).best = Number(r.best_streak);
  for (const r of plays.rows) { const g = ensure(r.game); g.plays = Number(r.n); g.total = Number(r.total) || 0; }
  for (const r of weekly.rows) ensure(r.game).weekBest = Number(r.best) || 0;

  await Promise.all(Object.entries(games).filter(([, g]) => g.best > 0).map(async ([game, g]) => {
    const ahead = await db.execute({
      sql: 'SELECT COUNT(*) AS ahead FROM game_scores WHERE game = ? AND best_streak > ?',
      args: [game, g.best],
    });
    g.rank = Number(ahead.rows[0].ahead) + 1;
  }));

  res.json({
    games,
    daily: dailyStats(daily.rows),
    mangaDaily: dailyStats(mangaDaily.rows),
  });
}));

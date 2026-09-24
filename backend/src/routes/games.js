import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { getDailyChallenge } from '../lib/dailyChallenge.js';
import { GAMES } from '../lib/games.js';

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

const MAX_STREAK = 100_000; // defensive sanity ceiling, not a real gameplay cap

const scoreSchema = z.object({
  streak: z.number().int().min(0).max(MAX_STREAK),
});

// Only ever raises a user's own best for a game, never lowers it - a client
// re-posting a stale/lower streak (e.g. two tabs) can't clobber a better one
// already on record.
gamesRouter.post('/:game/score', requireAuth, asyncRoute(async (req, res) => {
  const { game } = req.params;
  if (!GAMES.includes(game)) return res.status(400).json({ error: 'Unknown game.' });
  const parsed = scoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { streak } = parsed.data;

  await db.execute({
    sql: `
      INSERT INTO game_scores (user_id, game, best_streak, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, game) DO UPDATE SET
        updated_at = CASE WHEN excluded.best_streak > best_streak THEN excluded.updated_at ELSE updated_at END,
        best_streak = MAX(best_streak, excluded.best_streak)
    `,
    args: [req.user.id, game, streak],
  });

  const row = await db.execute({ sql: 'SELECT best_streak FROM game_scores WHERE user_id = ? AND game = ?', args: [req.user.id, game] });
  res.json({ best: Number(row.rows[0].best_streak) });
}));

const LEADERBOARD_LIMIT = 20;

// Public - no account needed to see who's on top, same spirit as public
// profiles. If the caller is signed in and has a score, also reports their
// own rank (even when it's outside the top 20) so "you're #47" is possible
// without fetching the whole table.
gamesRouter.get('/:game/leaderboard', asyncRoute(async (req, res) => {
  const { game } = req.params;
  if (!GAMES.includes(game)) return res.status(400).json({ error: 'Unknown game.' });

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

  res.json({ leaderboard: top.rows, myRank, myBest });
}));

import { Router } from 'express';
import { cached } from '../lib/cache.js';
import { computeXp } from '../lib/xp.js';
import { loadXpInputs } from '../lib/xpStats.js';

export const leaderboardRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const LEADERBOARD_LIMIT = 20;
// Ranking everyone means reading every user's activity, so the full sorted
// table is cached briefly; a leaderboard being a couple of minutes behind is
// fine, a full scan per page view is not.
const XP_BOARD_TTL_MS = 2 * 60 * 1000;

function rankedTable() {
  return cached('leaderboard:xp', XP_BOARD_TTL_MS, async () => {
    const all = await loadXpInputs();
    return [...all.entries()]
      .map(([id, inputs]) => {
        const xp = computeXp(inputs);
        return { id, username: inputs.username, xp: xp.total, level: xp.level, title: xp.title };
      })
      .filter((row) => row.xp > 0)
      .sort((a, b) => b.xp - a.xp || a.username.localeCompare(b.username));
  });
}

// Public, same spirit as the game leaderboards: top 20, plus the caller's own
// rank even when it's outside the top 20.
leaderboardRouter.get('/xp', asyncRoute(async (req, res) => {
  const table = await rankedTable();
  const leaderboard = table.slice(0, LEADERBOARD_LIMIT).map(({ username, xp, level, title }) => ({ username, xp, level, title }));

  let myRank = null;
  let myXp = null;
  if (req.user) {
    const index = table.findIndex((row) => row.id === req.user.id);
    if (index !== -1) { myRank = index + 1; myXp = table[index].xp; }
  }
  res.json({ leaderboard, myRank, myXp });
}));

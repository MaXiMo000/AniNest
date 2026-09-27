import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { isSeason } from '../lib/tournament.js';
import {
  SHOW_COUNT, ensureLeague, findLeague, leagueById, leagueSeason, leagueView, now, savePicks,
} from '../lib/predictions.js';

// Season prediction league (lib/predictions.js has the rules). Anyone can
// look; picking needs an account.
export const predictionsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

predictionsRouter.get('/current', asyncRoute(async (req, res) => {
  const { season, year } = leagueSeason(now());
  const league = await ensureLeague(season, year);
  res.json({ season, year, data: league ? await leagueView(league, req.user?.id) : null });
}));

predictionsRouter.get('/seasons', asyncRoute(async (_req, res) => {
  const rows = await db.execute(`
    SELECT season, year FROM prediction_leagues
    ORDER BY year DESC, CASE season WHEN 'FALL' THEN 4 WHEN 'SUMMER' THEN 3 WHEN 'SPRING' THEN 2 ELSE 1 END DESC`);
  res.json({ seasons: rows.rows.map((r) => ({ season: r.season, year: Number(r.year) })) });
}));

// An earlier league. Read only: nothing is snapshotted for a season that never had one.
predictionsRouter.get('/:year/:season', asyncRoute(async (req, res) => {
  const year = Number(req.params.year);
  const season = String(req.params.season).toUpperCase();
  if (!isSeason(season, year)) return res.status(400).json({ error: 'Unknown season.' });
  const league = await findLeague(season, year);
  res.json({ season, year, data: league ? await leagueView(league, req.user?.id) : null });
}));

const picksSchema = z.object({
  picks: z.array(z.object({
    mal_id: z.number().int().positive(),
    score: z.number().min(1).max(10).nullable(),
  })).min(1).max(SHOW_COUNT),
});

predictionsRouter.post('/:id/picks', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const league = Number.isInteger(id) && id > 0 ? await leagueById(id) : null;
  if (!league) return res.status(404).json({ error: 'No such league.' });
  const parsed = picksSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Scores go from 1.0 to 10.0.' });
  const problem = await savePicks(league, req.user.id, parsed.data.picks);
  if (problem) return res.status(409).json({ error: problem });
  res.json({ data: await leagueView(league, req.user.id) });
}));

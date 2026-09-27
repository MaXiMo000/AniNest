import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { KINDS, headlineSeason, isSeason, voteProblem } from '../lib/tournament.js';
import { ensureTournament, findTournament, tournamentById, bracketFor, tournamentView, now } from '../lib/tournamentStore.js';

// Season OP/ED tournament: "Best Opening" and "Best Ending" of a season as
// 16-song brackets, songs from the jukebox. Anyone can watch; voting needs an
// account (one vote per match, changeable until the round closes).
export const tournamentsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const kindOf = (raw) => (KINDS.includes(String(raw || '').toUpperCase()) ? String(raw).toUpperCase() : 'OP');

async function respond(req, res, found, { season, year, kind }) {
  if (found.pending) return res.json({ data: null, pending: true, season, year, kind });
  if (!found.row) return res.json({ data: null, season, year, kind });
  res.json({ data: await tournamentView(found.row, req.user?.id) });
}

// The season the page leads with (lib/tournament.js headlineSeason), built on
// first request.
tournamentsRouter.get('/current', asyncRoute(async (req, res) => {
  const { season, year } = headlineSeason(new Date(now()));
  const kind = kindOf(req.query.kind);
  await respond(req, res, await ensureTournament(season, year, kind), { season, year, kind });
}));

// An earlier season's bracket, e.g. /2026/summer?kind=ED. Read only: nothing
// is built for a season that never had one, so this can't be used to make
// the server walk arbitrary seasons.
tournamentsRouter.get('/:year/:season', asyncRoute(async (req, res) => {
  const year = Number(req.params.year);
  const season = String(req.params.season).toUpperCase();
  if (!isSeason(season, year)) return res.status(400).json({ error: 'Unknown season.' });
  const kind = kindOf(req.query.kind);
  const row = await findTournament(season, year, kind);
  await respond(req, res, row ? { row } : {}, { season, year, kind });
}));

const voteSchema = z.object({
  round: z.number().int().min(1).max(4),
  match: z.number().int().min(0).max(7),
  seed: z.number().int().min(1).max(16),
});

tournamentsRouter.post('/:id/vote', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) && id > 0 ? await tournamentById(id) : null;
  if (!row) return res.status(404).json({ error: 'No such tournament.' });
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid vote.' });
  const problem = voteProblem(await bracketFor(row), parsed.data);
  if (problem) return res.status(409).json({ error: problem });

  await db.execute({
    sql: `INSERT INTO theme_tournament_votes (tournament_id, user_id, round, match, seed) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(tournament_id, user_id, round, match) DO UPDATE SET seed = excluded.seed, voted_at = datetime('now')`,
    args: [row.id, req.user.id, parsed.data.round, parsed.data.match, parsed.data.seed],
  });
  res.json({ data: await tournamentView(row, req.user.id) });
}));

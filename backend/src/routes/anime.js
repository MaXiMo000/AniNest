import { Router } from 'express';
import * as animeSource from '../lib/animeSource.js';

export const animeRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Anime ids in these routes are numeric MAL ids used purely to look up public,
// already-published anime metadata — never used to reach into any private
// resource, so no auth/ownership check applies here.
function parseAnimeId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

animeRouter.get('/top', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const filter = ['airing', 'upcoming', 'bypopularity', 'favorite'].includes(req.query.filter) ? req.query.filter : undefined;
  res.json(await animeSource.topAnime(page, filter));
}));

animeRouter.get('/season/now', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json(await animeSource.seasonNow(page));
}));

const ALLOWED_ORDER_BY = new Set(['popularity', 'score', 'start_date', 'title']);
const ALLOWED_TYPE = new Set(['tv', 'movie', 'ova', 'special', 'ona', 'music']);
const ALLOWED_STATUS = new Set(['airing', 'complete', 'upcoming']);

animeRouter.get('/search', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined;
  const genresParam = typeof req.query.genres === 'string'
    ? req.query.genres.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).join(',')
    : undefined;
  const type = ALLOWED_TYPE.has(req.query.type) ? req.query.type : undefined;
  const status = ALLOWED_STATUS.has(req.query.status) ? req.query.status : undefined;
  const orderBy = ALLOWED_ORDER_BY.has(req.query.order_by) ? req.query.order_by : undefined;
  const sort = req.query.sort === 'asc' ? 'asc' : 'desc';
  const minScoreRaw = Number(req.query.min_score);
  const minScore = Number.isFinite(minScoreRaw) && minScoreRaw > 0 && minScoreRaw <= 10 ? minScoreRaw : undefined;
  res.json(await animeSource.search({ q, genres: genresParam, type, status, order_by: orderBy, sort, page, minScore }));
}));

const VALID_SCHEDULE_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

animeRouter.get('/schedule', asyncRoute(async (req, res) => {
  const day = String(req.query.day || '').toLowerCase();
  if (!VALID_SCHEDULE_DAYS.has(day)) return res.status(400).json({ error: 'day must be a lowercase weekday name.' });
  res.json(await animeSource.schedule(day));
}));

animeRouter.get('/genres', asyncRoute(async (_req, res) => {
  res.json(await animeSource.genres());
}));

animeRouter.get('/random', asyncRoute(async (_req, res) => {
  res.json(await animeSource.randomAnime());
}));

animeRouter.get('/:id/full', asyncRoute(async (req, res) => {
  const id = parseAnimeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid anime id.' });
  res.json(await animeSource.fullById(id));
}));

animeRouter.get('/:id/recommendations', asyncRoute(async (req, res) => {
  const id = parseAnimeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid anime id.' });
  res.json(await animeSource.recommendations(id));
}));

animeRouter.get('/:id/characters', asyncRoute(async (req, res) => {
  const id = parseAnimeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid anime id.' });
  res.json(await animeSource.characters(id));
}));

animeRouter.get('/:id/themes', asyncRoute(async (req, res) => {
  const id = parseAnimeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid anime id.' });
  res.json({ data: await animeSource.themes(id) });
}));

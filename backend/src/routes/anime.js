import { Router } from 'express';
import * as animeSource from '../lib/animeSource.js';
import { db } from '../lib/db.js';
import { franchiseForAnime } from '../lib/franchiseStore.js';
import { vibeSearch } from '../lib/vibeSearch.js';

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

// Plain-English search ("cozy fantasy, under 13 episodes, no romance"). See
// lib/vibeParser.js for what's understood; `understood: false` means nothing
// was, and the frontend falls back to a title search.
animeRouter.get('/vibe', asyncRoute(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length > 200) return res.status(400).json({ error: 'Describe what you want to watch in up to 200 characters.' });
  res.json(await vibeSearch(q));
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
  res.json(await animeSource.themes(id)); // { data, source: 'animethemes' | 'myanimelist' }
}));

// Legal free-to-watch episode links (curated official YouTube uploads -
// Muse Asia, Ani-One Asia, Crunchyroll's own channel), never a scraped/
// piracy source. Public/no auth, same tier as this file's other routes -
// only ever returns 'approved' rows, so a pending or rejected submission
// (see animeWatchSources.js/adminWatchSources.js) is invisible here
// regardless of who's asking.
animeRouter.get('/:id/watch-sources', asyncRoute(async (req, res) => {
  const id = parseAnimeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid anime id.' });
  const result = await db.execute({
    sql: `SELECT id, youtube_video_id, channel_name, label, allowed_regions, blocked_regions, checked_at FROM anime_watch_sources
          WHERE mal_id = ? AND status = 'approved' ORDER BY created_at ASC`,
    args: [id],
  });
  // Region lists are JSON text in the table; null means "plays everywhere" (or not checked yet).
  const regions = (text) => (text ? JSON.parse(text) : null);
  res.json({ data: result.rows.map((r) => ({ ...r, allowed_regions: regions(r.allowed_regions), blocked_regions: regions(r.blocked_regions) })) });
}));

// "Part of the X franchise" banner on the detail page. A first build walks
// AniList and can take a while, so the frontend loads this after the page.
// A failed build (AniList down or rate-limited) just means no banner.
animeRouter.get('/:id/franchise', asyncRoute(async (req, res) => {
  const id = parseAnimeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid anime id.' });
  try {
    res.json(await franchiseForAnime(id));
  } catch (err) {
    req.log.warn({ err, id }, 'franchise lookup failed');
    res.json({ data: null });
  }
}));

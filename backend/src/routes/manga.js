import { Router } from 'express';
import * as mangadex from '../lib/mangadex.js';

export const mangaRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Manga ids are MangaDex UUIDs used purely to look up public, already-
// published bibliographic metadata - never used to reach into any private
// resource, so no auth/ownership check applies here (same reasoning as
// anime.js's parseAnimeId).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseMangaId(raw) {
  return typeof raw === 'string' && UUID_RE.test(raw) ? raw : null;
}

const ALLOWED_DEMOGRAPHIC = new Set(['shounen', 'shoujo', 'josei', 'seinen']);
const ALLOWED_STATUS = new Set(['ongoing', 'completed', 'hiatus', 'cancelled']);
const ALLOWED_SORT = new Set(['popular', 'latest', 'newest', 'title', 'relevance']);

mangaRouter.get('/search', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined;
  const tags = typeof req.query.tags === 'string'
    ? req.query.tags.split(',').filter((id) => mangadex.isCuratedTag(id))
    : undefined;
  const demographic = ALLOWED_DEMOGRAPHIC.has(req.query.demographic) ? req.query.demographic : undefined;
  const status = ALLOWED_STATUS.has(req.query.status) ? req.query.status : undefined;
  const sort = ALLOWED_SORT.has(req.query.sort) ? req.query.sort : undefined;
  res.json(await mangadex.mangaSearch({ q, tags, demographic, status, sort, page }));
}));

// MangaDex serves a "you can read this at mangadex.org" placeholder image
// to browsers whose Referer is another website (localhost happens to pass,
// which is why this only broke in production), so covers are fetched
// server-side and re-served from here instead of hotlinked by every
// visitor's browser. Strictly allowlisted (fixed host, UUID + filename
// shape only - no user-controlled URL ever reaches fetch), size-capped, and
// cached hard so each cover costs MangaDex roughly one request, not one per
// page view.
const COVER_FILE_RE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif)$/i;
const COVER_CACHE_MAX = 300;
const coverCache = new Map();

mangaRouter.get('/cover/:id/:file', asyncRoute(async (req, res) => {
  const { id, file } = req.params;
  if (!parseMangaId(id) || !COVER_FILE_RE.test(file)) return res.status(400).json({ error: 'Invalid cover.' });

  const key = `${id}/${file}`;
  let buf = coverCache.get(key);
  if (!buf) {
    const upstream = await fetch(`https://uploads.mangadex.org/covers/${id}/${file}.512.jpg`, {
      headers: { 'User-Agent': 'AniNest/1.0 (+https://aninest-frontend.onrender.com)' },
    });
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) return res.status(404).json({ error: 'Cover not found.' });
    buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) return res.status(404).json({ error: 'Cover not found.' });
    if (coverCache.size >= COVER_CACHE_MAX) coverCache.delete(coverCache.keys().next().value);
    coverCache.set(key, buf);
  }
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.send(buf);
}));

mangaRouter.get('/tags', asyncRoute(async (_req, res) => {
  res.json({ data: mangadex.CURATED_TAGS });
}));

mangaRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = parseMangaId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid manga id.' });
  res.json(await mangadex.mangaById(id));
}));

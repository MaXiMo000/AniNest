import { Router } from 'express';
import { cached } from '../lib/cache.js';
import { persistentCached } from '../lib/persistentCache.js';
import { logger } from '../lib/logger.js';

// Visual novels from VNDB's public API (api.vndb.org/kana, keyless; 200
// requests per 5 minutes, so everything here is cached). Same safety line as
// the rest of the site: a VN only shows up if it has a release rated under 18
// and isn't tagged for sexual content, covers VNDB rates suggestive or worse
// are hidden, and store links come only from those all-ages releases and only
// from an allowlist of official stores.
export const visualNovelsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const API = 'https://api.vndb.org/kana';
const SAFE = [['release', '=', ['minage', '<', 18]], ['tag', '!=', 'g23']]; // g23: "Sexual Content"
// Free to play for real: an official, complete, all-ages release that's
// freeware. (Unofficial fan patches and trials are marked freeware too.)
const FREE_RELEASE = ['and', ['freeware', '=', 1], ['official', '=', 1], ['patch', '!=', 1], ['rtype', '=', 'complete'], ['minage', '<', 18]];
const SORTS = { popular: 'votecount', rating: 'rating', newest: 'released' };
const STORE_LABEL = /^(official website|steam|gog(\.com)?|itch\.io|nintendo.*|playstation.*|xbox.*|microsoft store|app store|google play|humble.*|mangagamer|jast usa|sekai project)$/i;

async function livePost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniNest (+https://aninest-frontend.onrender.com)' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`VNDB error ${res.status}`), { status: res.status >= 500 || res.status === 429 ? 502 : res.status });
  return res.json();
}
let post = livePost;
// Test hook: the suite never calls VNDB.
export function setVndbPost(fn) { post = fn || livePost; }

const image = (img) => (img?.url && Number(img.sexual) < 0.5 ? img.url : null);
const card = (v) => ({
  id: v.id,
  title: v.title,
  alttitle: v.alttitle || null,
  image: image(v.image),
  released: v.released || null,
  rating: v.rating != null ? Math.round(v.rating) / 10 : null,
  votes: v.votecount || 0,
  hours: v.length_minutes ? Math.round(v.length_minutes / 60) : null,
});
const CARD_FIELDS = 'title, alttitle, image.url, image.sexual, released, rating, votecount, length_minutes';

// VNDB's own markup: links keep their text, spoilers are dropped entirely.
export function plainDescription(text = '') {
  return String(text)
    .replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\/?[a-z]+[^\]]*\]/gi, '')
    .trim();
}

visualNovelsRouter.get('/search', asyncRoute(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const sort = SORTS[req.query.sort] ? req.query.sort : 'popular';
  const free = req.query.free === '1';
  const page = Math.min(50, Math.max(1, Number(req.query.page) || 1));
  const filters = ['and', ...SAFE,
    ...(q ? [['search', '=', q]] : []),
    ...(free ? [['release', '=', FREE_RELEASE]] : []),
    ...(sort === 'newest' ? [['released', '<=', 'today']] : []),
  ];
  const key = `vn:search:${q.toLowerCase()}:${sort}:${free}:${page}`;
  const out = await cached(key, 10 * 60 * 1000, async () => {
    const json = await post('/vn', {
      filters, fields: CARD_FIELDS, sort: q ? 'searchrank' : SORTS[sort], reverse: !q, results: 24, page,
    });
    return { data: (json.results || []).map(card), hasNext: Boolean(json.more) };
  });
  res.json(out);
}));

async function loadVn(id) {
  const [vn, releases] = await Promise.all([
    post('/vn', {
      filters: ['and', ['id', '=', id], ...SAFE],
      fields: `${CARD_FIELDS}, description, platforms, developers.name, tags.name, tags.category, tags.rating, tags.spoiler`,
    }),
    post('/release', {
      filters: ['and', ['vn', '=', ['id', '=', id]], ['minage', '<', 18], ['official', '=', 1]],
      fields: 'freeware, patch, vns.rtype, languages.lang, extlinks.url, extlinks.label',
      results: 50,
    }),
  ]);
  const v = vn.results?.[0];
  if (!v) return null;
  const rels = releases.results || [];
  // English releases' links first, one per address.
  const english = (r) => (r.languages || []).some((l) => l.lang === 'en');
  const seen = new Set();
  const links = [...rels.filter(english), ...rels.filter((r) => !english(r))]
    .flatMap((r) => r.extlinks || [])
    .filter((l) => STORE_LABEL.test(l.label || '') && /^https?:\/\//.test(l.url || '') && !seen.has(l.url) && seen.add(l.url));
  // One link per store (the first, English releases first), stores before the official website.
  const byLabel = new Map();
  for (const l of links) if (!byLabel.has(l.label.toLowerCase())) byLabel.set(l.label.toLowerCase(), l);
  const unique = [...byLabel.values()];
  const official = unique.find((l) => /^official website$/i.test(l.label));
  const stores = [...unique.filter((l) => l !== official).slice(0, 8), ...(official ? [official] : [])]
    .map((l) => ({ label: l.label, url: l.url }));
  return {
    ...card(v),
    description: plainDescription(v.description) || null,
    developers: (v.developers || []).map((d) => d.name).slice(0, 4),
    platforms: v.platforms || [],
    tags: (v.tags || [])
      .filter((t) => t.category === 'cont' && Number(t.spoiler) === 0 && Number(t.rating) >= 1.5)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 8)
      .map((t) => t.name),
    free: rels.some((r) => r.freeware && !r.patch && (r.vns || []).some((x) => x.id === id && x.rtype === 'complete')),
    stores,
    vndbUrl: `https://vndb.org/${v.id}`,
  };
}

visualNovelsRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = /^v\d{1,7}$/.test(req.params.id) ? req.params.id : null;
  if (!id) return res.status(400).json({ error: 'Invalid visual novel id.' });
  const data = await cached(`vn:full:${id}`, 30 * 60 * 1000, () => persistentCached(`vn:full:v2:${id}`, 24 * 60 * 60 * 1000, async () => {
    const found = await loadVn(id);
    // Thrown so a missing or filtered-out VN is never stored or served stale.
    if (!found) throw Object.assign(new Error('Visual novel not found.'), { status: 404 });
    return found;
  })).catch((err) => {
    if (err.status !== 404) logger.warn({ err, id }, 'VNDB lookup failed');
    throw err;
  });
  res.json({ data });
}));

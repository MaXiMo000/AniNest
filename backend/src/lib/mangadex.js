// MangaDex: a free, keyless public API of manga bibliographic metadata
// (title, cover, synopsis, tags, author, publication status). Proxied
// through our own backend, same rule as every other third-party API this
// app uses - the browser never calls it directly (see animeSource.js).
//
// Deliberately metadata-only. This module must never call MangaDex's
// /chapter or /at-home endpoints, and must never return chapter/page image
// URLs or chapter content - AniNest's existing stance is "no streaming of
// actual episodes" for anime (piracy-scraper APIs declined on copyright
// grounds, see HANDOFF.md), and the manga equivalent holds the same line:
// MangaDex's chapter content is scanlation-heavy/mixed-licensing, unlike
// its metadata. Actual reading happens via generated search-link-out to
// official sources (MANGA Plus/VIZ/Webtoons), built entirely client-side
// from a manga's title - see frontend's mangaDetail.js "Read For Free" box.
import { cached } from './cache.js';
import { persistentCached } from './persistentCache.js';

const BASE = 'https://api.mangadex.org';

const TTL = {
  list: 10 * 60 * 1000,
  detail: 30 * 60 * 1000,
};

// MangaDex enforces a hard global rate limit and, unlike trace.moe/
// AnimeThemes (one-shot lookups), this lib gets hit on every browse-page
// keystroke/paginate - shares Jikan's shared-pacer treatment (jikan.js)
// rather than firing requests unpaced.
const MIN_GAP_MS = 300;
let queue = Promise.resolve();
let lastCallAt = 0;

function scheduled(fn) {
  const run = () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCallAt));
    return new Promise((resolve) => setTimeout(resolve, wait)).then(() => {
      lastCallAt = Date.now();
      return fn();
    });
  };
  queue = queue.then(run, run);
  return queue;
}

// MangaDex sits behind Cloudflare, same as AnimeThemes.moe - a normal
// browser-like UA is required or requests 403 (see animeThemes.js).
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

async function mangadexGet(path, searchParams) {
  const url = new URL(BASE + path);
  for (const [k, v] of searchParams) url.searchParams.append(k, v);

  return scheduled(async () => {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const err = new Error(`MangaDex error ${res.status} on ${path}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

// Content safety: MangaDex's contentRating is one of safe/suggestive/
// erotica/pornographic. Every listing/search call passes this explicitly
// and unconditionally - not a frontend-only filter a direct API call could
// bypass - mirroring traceMoe.js's isAdult filter precedent. 'suggestive'
// is deliberately excluded, not just erotica/pornographic - live testing
// against real search results showed it still surfaces plenty of ecchi/
// fanservice-leaning doujinshi, which is more permissive than this site's
// existing anime-side stance (browse.js's EXCLUDED_GENRE_IDS drops Hentai/
// Ecchi/Erotica genres outright to "keep the site SFW") - 'safe' only
// keeps manga content on the same footing.
const SAFE_CONTENT_RATINGS = ['safe'];

function localized(field, fallback = '') {
  if (!field) return fallback;
  return field.en || Object.values(field)[0] || fallback;
}

function coverFileName(relationships) {
  const cover = relationships.find((r) => r.type === 'cover_art');
  return cover?.attributes?.fileName || null;
}

function authorName(relationships) {
  const author = relationships.find((r) => r.type === 'author');
  return author?.attributes?.name || null;
}

function normalizeManga(raw) {
  const a = raw.attributes;
  const fileName = coverFileName(raw.relationships || []);
  return {
    id: raw.id,
    title: localized(a.title, 'Untitled'),
    altTitles: (a.altTitles || []).map((t) => localized(t)).filter(Boolean),
    description: localized(a.description),
    // MangaDex only returns a cover filename via the cover_art relationship,
    // not a full URL - build the flat image URL server-side so the frontend
    // gets one string, same convention as imageOf() flattening Jikan/
    // AniList's nested image shapes for anime.
    coverImage: fileName ? `https://uploads.mangadex.org/covers/${raw.id}/${fileName}.512.jpg` : null,
    tags: (a.tags || []).map((t) => ({ id: t.id, name: localized(t.attributes?.name, 'Unknown'), group: t.attributes?.group })),
    status: a.status || null,
    year: a.year || null,
    demographic: a.publicationDemographic || null,
    contentRating: a.contentRating || null,
    originalLanguage: a.originalLanguage || null,
    author: authorName(raw.relationships || []),
  };
}

// 'latest' orders by latestUploadedChapter - MangaDex's own "just updated
// with a new chapter" signal, the manga equivalent of anime browse's
// "Newest" tab in spirit (surfaces active/currently-releasing titles)
// though technically closest to createdAt for "newest added to the site".
// Both are offered separately so neither meaning gets silently dropped.
const SORT_ORDER_PARAMS = {
  popular: ['order[followedCount]', 'desc'],
  latest: ['order[latestUploadedChapter]', 'desc'],
  newest: ['order[createdAt]', 'desc'],
  title: ['order[title]', 'asc'],
  relevance: ['order[relevance]', 'desc'],
};

export function mangaSearch({ q, tags, demographic, status, sort, page = 1 } = {}) {
  const sortKey = SORT_ORDER_PARAMS[sort] ? sort : (q ? 'relevance' : 'popular');
  const key = `manga:search:${q || ''}:${(tags || []).join(',')}:${demographic || ''}:${status || ''}:${sortKey}:${page}`;
  return cached(key, TTL.list, async () => {
    const limit = 20;
    const offset = Math.max(0, (Math.max(1, page) - 1) * limit);
    const params = [
      ['limit', String(limit)],
      ['offset', String(offset)],
      ['includes[]', 'cover_art'],
      ['includes[]', 'author'],
      SORT_ORDER_PARAMS[sortKey],
    ];
    for (const r of SAFE_CONTENT_RATINGS) params.push(['contentRating[]', r]);
    if (q) params.push(['title', q]);
    for (const t of tags || []) params.push(['includedTags[]', t]);
    if (demographic) params.push(['publicationDemographic[]', demographic]);
    if (status) params.push(['status[]', status]);

    const json = await mangadexGet('/manga', params);
    return { data: (json.data || []).map(normalizeManga), total: json.total || 0 };
  });
}

// The latest-chapter id MangaDex reports for each of up to 100 manga, from the
// MANGA endpoint's own metadata (attributes.latestUploadedChapter) - used only
// to notice that a new chapter exists (see lib/mangaUpdates.js). Chapter
// content and the /chapter endpoints are never touched. Uncached on purpose:
// the whole point is to see what changed since last time.
export async function mangaLatestChapters(ids) {
  const params = [['limit', String(Math.min(100, ids.length))], ['contentRating[]', 'safe']];
  for (const id of ids) params.push(['ids[]', id]);
  const json = await mangadexGet('/manga', params);
  return new Map((json.data || []).map((m) => [m.id, m.attributes?.latestUploadedChapter || null]));
}

export function mangaById(id) {
  // Also kept in our own database and served from there if MangaDex is down
  // (lib/persistentCache.js) - but never past a definitive 404, which is how
  // the content-rating safety check below rejects an unsafe title.
  return cached(`manga:full:${id}`, TTL.detail, () => persistentCached(`manga:full:${id}`, 24 * 60 * 60 * 1000, async () => {
    const params = [['includes[]', 'cover_art'], ['includes[]', 'author']];
    const json = await mangadexGet(`/manga/${id}`, params);
    if (!json.data) {
      const err = new Error('Manga not found.');
      err.status = 404;
      throw err;
    }
    const manga = normalizeManga(json.data);
    // A title in an unsafe content rating can still be fetched by direct id -
    // enforce the same safety line on single-item lookups as on search/list.
    if (!SAFE_CONTENT_RATINGS.includes(manga.contentRating)) {
      const err = new Error('Manga not found.');
      err.status = 404;
      throw err;
    }
    return { data: manga };
  }));
}

// Curated subset of MangaDex's ~80 UUID-keyed tags, verified live against
// GET /manga/tag (full taxonomy is out of scope for this slice - mirrors
// animeSource.js's STATIC_GENRES precedent for a hand-picked, recognizable
// list rather than exhaustive support).
export const CURATED_TAGS = [
  { id: '391b0423-d847-456f-aff0-8b0cfc03066b', name: 'Action' },
  { id: '87cc87cd-a395-47af-b27a-93258283bbc6', name: 'Adventure' },
  { id: '4d32cc48-9f00-4cca-9b5a-a839f0764984', name: 'Comedy' },
  { id: 'b9af3a63-f058-46de-a9a0-e0c13906197a', name: 'Drama' },
  { id: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc', name: 'Fantasy' },
  { id: 'cdad7e68-1419-41dd-bdce-27753074a640', name: 'Horror' },
  { id: 'ace04997-f6bd-436e-b261-779182193d3d', name: 'Isekai' },
  { id: '799c202e-7daa-44eb-9cf7-8a3c0441531e', name: 'Martial Arts' },
  { id: '50880a9d-5440-4732-9afb-8f457127e836', name: 'Mecha' },
  { id: 'ee968100-4191-4968-93d3-f82d72be7e46', name: 'Mystery' },
  { id: '3b60b75c-a2d7-4860-ab56-05f391bb889c', name: 'Psychological' },
  { id: '423e2eae-a7a2-4a8b-ac03-a8351462d71d', name: 'Romance' },
  { id: 'caaa44eb-cd40-4177-b930-79d3ef2afe87', name: 'School Life' },
  { id: '256c8bd9-4904-4360-bf4f-508a76d67183', name: 'Sci-Fi' },
  { id: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9', name: 'Slice of Life' },
  { id: '69964a64-2f90-4d33-beeb-f3ed2875eb4c', name: 'Sports' },
  { id: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75', name: 'Supernatural' },
  { id: 'f8f62932-27da-4fe4-8ee1-6779a8c5edba', name: 'Tragedy' },
];

const CURATED_TAG_IDS = new Set(CURATED_TAGS.map((t) => t.id));
export function isCuratedTag(id) {
  return CURATED_TAG_IDS.has(id);
}

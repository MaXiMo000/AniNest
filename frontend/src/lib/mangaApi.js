// Manga metadata goes through OUR backend (see backend/src/routes/manga.js),
// which proxies MangaDex - the browser never talks to MangaDex directly.
// Mirrors api.js's Api object but as its own small, independent module
// (same relationship reviewsApi.js/gamesApi.js have to api.js today).

import { apiGet } from './http.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const memCache = new Map();

async function cachedGet(key, path) {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.v;
  const value = await apiGet(path);
  memCache.set(key, { t: Date.now(), v: value });
  return value;
}

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const MangaApi = {
  search: (params) => apiGet(`/api/manga/search${qs(params)}`), // never cache search — query-specific
  tags: () => cachedGet('manga:tags', '/api/manga/tags'),
  byId: (id) => cachedGet(`manga:full:${id}`, `/api/manga/${id}`),
};

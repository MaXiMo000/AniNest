// Anime data goes through OUR backend (see backend/src/routes/anime.js),
// which queues/caches/paces requests to Jikan (and falls back to AniList)
// on behalf of every visitor sharing this deployment. The browser never
// talks to Jikan or AniList directly anymore.

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

export const Api = {
  topAnime: (page = 1, filter) => cachedGet(`top:${page}:${filter || ''}`, `/api/anime/top${qs({ page, filter })}`),
  seasonNow: (page = 1) => cachedGet(`season:${page}`, `/api/anime/season/now${qs({ page })}`),
  schedule: (day) => cachedGet(`schedule:${day}`, `/api/anime/schedule${qs({ day })}`),
  search: (params) => apiGet(`/api/anime/search${qs(params)}`), // never cache search — results are query-specific and often one-shot
  genres: () => cachedGet('genres', '/api/anime/genres'),
  fullById: (id) => cachedGet(`full:${id}`, `/api/anime/${id}/full`),
  recommendations: (id) => cachedGet(`recs:${id}`, `/api/anime/${id}/recommendations`),
  randomAnime: () => apiGet('/api/anime/random'),
};

export function imageOf(anime) {
  return (
    anime?.images?.webp?.large_image_url ||
    anime?.images?.jpg?.large_image_url ||
    anime?.images?.webp?.image_url ||
    anime?.images?.jpg?.image_url ||
    ''
  );
}

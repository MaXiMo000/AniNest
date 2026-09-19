import { jikanGet } from './jikan.js';
import { anilistTopAnime, anilistSeasonNow, anilistSearch, anilistByMalId, anilistRandomish } from './anilist.js';
import { cached } from './cache.js';

const TTL = {
  list: 10 * 60 * 1000,
  detail: 30 * 60 * 1000,
  genres: 24 * 60 * 60 * 1000,
};

const STATIC_GENRES = [
  { mal_id: 1, name: 'Action' }, { mal_id: 2, name: 'Adventure' }, { mal_id: 4, name: 'Comedy' },
  { mal_id: 8, name: 'Drama' }, { mal_id: 10, name: 'Fantasy' }, { mal_id: 14, name: 'Horror' },
  { mal_id: 7, name: 'Mystery' }, { mal_id: 22, name: 'Romance' }, { mal_id: 24, name: 'Sci-Fi' },
  { mal_id: 36, name: 'Slice of Life' }, { mal_id: 30, name: 'Sports' }, { mal_id: 37, name: 'Supernatural' },
  { mal_id: 27, name: 'Shounen' }, { mal_id: 25, name: 'Shoujo' }, { mal_id: 41, name: 'Thriller' },
  { mal_id: 18, name: 'Mecha' }, { mal_id: 19, name: 'Music' }, { mal_id: 40, name: 'Psychological' },
];

// Every list-style function tries Jikan first (richer, MAL-curated data,
// including official "where to watch" streaming links) and transparently
// falls back to AniList if Jikan is down or its own upstream (MyAnimeList)
// is having a bad day — see README for why we bother with two sources.
async function withFallback(key, ttl, primary, fallback) {
  return cached(key, ttl, async () => {
    try {
      return await primary();
    } catch (err) {
      console.warn(`[animeSource] primary failed for ${key}: ${err.message}. Falling back to AniList.`);
      return fallback();
    }
  });
}

export function topAnime(page = 1, filter) {
  return withFallback(
    `top:${page}:${filter || ''}`,
    TTL.list,
    () => jikanGet('/top/anime', { page, filter, sfw: true }),
    () => anilistTopAnime(page),
  );
}

const VALID_SCHEDULE_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

// No AniList fallback here: AniList's equivalent (querying airingSchedules
// within a date range) returns individual episode air-times rather than a
// clean "everything that airs on Tuesdays" grouping, and mapping between the
// two isn't worth it for one feature — if Jikan is down, this section just
// shows the same per-section retry prompt every other section already uses.
export function schedule(day) {
  if (!VALID_SCHEDULE_DAYS.has(day)) return Promise.reject(new Error('Invalid schedule day.'));
  return cached(`schedule:${day}`, TTL.list, () => jikanGet('/schedules', { filter: day, sfw: true }));
}

export function seasonNow(page = 1) {
  return withFallback(
    `season:${page}`,
    TTL.list,
    () => jikanGet('/seasons/now', { page, sfw: true }),
    () => anilistSeasonNow(page),
  );
}

export function search({ q, genres, type, status, order_by: orderBy, sort, page = 1 }) {
  const key = `search:${q || ''}:${genres || ''}:${type || ''}:${status || ''}:${orderBy || ''}:${sort || ''}:${page}`;
  return withFallback(
    key,
    TTL.list,
    () => jikanGet('/anime', { q, genres, type, status, order_by: orderBy, sort, page, sfw: true }),
    () => anilistSearch({ q, genres, type, status, order_by: orderBy, sort, page }),
  );
}

export function genres() {
  return withFallback(
    'genres',
    TTL.genres,
    () => jikanGet('/genres/anime'),
    () => ({ data: STATIC_GENRES }),
  );
}

export function fullById(id) {
  return withFallback(
    `full:${id}`,
    TTL.detail,
    () => jikanGet(`/anime/${id}/full`),
    async () => {
      const result = await anilistByMalId(Number(id));
      if (!result?.full) throw new Error('Not found on AniList either.');
      return { data: result.full };
    },
  );
}

export function recommendations(id) {
  return withFallback(
    `recs:${id}`,
    TTL.detail,
    () => jikanGet(`/anime/${id}/recommendations`),
    async () => {
      const result = await anilistByMalId(Number(id));
      return { data: result?.recommendations || [] };
    },
  );
}

export async function randomAnime() {
  try {
    return await jikanGet('/random/anime');
  } catch (err) {
    console.warn(`[animeSource] random via Jikan failed: ${err.message}. Falling back to AniList.`);
    const data = await anilistRandomish();
    if (!data) throw new Error('No anime available from either source right now.');
    return { data };
  }
}

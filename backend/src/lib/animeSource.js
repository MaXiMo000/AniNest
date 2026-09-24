import { jikanGet } from './jikan.js';
import { anilistTopAnime, anilistSeasonNow, anilistSearch, anilistByMalId, anilistRandomish, anilistSchedule, anilistCharacters } from './anilist.js';
import { animeThemesFor } from './animeThemes.js';
import { cached } from './cache.js';
import { persistentCached } from './persistentCache.js';
import { logger } from './logger.js';

const TTL = {
  list: 10 * 60 * 1000,
  detail: 30 * 60 * 1000,
  genres: 24 * 60 * 60 * 1000,
};

// How long our own stored copy counts as fresh before we ask upstream again
// (it is still served as a last resort when upstream is down, however old).
const PERSIST = {
  list: 6 * 60 * 60 * 1000,        // top / season / schedule pages
  detail: 24 * 60 * 60 * 1000,     // one anime's detail, characters, recommendations
  themes: 7 * 24 * 60 * 60 * 1000, // opening/ending lists barely ever change
};

const STATIC_GENRES = [
  { mal_id: 1, name: 'Action' }, { mal_id: 2, name: 'Adventure' }, { mal_id: 4, name: 'Comedy' },
  { mal_id: 8, name: 'Drama' }, { mal_id: 10, name: 'Fantasy' }, { mal_id: 14, name: 'Horror' },
  { mal_id: 7, name: 'Mystery' }, { mal_id: 22, name: 'Romance' }, { mal_id: 24, name: 'Sci-Fi' },
  { mal_id: 36, name: 'Slice of Life' }, { mal_id: 30, name: 'Sports' }, { mal_id: 37, name: 'Supernatural' },
  { mal_id: 27, name: 'Shounen' }, { mal_id: 25, name: 'Shoujo' }, { mal_id: 41, name: 'Thriller' },
  { mal_id: 18, name: 'Mecha' }, { mal_id: 19, name: 'Music' }, { mal_id: 40, name: 'Psychological' },
];

// Every list-style function tries AniList first — a genuine first-party API
// (not a scraper) with a materially higher rate limit than Jikan (~90/min vs
// Jikan's ~60/min shared globally) and, empirically, far better uptime — and
// transparently falls back to Jikan if AniList itself has a bad moment. See
// README for why we bother with two sources at all.
//
// `persistMs`, when given, adds a third safety net UNDER both sources: the
// answer is also kept in our own database (lib/persistentCache.js) and, if
// AniList AND Jikan are both down, the last stored copy is served instead of
// an error. Only for bounded key spaces (a given anime, a list page) - never
// for free-text search.
async function withFallback(key, ttl, primaryName, primary, fallbackName, fallback, persistMs) {
  const compute = async () => {
    try {
      return await primary();
    } catch (err) {
      logger.warn({ err, key, primaryName, fallbackName }, `${primaryName} failed, falling back to ${fallbackName}`);
      return fallback();
    }
  };
  return cached(key, ttl, persistMs ? () => persistentCached(`anime:${key}`, persistMs, compute) : compute);
}

export function topAnime(page = 1, filter) {
  return withFallback(
    `top:${page}:${filter || ''}`,
    TTL.list,
    'AniList', () => anilistTopAnime(page),
    'Jikan', () => jikanGet('/top/anime', { page, filter, sfw: true }),
    PERSIST.list,
  );
}

const VALID_SCHEDULE_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

export function schedule(day) {
  if (!VALID_SCHEDULE_DAYS.has(day)) return Promise.reject(new Error('Invalid schedule day.'));
  return withFallback(
    `schedule:${day}`,
    TTL.list,
    'AniList', () => anilistSchedule(day),
    'Jikan', () => jikanGet('/schedules', { filter: day, sfw: true }),
    PERSIST.list,
  );
}

export function seasonNow(page = 1) {
  return withFallback(
    `season:${page}`,
    TTL.list,
    'AniList', () => anilistSeasonNow(page),
    'Jikan', () => jikanGet('/seasons/now', { page, sfw: true }),
    PERSIST.list,
  );
}

// Applied locally after fetching, rather than pushed into each upstream's
// own query syntax - Jikan has a native `min_score` param but AniList's
// equivalent filter works on a 0-100 `averageScore` scale, and translating
// between the two consistently is more complexity than it's worth when a
// simple post-filter behaves identically regardless of which source served
// the page. Trade-off: a filtered page can come back with fewer than the
// usual ~20 results.
function filterByMinScore(result, minScore) {
  if (!minScore) return result;
  return { ...result, data: (result.data || []).filter((a) => (a.score || 0) >= minScore) };
}

export function search({ q, genres, type, status, order_by: orderBy, sort, page = 1, minScore }) {
  const key = `search:${q || ''}:${genres || ''}:${type || ''}:${status || ''}:${orderBy || ''}:${sort || ''}:${page}:${minScore || ''}`;
  return withFallback(
    key,
    TTL.list,
    'AniList', async () => filterByMinScore(await anilistSearch({ q, genres, type, status, order_by: orderBy, sort, page }), minScore),
    'Jikan', async () => filterByMinScore(await jikanGet('/anime', { q, genres, type, status, order_by: orderBy, sort, page, sfw: true }), minScore),
  );
}

// Genres stay Jikan-first: it's the lightest-weight, least-often-failing
// endpoint (small static-ish payload), and the static fallback list below
// already covers an outage without needing a network round-trip to AniList.
export function genres() {
  return withFallback(
    'genres',
    TTL.genres,
    'Jikan', () => jikanGet('/genres/anime'),
    'static list', () => ({ data: STATIC_GENRES }),
  );
}

// Detail pages keep Jikan as a fallback (not dropped entirely) because it
// carries fields AniList doesn't have: rank, popularity, duration, MAL's own
// content rating, and curated "where to watch" streaming links.
export function fullById(id) {
  return withFallback(
    `full:${id}`,
    TTL.detail,
    'AniList', async () => {
      const result = await anilistByMalId(Number(id));
      if (!result?.full) throw new Error('Not found on AniList.');
      return { data: result.full };
    },
    'Jikan', () => jikanGet(`/anime/${id}/full`),
    PERSIST.detail,
  );
}

export function recommendations(id) {
  return withFallback(
    `recs:${id}`,
    TTL.detail,
    'AniList', async () => {
      const result = await anilistByMalId(Number(id));
      return { data: result?.recommendations || [] };
    },
    'Jikan', () => jikanGet(`/anime/${id}/recommendations`),
    PERSIST.detail,
  );
}

const CHARACTERS_LIMIT = 12;

// Jikan's characters payload has a very different shape from AniList's -
// normalize it down to the same { character: {name, image}, role,
// voiceActors: [{name, image}] } shape anilistCharacters() already returns,
// so the frontend never needs to know which source served a given request.
function normalizeJikanCharacters(list) {
  return list.slice(0, CHARACTERS_LIMIT).map((c) => ({
    character: {
      name: c.character?.name || 'Unknown',
      image: c.character?.images?.jpg?.image_url || c.character?.images?.webp?.image_url || '',
    },
    role: c.role || null,
    voiceActors: (c.voice_actors || [])
      .filter((va) => va.language === 'Japanese')
      .map((va) => ({ name: va.person?.name || 'Unknown', image: va.person?.images?.jpg?.image_url || '' })),
  }));
}

export function characters(id) {
  return withFallback(
    `chars:${id}`,
    TTL.detail,
    'AniList', async () => ({ data: await anilistCharacters(Number(id)) }),
    'Jikan', async () => {
      const res = await jikanGet(`/anime/${id}/characters`);
      return { data: normalizeJikanCharacters(res.data || []) };
    },
    PERSIST.detail,
  );
}

// No Jikan fallback - AnimeThemes.moe has no equivalent on either existing
// source, so this is a single-source lookup like fullById's Jikan-specific
// fields, just without a fallback at all. A show with nothing indexed
// (brand new, or simply never added) resolves to an empty array, not an
// error - confirmed directly against the live API.
//
// Persisted for a week and served stale when AnimeThemes is down (it has had
// full outages): the opening/ending LIST for a show essentially never
// changes. The video files themselves still come from AnimeThemes' own
// host, so during an outage the list shows but playback may not work.
export function themes(id) {
  return cached(`themes:${id}`, TTL.detail, () => persistentCached(`anime:themes:${id}`, PERSIST.themes, () => animeThemesFor(Number(id))));
}

export async function randomAnime() {
  try {
    const data = await anilistRandomish();
    if (!data) throw new Error('No anime available from AniList right now.');
    return { data };
  } catch (err) {
    logger.warn({ err }, 'random via AniList failed, falling back to Jikan');
    return jikanGet('/random/anime');
  }
}

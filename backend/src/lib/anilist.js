// Fallback data source. AniList's public GraphQL API is free, keyless, and
// has a much higher rate limit (~90 req/min) than Jikan (~60 req/min shared
// across every Jikan user worldwide), so when Jikan is unavailable or our
// own cache+queue can't keep up, we transparently fall back to AniList and
// reshape its response to look like the Jikan payloads the frontend expects.

const ANILIST_URL = 'https://graphql.anilist.co';

const GENRE_NAME_TO_MAL_ID = {
  Action: 1, Adventure: 2, Cars: 3, Comedy: 4, Drama: 8, Fantasy: 10,
  Horror: 14, Mahou_Shoujo: 16, Mecha: 18, Music: 19, Mystery: 7,
  Psychological: 40, Romance: 22, 'Sci-Fi': 24, 'Slice of Life': 36,
  Sports: 30, Supernatural: 37, Thriller: 41, Ecchi: 9, Hentai: 12,
};

const FORMAT_MAP = { TV: 'TV', TV_SHORT: 'TV', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };
const STATUS_MAP = {
  RELEASING: 'Currently Airing',
  FINISHED: 'Finished Airing',
  NOT_YET_RELEASED: 'Not yet aired',
  CANCELLED: 'Cancelled',
  HIATUS: 'On Hiatus',
};

// Reverse of the maps above, used to translate our /api/anime/search filter
// params (which mirror Jikan's vocabulary) into AniList's GraphQL enums when
// a search falls back to AniList. Only genres that exist in AniList's fixed
// genre enum are covered — Jikan's larger genre+theme list (Shounen, Isekai,
// School, ...) has no AniList equivalent, so those are simply dropped rather
// than guessed at.
const MAL_TYPE_TO_ANILIST_FORMAT = { tv: 'TV', movie: 'MOVIE', ova: 'OVA', special: 'SPECIAL', ona: 'ONA', music: 'MUSIC' };
const MAL_STATUS_TO_ANILIST_STATUS = { airing: 'RELEASING', complete: 'FINISHED', upcoming: 'NOT_YET_RELEASED' };
const MAL_GENRE_ID_TO_ANILIST_NAME = {
  1: 'Action', 2: 'Adventure', 4: 'Comedy', 8: 'Drama', 9: 'Ecchi', 10: 'Fantasy',
  12: 'Hentai', 14: 'Horror', 18: 'Mecha', 19: 'Music', 7: 'Mystery', 40: 'Psychological',
  22: 'Romance', 24: 'Sci-Fi', 36: 'Slice of Life', 30: 'Sports', 37: 'Supernatural', 41: 'Thriller',
};

function anilistSortFor(orderBy, sort) {
  const desc = sort !== 'asc';
  switch (orderBy) {
    case 'score': return desc ? 'SCORE_DESC' : 'SCORE';
    case 'start_date': return desc ? 'START_DATE_DESC' : 'START_DATE';
    case 'title': return desc ? 'TITLE_ROMAJI_DESC' : 'TITLE_ROMAJI';
    case 'popularity':
    default: return desc ? 'POPULARITY' : 'POPULARITY_DESC'; // Jikan's popularity RANK ascending = most popular first = AniList's raw popularity COUNT descending
  }
}

function stripHtml(html) {
  return (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function mapGenres(genreNames = []) {
  return genreNames.map((name) => ({ mal_id: GENRE_NAME_TO_MAL_ID[name] || 0, name }));
}

const MEDIA_FIELDS = `
  id idMal
  title { romaji english }
  coverImage { extraLarge large }
  averageScore episodes format season seasonYear status source
  description(asHtml: false)
  genres
  studios(isMain: true) { nodes { name } }
  trailer { id site }
  siteUrl
`;

export function normalizeAniListMedia(m) {
  if (!m || !m.idMal) return null;
  const image = m.coverImage?.extraLarge || m.coverImage?.large || '';
  const title = m.title?.english || m.title?.romaji || 'Untitled';
  const trailerEmbed = m.trailer?.site === 'youtube' && m.trailer?.id
    ? `https://www.youtube.com/embed/${m.trailer.id}`
    : null;
  return {
    mal_id: m.idMal,
    title,
    title_english: m.title?.english && m.title.english !== title ? m.title.english : undefined,
    type: FORMAT_MAP[m.format] || m.format || 'TV',
    episodes: m.episodes ?? null,
    score: m.averageScore != null ? Math.round(m.averageScore) / 10 : null,
    year: m.seasonYear ?? null,
    synopsis: stripHtml(m.description) || null,
    genres: mapGenres(m.genres),
    themes: [],
    studios: (m.studios?.nodes || []).map((s) => ({ name: s.name })),
    source: m.source ? m.source.replaceAll('_', ' ') : null,
    season: m.season ? m.season.toLowerCase() : null,
    status: STATUS_MAP[m.status] || m.status || null,
    rank: null,
    popularity: null,
    members: null,
    aired: { string: [m.season, m.seasonYear].filter(Boolean).join(' ') || null },
    duration: null,
    rating: null,
    trailer: trailerEmbed ? { embed_url: trailerEmbed } : {},
    streaming: [],
    url: m.siteUrl,
    images: {
      jpg: { image_url: image, large_image_url: image },
      webp: { image_url: image, large_image_url: image },
    },
  };
}

async function gql(query, variables) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList error ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`AniList error: ${json.errors[0].message}`);
  return json.data;
}

function currentSeason() {
  const month = new Date().getMonth();
  const year = new Date().getFullYear();
  const season = month <= 2 ? 'WINTER' : month <= 5 ? 'SPRING' : month <= 8 ? 'SUMMER' : 'FALL';
  return { season, year };
}

export async function anilistTopAnime(page = 1) {
  const data = await gql(`
    query($page: Int) {
      Page(page: $page, perPage: 20) {
        pageInfo { hasNextPage }
        media(type: ANIME, sort: SCORE_DESC, isAdult: false) { ${MEDIA_FIELDS} }
      }
    }
  `, { page });
  return {
    data: data.Page.media.map(normalizeAniListMedia).filter(Boolean),
    pagination: { has_next_page: data.Page.pageInfo.hasNextPage },
  };
}

export async function anilistSeasonNow(page = 1) {
  const { season, year } = currentSeason();
  const data = await gql(`
    query($page: Int, $season: MediaSeason, $year: Int) {
      Page(page: $page, perPage: 20) {
        pageInfo { hasNextPage }
        media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_FIELDS} }
      }
    }
  `, { page, season, year });
  return {
    data: data.Page.media.map(normalizeAniListMedia).filter(Boolean),
    pagination: { has_next_page: data.Page.pageInfo.hasNextPage },
  };
}

export async function anilistSearch({ q, genres, type, status, order_by: orderBy, sort, page = 1 }) {
  const firstGenreId = Number((genres || '').split(',')[0]);
  const genre = MAL_GENRE_ID_TO_ANILIST_NAME[firstGenreId];
  const format = MAL_TYPE_TO_ANILIST_FORMAT[type];
  const anilistStatus = MAL_STATUS_TO_ANILIST_STATUS[status];
  const anilistSort = anilistSortFor(orderBy, sort);

  const data = await gql(`
    query($page: Int, $search: String, $genre: String, $format: MediaFormat, $status: MediaStatus, $sort: [MediaSort]) {
      Page(page: $page, perPage: 20) {
        pageInfo { hasNextPage }
        media(type: ANIME, search: $search, genre: $genre, format: $format, status: $status, sort: $sort, isAdult: false) { ${MEDIA_FIELDS} }
      }
    }
  `, { page, search: q || undefined, genre, format, status: anilistStatus, sort: [anilistSort] });
  return {
    data: data.Page.media.map(normalizeAniListMedia).filter(Boolean),
    pagination: { has_next_page: data.Page.pageInfo.hasNextPage },
  };
}

export async function anilistByMalId(malId) {
  const data = await gql(`
    query($idMal: Int) {
      Media(idMal: $idMal, type: ANIME) {
        ${MEDIA_FIELDS}
        recommendations(sort: RATING_DESC, perPage: 12) {
          nodes { mediaRecommendation { ${MEDIA_FIELDS} } }
        }
      }
    }
  `, { idMal: malId });
  if (!data.Media) return null;
  const full = normalizeAniListMedia(data.Media);
  const recommendations = (data.Media.recommendations?.nodes || [])
    .map((n) => normalizeAniListMedia(n.mediaRecommendation))
    .filter(Boolean)
    .map((entry) => ({ entry }));
  return { full, recommendations };
}

export async function anilistRandomish() {
  const page = 1 + Math.floor(Math.random() * 15);
  const data = await gql(`
    query($page: Int) {
      Page(page: $page, perPage: 20) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { idMal }
      }
    }
  `, { page });
  const pool = data.Page.media.filter((m) => m.idMal);
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return anilistByMalId(pick.idMal).then((r) => r?.full);
}

// Fallback data source. AniList's public GraphQL API is free, keyless, and
// has a much higher rate limit (~90 req/min) than Jikan (~60 req/min shared
// across every Jikan user worldwide), so when Jikan is unavailable or our
// own cache+queue can't keep up, we transparently fall back to AniList and
// reshape its response to look like the Jikan payloads the frontend expects.

import { track } from './tidewatch-metrics.js';

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

// AniList's `studios(isMain: true)` connection can list the same studio
// twice for one title (confirmed directly against the live API, same
// quirk as the Studio.media / Staff.characterMedia connections elsewhere
// in this file) - dedupe once here so every caller of normalizeAniListMedia
// gets a clean list, not just the new studio-browse feature.
function dedupeStudios(nodes = []) {
  const seen = new Set();
  return nodes.filter((s) => {
    if (!s?.name || seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

const MEDIA_FIELDS = `
  id idMal
  title { romaji english }
  coverImage { extraLarge large }
  averageScore popularity episodes format season seasonYear status source
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
    studios: dedupeStudios(m.studios?.nodes || []).map((s) => ({ name: s.name })),
    source: m.source ? m.source.replaceAll('_', ' ') : null,
    season: m.season ? m.season.toLowerCase() : null,
    status: STATUS_MAP[m.status] || m.status || null,
    rank: null,
    popularity: null,
    // AniList's `popularity` is how many users have it on a list - its
    // equivalent of MAL's member count (MAL's popularity RANK stays null).
    members: m.popularity ?? null,
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
  const res = await track('anime-api', 'service', () => fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  }));
  if (!res.ok) {
    const err = new Error(`AniList error ${res.status}`);
    err.status = res.status;
    // Seconds AniList asks us to wait on a 429 - the watch-source importer
    // (AniList currently allows only 30 requests/minute) uses this to pause
    // instead of hammering on or giving up.
    err.retryAfter = Number(res.headers.get('retry-after')) || null;
    throw err;
  }
  const json = await res.json();
  if (json.errors?.length) {
    // A "not found" root query (Media/Studio/Staff with no match) comes
    // back as a GraphQL error alongside `data: { X: null }`, not a clean
    // null - carrying the status through lets callers that search by name
    // (no fallback source to mask this, unlike Media lookups elsewhere in
    // this file) tell "genuinely doesn't exist" apart from "AniList errored".
    const err = new Error(`AniList error: ${json.errors[0].message}`);
    err.status = json.errors[0].status || 500;
    throw err;
  }
  return json.data;
}

// For root queries where "no match" is an expected, valid outcome (a
// Studio/Staff search by name) rather than a real failure - resolves to
// `null` on AniList's 404-shaped "Not Found" error, still throws for
// anything else (a genuine outage) so that stays a 502, not a false 404.
async function gqlOrNull(query, variables) {
  try {
    return await gql(query, variables);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
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

// Raw candidate list for the watch-source matcher (lib/watchSourceMatcher.js):
// unlike anilistSearch above (which keeps only english||romaji as a single
// display title), this returns EVERY title AniList knows for each hit -
// romaji, english, native, and all synonyms - because the matcher needs to
// test an upload's series name for exact equality against all of them, not
// just the one we happen to display. Errors are left to propagate with their
// status intact (429 = rate limited) so the caller can tell "no match" apart
// from "couldn't ask".
export async function anilistFindCandidates(q) {
  const data = await gql(`
    query($search: String) {
      Page(page: 1, perPage: 10) {
        media(type: ANIME, search: $search, isAdult: false, sort: SEARCH_MATCH) {
          idMal format popularity
          title { romaji english native }
          synonyms
        }
      }
    }
  `, { search: q });
  return (data.Page.media || []).filter((m) => m.idMal).map((m) => ({
    malId: m.idMal,
    format: m.format,
    popularity: m.popularity || 0,
    displayTitle: m.title?.english || m.title?.romaji || 'Untitled',
    titles: [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].filter(Boolean),
  }));
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

const WEEKDAY_INDEX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// Fallback for "what airs on weekday X". AniList has no direct equivalent of
// Jikan's /schedules?filter=monday, so this queries individual episode
// air-times over the next ~8 days (airingSchedules) and buckets each one by
// weekday, converted to JST — the anime industry's usual scheduling
// timezone and what Jikan's own /schedules groups by — so results line up
// with what the primary source would show for the same day.
export async function anilistSchedule(day) {
  const targetDay = WEEKDAY_INDEX[day];
  if (targetDay === undefined) return { data: [] };

  const now = Math.floor(Date.now() / 1000);
  const weekAhead = now + 8 * 24 * 3600;
  const data = await gql(`
    query($from: Int, $to: Int) {
      Page(page: 1, perPage: 50) {
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          airingAt
          media { ${MEDIA_FIELDS} }
        }
      }
    }
  `, { from: now, to: weekAhead });

  const seen = new Set();
  const results = [];
  for (const sched of data.Page.airingSchedules) {
    const jstDate = new Date((sched.airingAt + 9 * 3600) * 1000);
    if (jstDate.getUTCDay() !== targetDay) continue;
    const media = sched.media;
    if (!media?.idMal || seen.has(media.idMal)) continue;
    seen.add(media.idMal);
    const normalized = normalizeAniListMedia(media);
    if (normalized) results.push(normalized);
  }
  return { data: results };
}

const CHARACTERS_LIMIT = 12;

export async function anilistCharacters(malId) {
  const data = await gql(`
    query($idMal: Int) {
      Media(idMal: $idMal, type: ANIME) {
        characters(sort: ROLE, perPage: ${CHARACTERS_LIMIT}) {
          edges {
            role
            node { name { full } image { large } }
            voiceActors(language: JAPANESE) { name { full } image { large } }
          }
        }
      }
    }
  `, { idMal: malId });
  if (!data.Media) return [];
  return (data.Media.characters?.edges || []).map((e) => ({
    character: { name: e.node?.name?.full || 'Unknown', image: e.node?.image?.large || '' },
    role: e.role || null,
    voiceActors: (e.voiceActors || []).map((va) => ({ name: va.name?.full || 'Unknown', image: va.image?.large || '' })),
  }));
}

const BROWSE_MEDIA_LIMIT = 24;

function dedupeMediaByMalId(list) {
  const seen = new Set();
  return list.filter((m) => {
    if (!m?.mal_id || seen.has(m.mal_id)) return false;
    seen.add(m.mal_id);
    return true;
  });
}

// Studios/voice-actors aren't indexed anywhere in our own data - AniList's
// own Staff/Studio search does the lookup-by-name directly, so there's no
// need to crawl every anime's characters() ourselves to build a reverse
// index. No Jikan fallback here (unlike everywhere else in this file):
// Jikan's equivalent would need a two-step name->id->anime-list lookup with
// a materially different shape, for a discovery feature that's a nice-to
// -have, not core - if AniList is down, this just shows a retry prompt.
export async function anilistStudioByName(name) {
  const data = await gqlOrNull(`
    query($search: String) {
      Studio(search: $search) {
        id
        name
        media(sort: POPULARITY_DESC, perPage: ${BROWSE_MEDIA_LIMIT}) {
          nodes { ${MEDIA_FIELDS} }
        }
      }
    }
  `, { search: name });
  if (!data?.Studio) return null;
  return {
    id: data.Studio.id,
    name: data.Studio.name,
    // AniList's own `media` connection returns each title duplicated when a
    // studio is credited on it more than once (e.g. both as the animation
    // studio and separately as a producer) - not a bug in this code, just
    // how the connection resolves, confirmed directly against the live API.
    media: dedupeMediaByMalId((data.Studio.media?.nodes || []).map(normalizeAniListMedia).filter(Boolean)),
  };
}

export async function anilistStaffByName(name) {
  const data = await gqlOrNull(`
    query($search: String) {
      Staff(search: $search) {
        id
        name { full }
        image { large }
        characterMedia(sort: POPULARITY_DESC, perPage: ${BROWSE_MEDIA_LIMIT}) {
          edges {
            characterRole
            characters { name { full } }
            node { ${MEDIA_FIELDS} }
          }
        }
      }
    }
  `, { search: name });
  if (!data?.Staff) return null;
  // Same duplicate-edge quirk as Studio.media (confirmed against the live
  // API) - merge by anime instead of a plain map/filter, so a repeated or
  // multi-character credit on the same title becomes one entry with all
  // character names, not several cards for the same anime.
  const roleMap = new Map();
  for (const e of data.Staff.characterMedia?.edges || []) {
    const anime = normalizeAniListMedia(e.node);
    if (!anime?.mal_id) continue;
    const names = (e.characters || []).map((c) => c.name?.full).filter(Boolean);
    const existing = roleMap.get(anime.mal_id);
    if (!existing) {
      roleMap.set(anime.mal_id, { role: e.characterRole || null, characterNames: names, anime });
    } else {
      for (const n of names) if (!existing.characterNames.includes(n)) existing.characterNames.push(n);
    }
  }
  const roles = [...roleMap.values()];
  return {
    id: data.Staff.id,
    name: data.Staff.name?.full || name,
    image: data.Staff.image?.large || '',
    roles,
  };
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

// AniList's own MediaListStatus enum -> AniNest's watch-status enum
// (favorites.status: 'watching'|'plan_to_watch'|'completed'|'dropped').
// PAUSED ("on hold") has no equivalent in our smaller enum - left
// unclassified (null) rather than guessed into the wrong bucket.
const LIST_STATUS_TO_WATCH_STATUS = {
  CURRENT: 'watching',
  REPEATING: 'watching',
  PLANNING: 'plan_to_watch',
  COMPLETED: 'completed',
  DROPPED: 'dropped',
  PAUSED: null,
};

// Fetches a public AniList user's whole anime list (not manga - out of
// AniNest's scope) for import into `favorites`. Returns null specifically
// for "no such user" (confirmed against the live API: this is another
// GraphQL-error-not-null root query, same as Studio/Staff - see gqlOrNull),
// so the route can tell that apart from a genuine AniList outage.
export async function anilistUserAnimeList(username) {
  const data = await gqlOrNull(`
    query($userName: String) {
      MediaListCollection(userName: $userName, type: ANIME) {
        lists {
          entries {
            status
            media { idMal title { romaji english } coverImage { extraLarge large } averageScore format }
          }
        }
      }
    }
  `, { userName: username });
  if (!data?.MediaListCollection) return null;

  // A title can appear in more than one of a user's lists (e.g. a custom
  // list alongside the default status list) - dedupe by idMal, keeping
  // whichever occurrence is seen first.
  const seen = new Set();
  const entries = [];
  for (const list of data.MediaListCollection.lists || []) {
    for (const entry of list.entries || []) {
      const m = entry.media;
      if (!m?.idMal || seen.has(m.idMal)) continue;
      seen.add(m.idMal);
      entries.push({
        mal_id: m.idMal,
        title: m.title?.english || m.title?.romaji || 'Untitled',
        image: m.coverImage?.extraLarge || m.coverImage?.large || '',
        score: m.averageScore != null ? Math.round(m.averageScore) / 10 : null,
        type: FORMAT_MAP[m.format] || m.format || 'TV',
        status: LIST_STATUS_TO_WATCH_STATUS[entry.status] ?? null,
      });
    }
  }
  return entries;
}

// One batch of anime with their typed relations, for the franchise walker
// (lib/franchise.js). Pass `ids` (AniList ids) or `malIds`, up to 50. Only one
// list may be set: AniList answers a null list variable with a 500, so the
// unused one is left out of `variables` entirely.
export async function anilistMediaWithRelations({ ids, malIds }) {
  const variables = ids ? { ids } : { malIds };
  const data = await gql(`
    query($ids: [Int], $malIds: [Int]) {
      Page(perPage: 50) {
        media(id_in: $ids, idMal_in: $malIds, type: ANIME) {
          id idMal isAdult format episodes
          title { romaji english }
          startDate { year month day }
          coverImage { large }
          relations { edges { relationType(version: 2) node { id type } } }
        }
      }
    }
  `, variables);
  return data.Page?.media || [];
}

// Episodes airing between `from` and `to` (epoch seconds) for a list of MAL
// ids, for the calendar feed (lib/calendar.js). Two requests per 50 shows:
// the MAL ids resolve to AniList ids first, because airingSchedules can only
// filter by AniList id. Only shows still airing or announced are asked about.
export async function anilistAiringForMalIds(malIds, from, to) {
  const out = [];
  for (let i = 0; i < malIds.length; i += 50) {
    const media = await gql(`
      query($malIds: [Int]) {
        Page(perPage: 50) {
          media(idMal_in: $malIds, type: ANIME) { id idMal duration status title { romaji english } }
        }
      }
    `, { malIds: malIds.slice(i, i + 50) });
    const byId = new Map((media.Page?.media || [])
      .filter((m) => m.idMal && (m.status === 'RELEASING' || m.status === 'NOT_YET_RELEASED'))
      .map((m) => [m.id, m]));
    if (!byId.size) continue;

    for (let page = 1; page <= 3; page += 1) {
      const data = await gql(`
        query($ids: [Int], $from: Int, $to: Int, $page: Int) {
          Page(page: $page, perPage: 50) {
            pageInfo { hasNextPage }
            airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { episode airingAt mediaId }
          }
        }
      `, { ids: [...byId.keys()], from, to, page });
      for (const s of data.Page?.airingSchedules || []) {
        const m = byId.get(s.mediaId);
        if (!m) continue;
        out.push({ mal_id: m.idMal, title: m.title?.english || m.title?.romaji || 'Untitled', duration: m.duration || null, episode: s.episode, airingAt: s.airingAt });
      }
      if (!data.Page?.pageInfo?.hasNextPage) break;
    }
  }
  return out;
}

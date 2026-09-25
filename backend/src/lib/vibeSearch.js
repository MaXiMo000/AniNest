import { cached } from './cache.js';
import { anilistVibeSearch, anilistLikeCandidates, normalizeAniListMedia } from './anilist.js';
import { parseVibe, isEmptyVibe } from './vibeParser.js';

// Runs a parsed vibe (lib/vibeParser.js) against AniList. Without "like X" it
// is one filtered query. With it, X's community recommendations are the
// candidates and the other filters are applied here, by matchVibe below.

const TAG_RANK = 55; // same bar as the AniList query's minimumTagRank
const FORMAT_LABEL = { MOVIE: 'Movie', TV: 'TV', OVA: 'OVA' };

// null when `m` breaks a filter, else the reasons it matches ("Fantasy",
// "cozy", "12 eps", "2019", ...), shown under each result. Pure.
export function matchVibe(m, v) {
  const tags = new Set((m.tags || []).filter((t) => t.rank >= TAG_RANK).map((t) => t.name));
  const genres = new Set(m.genres || []);
  const year = m.startDate?.year ?? m.seasonYear ?? null;
  const eps = m.episodes ?? null;

  if (v.genres.some((g) => !genres.has(g)) || v.tags.some((t) => !tags.has(t))) return null;
  if (v.excludeGenres.some((g) => genres.has(g)) || v.excludeTags.some((t) => tags.has(t))) return null;
  if (v.maxEpisodes != null && !(eps != null && eps <= v.maxEpisodes)) return null;
  if (v.minEpisodes != null && !(eps != null && eps >= v.minEpisodes)) return null;
  if (v.formats.length && !v.formats.includes(m.format)) return null;
  if (v.yearFrom && !(year && year >= v.yearFrom)) return null;
  if (v.yearTo && !(year && year <= v.yearTo)) return null;
  if (v.status && m.status !== v.status) return null;

  const reasons = [...v.genres, ...v.tags];
  v.excludeGenres.concat(v.excludeTags).forEach((x) => reasons.push(`no ${x}`));
  if ((v.maxEpisodes != null || v.minEpisodes != null) && eps) reasons.push(`${eps} ep${eps === 1 ? '' : 's'}`);
  if (v.formats.length) reasons.push(FORMAT_LABEL[m.format] || m.format);
  if ((v.yearFrom || v.yearTo) && year) reasons.push(String(year));
  if (v.status) reasons.push(v.status === 'FINISHED' ? 'Finished' : 'Airing');
  return reasons;
}

function queryFilters(v) {
  return {
    genres: v.genres, notGenres: v.excludeGenres, tags: v.tags, notTags: v.excludeTags,
    epLt: v.maxEpisodes != null ? v.maxEpisodes + 1 : null, // AniList bounds are exclusive
    epGt: v.minEpisodes != null ? v.minEpisodes - 1 : null,
    formats: v.formats,
    from: v.yearFrom ? v.yearFrom * 10000 : null, // FuzzyDateInt YYYYMMDD; Jan 1 of yearFrom is > YYYY0000
    to: v.yearTo ? (v.yearTo + 1) * 10000 : null,
    status: v.status,
  };
}

let search = { vibe: anilistVibeSearch, like: anilistLikeCandidates };
// Test hook: the suite never calls AniList.
export function setVibeSources(sources) {
  search = sources || { vibe: anilistVibeSearch, like: anilistLikeCandidates };
}

export async function vibeSearch(query) {
  const v = parseVibe(query);
  const parsed = { chips: v.chips, unknown: v.unknown };
  if (isEmptyVibe(v)) return { parsed, data: [], understood: false };

  const key = `vibe:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  return cached(key, 10 * 60 * 1000, async () => {
    let candidates;
    let likeNote = null;
    if (v.like) {
      const like = await search.like(v.like);
      if (like) {
        candidates = like.candidates;
        likeNote = { title: like.title, malId: like.malId };
      } else {
        likeNote = { notFound: v.like };
      }
    }
    // No "like", or its title wasn't found: the filters alone, if there are any besides "like".
    if (!candidates) candidates = isEmptyVibe({ ...v, like: null }) ? [] : await search.vibe(queryFilters(v));

    const data = candidates
      .map((m) => {
        const reasons = matchVibe(m, v);
        if (!reasons) return null;
        const anime = normalizeAniListMedia(m);
        if (!anime) return null;
        if (likeNote?.title) reasons.unshift(`like ${likeNote.title}`);
        return { ...anime, vibe_reasons: reasons };
      })
      .filter(Boolean);
    return { parsed, like: likeNote, data, understood: true };
  });
}

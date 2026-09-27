import { jikanGet } from './jikan.js';
import { cached } from './cache.js';
import { persistentCached } from './persistentCache.js';

// Which episodes MAL marks as filler or recap, for the episode guide's
// "skip guide". Only Jikan (MAL) has these flags. Each show's list is kept a
// week, and served from the stored copy when Jikan is down.
const MAX_PAGES = 12; // 100 episodes a page: enough for One Piece-length shows
const TTL_MS = 12 * 60 * 60 * 1000;
const PERSIST_MS = 7 * 24 * 60 * 60 * 1000;

let fetchPage = (malId, page) => jikanGet(`/anime/${malId}/episodes`, { page });
// Test hook: the suite never calls Jikan.
export function setEpisodePageFetcher(fn) {
  fetchPage = fn || ((malId, page) => jikanGet(`/anime/${malId}/episodes`, { page }));
}

async function load(malId) {
  const filler = [];
  const recap = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchPage(malId, page);
    for (const ep of res?.data || []) {
      const n = Number(ep.mal_id);
      if (!Number.isInteger(n)) continue;
      if (ep.filler) filler.push(n);
      if (ep.recap) recap.push(n);
    }
    if (!res?.pagination?.has_next_page) break;
  }
  return { filler, recap };
}

export function episodeFlags(malId) {
  return cached(`episode-flags:${malId}`, TTL_MS, () => persistentCached(`anime:episode-flags:${malId}`, PERSIST_MS, () => load(malId)));
}

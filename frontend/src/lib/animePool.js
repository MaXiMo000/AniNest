import { Api } from './api.js';

// A shared, session-cached pool of anime with valid scores, for games that
// need a batch of anime to draw from (Higher/Lower, Guess the Anime, Taste
// Quiz) rather than one detail page at a time.
//
// Built from three sources, not just one "top anime" list:
//  1. Top anime sampled across a wide page range (not a contiguous block) -
//     page 1 alone is a narrow 9.0-9.1 score band, which makes a scoring
//     guessing game close to a coin flip.
//  2. The current season, for variety a pure "all-time top" list won't have.
//  3. A dedicated top-rated search per genre. Without this, a handful of
//     genres (Horror, Mecha, Sports, Music, ...) are so thin in "top anime
//     overall" (3, 2, 8, 10 matches respectively, measured directly against
//     the old pool) that the Taste Quiz would almost always recommend the
//     exact same one or two anime for those picks - not a matching-logic
//     bug, just too small a candidate pool for those specific genres.
const TOP_ANIME_PAGES = [1, 3, 6, 10, 15, 20, 30, 40];
const SEASON_PAGES = [1, 2];
// Same MAL genre ids the Taste Quiz's questions target
// (frontend/src/pages/games/quiz.js) - kept in sync manually since the quiz
// picks from whatever this pool contains.
const GENRE_TOPUP_IDS = [1, 2, 4, 7, 8, 10, 14, 18, 19, 22, 24, 30, 36, 37, 40, 41];

let poolPromise = null;

function dedupeWithScore(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const a of list) {
      const id = Number(a?.mal_id);
      if (!id || seen.has(id) || !a.score || !a.title) continue;
      seen.add(id);
      out.push(a);
    }
  }
  return out;
}

export function getAnimePool() {
  if (!poolPromise) {
    const topAnimeFetches = TOP_ANIME_PAGES.map((page) => Api.topAnime(page).catch(() => ({ data: [] })));
    const seasonFetches = SEASON_PAGES.map((page) => Api.seasonNow(page).catch(() => ({ data: [] })));
    const genreFetches = GENRE_TOPUP_IDS.map((id) => Api.search({
      genres: id, order_by: 'score', sort: 'desc', page: 1,
    }).catch(() => ({ data: [] })));

    poolPromise = Promise.all([...topAnimeFetches, ...seasonFetches, ...genreFetches])
      .then((results) => {
        const pool = dedupeWithScore(results.map((r) => r.data || []));
        if (pool.length < 8) throw new Error('Not enough scored anime available to build a game pool.');
        return pool;
      })
      .catch((err) => {
        poolPromise = null; // don't cache a failure — let the next caller retry
        throw err;
      });
  }
  return poolPromise;
}

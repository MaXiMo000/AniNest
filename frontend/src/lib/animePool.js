import { Api } from './api.js';

// A shared, session-cached pool of anime with valid scores, for games that
// need a batch of anime to draw from (Higher/Lower, guess-the-anime, ...)
// rather than one detail page at a time.
//
// Sampled across several "top anime" pages (not just page 1) rather than
// one contiguous range — page 1 alone is a narrow band of 9.0-9.1 scores,
// which makes a scoring guessing game close to a coin flip. Spreading the
// sample across ranks gives a wider, more interesting score distribution.
const SAMPLE_PAGES = [1, 4, 8, 12, 16, 20];

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
    poolPromise = Promise.all(SAMPLE_PAGES.map((page) => Api.topAnime(page).catch(() => ({ data: [] }))))
      .then((pages) => {
        const pool = dedupeWithScore(pages.map((p) => p.data || []));
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

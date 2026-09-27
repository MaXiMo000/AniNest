import * as animeSource from './animeSource.js';

// The anime every server-judged game deals from (lib/hlGame.js,
// lib/roundGames.js): top anime sampled across many pages (page 1 alone is a
// narrow 9.0-9.1 score band), the current season, and top-rated per genre so
// thin genres aren't missing. Cached for 6 hours; each run copies what it
// needs, so a refresh mid-run can't change its answers.

const TOP_PAGES = [1, 3, 6, 10, 15, 20, 30, 40];
const GENRES = [1, 2, 4, 7, 8, 10, 14, 18, 19, 22, 24, 30, 36, 37, 40, 41];

async function livePool() {
  const lists = await Promise.all([
    ...TOP_PAGES.map((p) => animeSource.topAnime(p).catch(() => ({ data: [] }))),
    ...[1, 2].map((p) => animeSource.seasonNow(p).catch(() => ({ data: [] }))),
    ...GENRES.map((g) => animeSource.search({ genres: String(g), order_by: 'score', sort: 'desc', page: 1 }).catch(() => ({ data: [] }))),
  ]);
  const seen = new Set();
  const out = [];
  for (const a of lists.flatMap((l) => l.data || [])) {
    const id = Number(a?.mal_id);
    if (!id || seen.has(id) || !a.title) continue;
    seen.add(id);
    out.push({
      id,
      title: a.title,
      title_english: a.title_english || null,
      image: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
      score: a.score ?? null,
      members: a.members ?? null,
      episodes: a.episodes ?? null,
      year: a.year ?? null,
      type: a.type || null,
      studio: a.studios?.[0]?.name || null,
      source: a.source || null,
      synopsis: a.synopsis || null,
      genres: (a.genres || []).map((g) => g.name).filter(Boolean),
    });
  }
  return out;
}

const FRESH_MS = 6 * 60 * 60 * 1000;
let source = livePool;
let pending = null;
let builtAt = 0;

// Test hook: the suite never calls the anime APIs.
export function setGamePool(fn) {
  source = fn || livePool;
  pending = null;
}

export function getGamePool() {
  if (!pending || Date.now() - builtAt > FRESH_MS) {
    builtAt = Date.now();
    pending = source().catch((err) => { pending = null; throw err; });
  }
  return pending;
}

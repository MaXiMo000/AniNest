// trace.moe: a free, keyless public API that identifies an anime from a
// single screenshot/frame. Deliberately proxied through our own backend,
// same rule as Jikan/AniList - the browser never calls a third-party API
// directly (see animeSource.js).
//
// Anonymous (keyless) access has its own daily quota - much tighter than
// Jikan's (observed: 100/day, shared across every visitor since they all
// go through this one server), not per-visitor. This is a nice-to-have
// discovery feature, not core functionality, so no attempt is made to
// queue/ration requests the way jikan.js does - if the quota is exhausted,
// trace.moe's own error message is passed through as-is.
const TRACE_MOE_URL = 'https://api.trace.moe/search?anilistInfo';

export async function traceMoeSearch(imageBuffer, contentType) {
  const res = await fetch(TRACE_MOE_URL, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: imageBuffer,
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const err = new Error(json.error || `trace.moe error ${res.status}`);
    err.status = res.ok ? 502 : res.status;
    throw err;
  }

  // Adult-content results are excluded everywhere else this app queries
  // AniList (every GraphQL query in anilist.js passes isAdult: false) -
  // trace.moe indexes everything, so the same filter is applied here.
  // Also drop anything with no MAL id - this site's detail pages, favorites,
  // and reviews are all keyed by mal_id, so a result without one can't be
  // opened, favorited, or linked to anyway.
  const seen = new Set();
  const mapped = [];
  for (const r of json.result) {
    const id = r.anilist?.idMal;
    // trace.moe can match several different frames to the same anime -
    // results already come back sorted by similarity descending, so the
    // first occurrence of an id is its best match; skip the rest so the
    // list reads as distinct candidate anime, not one repeated 3 times.
    if (!id || r.anilist?.isAdult || seen.has(id)) continue;
    seen.add(id);
    mapped.push({
      mal_id: id,
      title: r.anilist.title?.english || r.anilist.title?.romaji || r.anilist.title?.native || 'Untitled',
      image: r.anilist.coverImage?.large || r.anilist.coverImage?.extraLarge || '',
      matchImage: r.image || '',
      similarity: r.similarity,
      episode: r.episode ?? null,
      from: r.from ?? null,
    });
  }
  return mapped;
}

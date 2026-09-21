// AnimeThemes.moe: a free, keyless API of anime openings/endings, indexed
// by MAL id via its "resources" (external-site cross-reference) filter.
// Proxied through our own backend, same rule as every other third-party
// API this app uses - the browser never calls it directly.
const BASE = 'https://api.animethemes.moe';

// A theme (e.g. "OP1") can have several `animethemeentries` - different
// episode-range/version cuts of the same song as the show's staff swapped
// footage over its run (confirmed directly against the live API: Kimetsu
// no Yaiba's OP1 has 4 versions). The jukebox only needs one representative
// clip per theme, not every historical variant, so this always takes the
// first (earliest/main) entry, then the highest-resolution video within it.
function pickVideo(entries) {
  const videos = entries?.[0]?.videos || [];
  return [...videos].sort((a, b) => (b.resolution || 0) - (a.resolution || 0))[0];
}

export async function animeThemesFor(malId) {
  const url = new URL(`${BASE}/anime`);
  url.searchParams.set('filter[has]', 'resources');
  url.searchParams.set('filter[resource][site]', 'MyAnimeList');
  url.searchParams.set('filter[resource][external_id]', String(malId));
  url.searchParams.set('include', 'animethemes.animethemeentries.videos,animethemes.song');

  // AnimeThemes.moe sits behind Cloudflare, which blocks Node's fetch()
  // default User-Agent as bot traffic (confirmed directly: the exact same
  // request succeeds with curl's default UA but 403s with Node's) - a
  // normal browser-like UA is required, not optional.
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const err = new Error(`AnimeThemes error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const anime = json.anime?.[0];
  if (!anime) return [];

  return (anime.animethemes || [])
    .map((theme) => {
      const video = pickVideo(theme.animethemeentries);
      if (!video?.link) return null;
      return {
        slug: theme.slug, // e.g. "OP1", "ED2"
        type: theme.type, // "OP" | "ED"
        title: theme.song?.title || null,
        videoUrl: video.link,
      };
    })
    .filter(Boolean);
}

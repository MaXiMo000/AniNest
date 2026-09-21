// Extracts a bare 11-character YouTube video id from a URL, rejecting
// everything else outright. This is the ONLY code path anywhere in the app
// that turns user/admin-supplied text into something stored in
// anime_watch_sources - both routes/animeWatchSources.js (public submission)
// and routes/adminWatchSources.js (admin direct-add) funnel through this
// single function, so there is exactly one place that decides what counts
// as "a YouTube link" and it is deliberately strict:
//   - only http(s), only youtube.com/youtu.be/youtube-nocookie.com hosts
//     (www./m. subdomain stripped, nothing else tolerated)
//   - only the known video-URL path shapes YouTube actually uses
//   - the id itself must match YouTube's own charset/length exactly
// We never store the raw submitted string, only this extracted id - the
// embed URL shown on the site is always rebuilt from scratch server/client
// side (`https://www.youtube-nocookie.com/embed/<id>`), so a submission can
// never smuggle extra query params, a different host, or any other payload
// into what actually gets embedded.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(raw) {
  if (typeof raw !== 'string' || raw.length > 500) return null;

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  let id = null;

  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const m = /^\/(embed|shorts|live)\/([^/]+)/.exec(url.pathname);
      if (m) id = m[2];
    }
  } else {
    return null; // not a recognized YouTube host at all - reject, no exceptions
  }

  return id && YOUTUBE_ID_RE.test(id) ? id : null;
}

export function embedUrlFor(videoId) {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

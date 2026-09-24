import { API_BASE } from './http.js';

// MangaDex blocks browser hotlinking from other sites (serves a placeholder
// image instead - see backend/src/routes/manga.js), so every MangaDex cover
// URL is rewritten to our own backend's cover proxy at render time. Done
// here rather than only in the API response so manga favorites saved before
// this fix (whose stored image is the raw uploads.mangadex.org URL) heal
// too. Anything that isn't a MangaDex cover URL passes through untouched.
const COVER_RE = /^https:\/\/uploads\.mangadex\.org\/covers\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.[a-z]+?)(?:\.\d+\.jpg)?$/i;

export function mangaImg(url) {
  if (!url) return '';
  const m = COVER_RE.exec(url);
  return m ? `${API_BASE}/api/manga/cover/${m[1]}/${m[2]}` : url;
}

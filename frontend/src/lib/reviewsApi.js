import { apiGet, apiPost, apiDelete } from './http.js';

// Reviews are scoped to a single anime page at a time (unlike favorites,
// which need a global header count), so this is just a thin API wrapper
// rather than a reactive store like store.js.
export const Reviews = {
  list: (malId) => apiGet(`/api/reviews/${malId}`),
  submit: (malId, rating, body) => apiPost('/api/reviews', { mal_id: malId, rating, body }),
  remove: (malId) => apiDelete(`/api/reviews/${malId}`),
};

// Same contract as Reviews, keyed by the MangaDex UUID.
export const MangaReviews = {
  list: (mangaId) => apiGet(`/api/manga-reviews/${mangaId}`),
  submit: (mangaId, rating, body) => apiPost('/api/manga-reviews', { manga_id: mangaId, rating, body }),
  remove: (mangaId) => apiDelete(`/api/manga-reviews/${mangaId}`),
};

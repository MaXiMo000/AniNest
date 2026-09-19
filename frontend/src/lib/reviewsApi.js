import { apiGet, apiPost, apiDelete } from './http.js';

// Reviews are scoped to a single anime page at a time (unlike favorites,
// which need a global header count), so this is just a thin API wrapper
// rather than a reactive store like store.js.
export const Reviews = {
  list: (malId) => apiGet(`/api/reviews/${malId}`),
  submit: (malId, rating, body) => apiPost('/api/reviews', { mal_id: malId, rating, body }),
  remove: (malId) => apiDelete(`/api/reviews/${malId}`),
};

import { apiPost } from './http.js';

export const Import = {
  anilist: (username) => apiPost('/api/import/anilist', { username }),
};

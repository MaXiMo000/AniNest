import { apiFetch, apiPost } from './http.js';

export const Import = {
  anilist: (username) => apiPost('/api/import/anilist', { username }),
  // The raw .xml.gz (or .xml) from MyAnimeList's export page.
  mal: (file) => apiFetch('/api/import/mal', { method: 'POST', file, fileType: 'application/octet-stream' }),
};

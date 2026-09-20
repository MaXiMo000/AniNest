import { apiGet } from './http.js';

export const Recs = {
  mine: () => apiGet('/api/recommendations/mine'),
};

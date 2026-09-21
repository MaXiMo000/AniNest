import { apiPostFile } from './http.js';

export const ScreenshotSearch = {
  search: (file) => apiPostFile('/api/screenshot-search', file),
};

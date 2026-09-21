// Admin-only curation tools - every call here 404s/401s for a non-admin
// (see backend/src/middleware/session.js's requireAdmin), so this module
// is only ever imported by pages/admin/watchSourcesAdmin.js.
import { apiGet, apiPost } from './http.js';

export const AdminWatchSources = {
  channels: () => apiGet('/api/admin/watch-sources/channels'),
  search: (channel, q) => apiGet(`/api/admin/watch-sources/search?channel=${encodeURIComponent(channel)}&q=${encodeURIComponent(q)}`),
  add: (malId, youtubeUrl, channelName, label) => apiPost('/api/admin/watch-sources', {
    mal_id: Number(malId), youtube_url: youtubeUrl, channel_name: channelName || undefined, label: label || undefined,
  }),
  pending: () => apiGet('/api/admin/watch-sources/pending'),
  bulkImport: (channel, maxItems) => apiPost('/api/admin/watch-sources/bulk-import', { channel, maxItems }),
  approve: (id) => apiPost(`/api/admin/watch-sources/${id}/approve`),
  reject: (id) => apiPost(`/api/admin/watch-sources/${id}/reject`),
};

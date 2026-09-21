// Legal free-to-watch episode links (curated official YouTube uploads) for
// a given anime - the public read side, plus the "anyone logged in can
// suggest a link" submission (always lands pending until an admin approves
// it - see lib/adminWatchSourcesApi.js for the review side).
import { apiGet, apiPost } from './http.js';

export const WatchSources = {
  forAnime: (malId) => apiGet(`/api/anime/${malId}/watch-sources`),
  submit: (malId, youtubeUrl, channelName) => apiPost('/api/anime-watch-sources', {
    mal_id: Number(malId), youtube_url: youtubeUrl, channel_name: channelName || undefined,
  }),
};

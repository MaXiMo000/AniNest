import { apiGet, apiPost, apiDelete } from './http.js';

export const Users = {
  profile: (username) => apiGet(`/api/users/${encodeURIComponent(username)}`),
  xpLeaderboard: () => apiGet('/api/leaderboard/xp'),
  tasteMatch: (username) => apiGet(`/api/users/${encodeURIComponent(username)}/taste-match`),
  follow: (username) => apiPost(`/api/users/${encodeURIComponent(username)}/follow`),
  unfollow: (username) => apiDelete(`/api/users/${encodeURIComponent(username)}/follow`),
  feed: () => apiGet('/api/feed'),
};

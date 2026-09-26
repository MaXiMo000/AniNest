import { apiGet } from './http.js';

export const Users = {
  profile: (username) => apiGet(`/api/users/${encodeURIComponent(username)}`),
  xpLeaderboard: () => apiGet('/api/leaderboard/xp'),
  tasteMatch: (username) => apiGet(`/api/users/${encodeURIComponent(username)}/taste-match`),
};

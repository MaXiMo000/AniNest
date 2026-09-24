import { apiGet, apiPost } from './http.js';

export const Games = {
  daily: () => apiGet('/api/games/daily'),
  submitScore: (game, streak) => apiPost(`/api/games/${game}/score`, { streak }),
  leaderboard: (game) => apiGet(`/api/games/${game}/leaderboard`),
  submitDailyResult: (date, won, rounds) => apiPost('/api/games/daily/result', { date, won, rounds }),
};

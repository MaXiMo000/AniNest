import { apiGet, apiPost } from './http.js';

export const Games = {
  daily: () => apiGet('/api/games/daily'),
  // A score is only accepted for a run the player started (see
  // backend/src/routes/games.js): startRun() when a game begins, then
  // submitScore() with that run id when it ends.
  startRun: (game) => apiPost(`/api/games/${game}/start`),
  submitScore: (game, streak, runId) => apiPost(`/api/games/${game}/score`, { streak, run_id: runId }),
  leaderboard: (game) => apiGet(`/api/games/${game}/leaderboard`),
  submitDailyResult: (date, won, rounds) => apiPost('/api/games/daily/result', { date, won, rounds }),
};

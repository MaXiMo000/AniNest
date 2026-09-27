import { apiGet, apiPost } from './http.js';

export const Games = {
  daily: () => apiGet('/api/games/daily'),
  mangaDaily: () => apiGet('/api/games/manga-daily'),
  // A score is only accepted for a run the player started (see
  // backend/src/routes/games.js): startRun() when a game begins, then
  // submitScore() with that run id when it ends.
  startRun: (game) => apiPost(`/api/games/${game}/start`),
  submitScore: (game, streak, runId) => apiPost(`/api/games/${game}/score`, { streak, run_id: runId }),
  // period: 'all' (default) or 'week'
  leaderboard: (game, period = 'all') => apiGet(`/api/games/${game}/leaderboard${period === 'week' ? '?period=week' : ''}`),
  submitDailyResult: (date, won, rounds) => apiPost('/api/games/daily/result', { date, won, rounds }),
  submitMangaDailyResult: (date, won, rounds) => apiPost('/api/games/manga-daily/result', { date, won, rounds }),
  myStats: () => apiGet('/api/games/me/stats'),
  // Higher or Lower is dealt and judged by the server (backend/src/lib/hlGame.js).
  hlStart: (game, seed) => apiPost('/api/games/hl/start', { game, seed: seed || null }),
  hlGuess: (runId, direction) => apiPost(`/api/games/hl/${runId}/guess`, { direction }),
  hlSkip: (runId) => apiPost(`/api/games/hl/${runId}/skip`),
};

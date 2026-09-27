import { apiGet, apiPost } from './http.js';

export const Games = {
  daily: () => apiGet('/api/games/daily'),
  mangaDaily: () => apiGet('/api/games/manga-daily'),
  // period: 'all' (default) or 'week'
  leaderboard: (game, period = 'all') => apiGet(`/api/games/${game}/leaderboard${period === 'week' ? '?period=week' : ''}`),
  submitDailyResult: (date, won, rounds) => apiPost('/api/games/daily/result', { date, won, rounds }),
  submitMangaDailyResult: (date, won, rounds) => apiPost('/api/games/manga-daily/result', { date, won, rounds }),
  myStats: () => apiGet('/api/games/me/stats'),
  // Higher or Lower is dealt and judged by the server (backend/src/lib/hlGame.js).
  hlStart: (game, seed) => apiPost('/api/games/hl/start', { game, seed: seed || null }),
  hlGuess: (runId, direction) => apiPost(`/api/games/hl/${runId}/guess`, { direction }),
  hlSkip: (runId) => apiPost(`/api/games/hl/${runId}/skip`),
  // Round-by-round games dealt and judged by the server (backend/src/lib/roundGames.js).
  roundStart: (game, { seed, input } = {}) => apiPost('/api/games/rounds/start', { game, seed: seed || null, ...(input ? { input } : {}) }),
  roundAnswer: (runId, body) => apiPost(`/api/games/rounds/${runId}/answer`, body),
  roundSkip: (runId) => apiPost(`/api/games/rounds/${runId}/skip`),
  roundFinish: (runId) => apiPost(`/api/games/rounds/${runId}/finish`),
};

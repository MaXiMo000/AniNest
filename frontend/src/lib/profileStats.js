// Numbers for the public profile's dashboard, from the favorites rows the
// profile route returns (status, genres, episodes, type, score). Pure.

const EPISODE_MINUTES = 24;

export const STATUS_ORDER = [
  { value: 'watching', emoji: '👀', label: 'Watching' },
  { value: 'plan_to_watch', emoji: '📌', label: 'Plan to Watch' },
  { value: 'completed', emoji: '✅', label: 'Completed' },
  { value: 'dropped', emoji: '❌', label: 'Dropped' },
];

export function profileStats(favorites = []) {
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s.value, 0]));
  const genres = new Map();
  const types = new Map();
  let withGenres = 0;
  let episodesWatched = 0;
  let scoreSum = 0;
  let scored = 0;

  for (const f of favorites) {
    if (byStatus[f.status] !== undefined) byStatus[f.status] += 1;
    if (Array.isArray(f.genres) && f.genres.length) {
      withGenres += 1;
      for (const g of f.genres) genres.set(g, (genres.get(g) || 0) + 1);
    }
    if (f.type) types.set(f.type, (types.get(f.type) || 0) + 1);
    if (f.status === 'completed' && Number(f.episodes) > 0) episodesWatched += Number(f.episodes);
    if (Number(f.score) > 0) { scoreSum += Number(f.score); scored += 1; }
  }

  // Of everything the user started (not just planned), how much they finished.
  const started = byStatus.watching + byStatus.completed + byStatus.dropped;
  return {
    total: favorites.length,
    byStatus,
    tracked: STATUS_ORDER.reduce((sum, s) => sum + byStatus[s.value], 0),
    completionRate: started ? Math.round((byStatus.completed / started) * 100) : null,
    episodesWatched,
    hoursWatched: Math.round((episodesWatched * EPISODE_MINUTES) / 60),
    averageScore: scored ? Math.round((scoreSum / scored) * 10) / 10 : null,
    topGenres: [...genres.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
    withGenres,
    types: [...types.entries()].sort((a, b) => b[1] - a[1]),
  };
}

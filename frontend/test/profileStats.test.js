import { describe, it, expect } from 'vitest';
import { profileStats } from '../src/lib/profileStats.js';

describe('profile stats', () => {
  it('counts statuses, completion rate, time watched, genres and types', () => {
    const s = profileStats([
      { status: 'completed', episodes: 24, genres: ['Action', 'Drama'], type: 'TV', score: 8 },
      { status: 'completed', episodes: 12, genres: ['Action'], type: 'TV', score: 9 },
      { status: 'dropped', episodes: 50, genres: ['Comedy'], type: 'TV' },
      { status: 'plan_to_watch', type: 'Movie' },
      { status: null, genres: [] },
    ]);
    expect(s.byStatus).toEqual({ watching: 0, plan_to_watch: 1, completed: 2, dropped: 1 });
    expect(s.completionRate).toBe(67);
    expect(s.episodesWatched).toBe(36);
    expect(s.hoursWatched).toBe(14);
    expect(s.averageScore).toBe(8.5);
    expect(s.topGenres[0]).toEqual(['Action', 2]);
    expect(s.withGenres).toBe(3);
    expect(s.types[0]).toEqual(['TV', 3]);
  });

  it('handles an empty list', () => {
    const s = profileStats([]);
    expect(s.completionRate).toBeNull();
    expect(s.averageScore).toBeNull();
    expect(s.topGenres).toEqual([]);
  });
});

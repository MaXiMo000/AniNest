import { describe, it, expect, beforeEach } from 'vitest';
import { dailyStats, localDailyResults } from '../src/lib/dailyStats.js';

describe('daily stats (frontend)', () => {
  beforeEach(() => localStorage.clear());

  it('matches the backend rules for streaks and distribution', () => {
    const rows = [
      { date: '2026-01-01', won: true, rounds: 1 },
      { date: '2026-01-02', won: true, rounds: 3 },
      { date: '2026-01-03', won: false, rounds: 4 },
      { date: '2026-01-04', won: true, rounds: 2 },
    ];
    const s = dailyStats(rows, '2026-01-04');
    expect(s).toMatchObject({ played: 4, won: 3, winRate: 75, currentStreak: 1, longestStreak: 2 });
    expect(s.distribution).toEqual({ 1: 1, 2: 1, 3: 1, 4: 0 });
    expect(s.calendar.at(-1)).toEqual({ date: '2026-01-04', result: 'won' });
  });

  it('reads only its own prefix from localStorage', () => {
    localStorage.setItem('aninest_daily_2026-01-01', JSON.stringify({ attempts: ['wrong', 'correct'], won: true }));
    localStorage.setItem('aninest_manga_daily_2026-01-01', JSON.stringify({ attempts: ['correct'], won: true }));
    localStorage.setItem('aninest_daily_garbage', '{}');
    expect(localDailyResults('aninest_daily_')).toEqual([{ date: '2026-01-01', won: true, rounds: 2 }]);
    expect(localDailyResults('aninest_manga_daily_')).toEqual([{ date: '2026-01-01', won: true, rounds: 1 }]);
  });
});

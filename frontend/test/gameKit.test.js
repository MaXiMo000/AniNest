import { describe, it, expect, beforeEach } from 'vitest';
import { foldResult, recordLocalResult, getLocalStats } from '../src/lib/gameKit.js';

describe('gameKit local stats', () => {
  beforeEach(() => localStorage.clear());

  it('foldResult tracks plays, best, total and history', () => {
    let { stats, isNewBest } = foldResult(null, 5, 1);
    expect(stats).toMatchObject({ plays: 1, best: 5, total: 5, lastPlayed: 1 });
    expect(isNewBest).toBe(true);
    ({ stats, isNewBest } = foldResult(stats, 3, 2));
    expect(stats).toMatchObject({ plays: 2, best: 5, total: 8 });
    expect(isNewBest).toBe(false);
    expect(stats.history.map((h) => h.s)).toEqual([5, 3]);
  });

  it('a zero score is never a new best', () => {
    expect(foldResult(null, 0).isNewBest).toBe(false);
  });

  it('history is capped at 30 entries', () => {
    let stats = null;
    for (let i = 0; i < 40; i += 1) ({ stats } = foldResult(stats, i));
    expect(stats.history).toHaveLength(30);
    expect(stats.history.at(-1).s).toBe(39);
  });

  it('imports a legacy best-streak key once', () => {
    localStorage.setItem('old_best', '12');
    expect(getLocalStats('hl', 'old_best').best).toBe(12);
    const after = recordLocalResult('hl', 4, 'old_best');
    expect(after.best).toBe(12);
    expect(after.isNewBest).toBe(false);
    expect(getLocalStats('hl').plays).toBe(1);
  });
});

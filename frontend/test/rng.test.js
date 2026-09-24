import { describe, it, expect } from 'vitest';
import { mulberry32, hashString, shuffleWith, randomFor, stableOrder } from '../src/lib/rng.js';

describe('rng', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hashString is stable and distinguishes inputs', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('a seed deals the same deck regardless of input order', () => {
    const pool = Array.from({ length: 30 }, (_, i) => ({ mal_id: i + 1 }));
    const reversed = [...pool].reverse();
    const d1 = shuffleWith(stableOrder(pool), randomFor('seed1')).map((a) => a.mal_id);
    const d2 = shuffleWith(stableOrder(reversed), randomFor('seed1')).map((a) => a.mal_id);
    const d3 = shuffleWith(stableOrder(pool), randomFor('seed2')).map((a) => a.mal_id);
    expect(d1).toEqual(d2);
    expect(d1).not.toEqual(d3);
  });

  it('shuffle keeps every element exactly once', () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffleWith(list).sort()).toEqual(list);
    expect(list).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

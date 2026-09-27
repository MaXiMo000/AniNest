import { describe, it, expect } from 'vitest';
import { drawDistinctYears, isChronological, cardsForStreak } from '../src/pages/games/timeline.js';
import { randomFor } from '../src/lib/rng.js';

// The choice games' helpers moved to the server (backend/src/lib/roundGames.js).
describe('timeline', () => {
  const pool = Array.from({ length: 30 }, (_, i) => ({ mal_id: i, year: 1990 + (i % 10) }));

  it('draws cards with distinct years', () => {
    const cards = drawDistinctYears(pool, 5, randomFor('z'));
    expect(new Set(cards.map((c) => c.year)).size).toBe(5);
    expect(drawDistinctYears(pool, 11, randomFor('z'))).toBeNull();
  });

  it('checks order and grows with the streak', () => {
    expect(isChronological([{ year: 1990 }, { year: 2001 }, { year: 2020 }])).toBe(true);
    expect(isChronological([{ year: 2001 }, { year: 1990 }])).toBe(false);
    expect(cardsForStreak(0)).toBe(4);
    expect(cardsForStreak(5)).toBe(5);
  });
});

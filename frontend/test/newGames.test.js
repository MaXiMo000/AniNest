import { describe, it, expect } from 'vitest';
import { valueChoices, drawUnused } from '../src/lib/choiceGame.js';
import { drawDistinctYears, isChronological, cardsForStreak } from '../src/pages/games/timeline.js';
import { EMOJI_PUZZLES } from '../src/pages/games/emojiPuzzles.js';
import { randomFor } from '../src/lib/rng.js';

describe('choice game helpers', () => {
  it('valueChoices returns the answer plus 3 distinct others', () => {
    const c = valueChoices('MAPPA', ['MAPPA', 'Bones', 'Bones', 'Sunrise', 'Madhouse', 'Wit'], randomFor('x'));
    expect(c).toHaveLength(4);
    expect(new Set(c.map((x) => x.id)).size).toBe(4);
    expect(c.map((x) => x.id)).toContain('MAPPA');
  });

  it('drawUnused cycles through everything before repeating', () => {
    const list = [1, 2, 3].map((mal_id) => ({ mal_id }));
    const used = new Set();
    const rand = randomFor('y');
    const first = [0, 1, 2].map(() => drawUnused(list, used, rand).mal_id);
    expect(first.sort()).toEqual([1, 2, 3]);
    expect([1, 2, 3]).toContain(drawUnused(list, used, rand).mal_id);
  });

  it('emoji puzzles have unique titles and enough of them', () => {
    expect(EMOJI_PUZZLES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(EMOJI_PUZZLES.map((p) => p.title)).size).toBe(EMOJI_PUZZLES.length);
  });
});

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

import { describe, it, expect } from 'vitest';
import { HL_MODES, comboFor } from '../src/pages/games/higherLower.js';

// Right-or-wrong is decided by the server now (backend/src/lib/hlGame.js,
// tested in backend/test/api.test.js); this covers what's left on the page.
describe('higher or lower', () => {
  it('combo steps up at 5, 10 and 15', () => {
    expect([0, 4, 5, 9, 10, 15, 40].map(comboFor)).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });

  it('every mode has its own leaderboard slug and a readable number format', () => {
    const slugs = Object.values(HL_MODES).map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(HL_MODES.popularity.format(1_250_000)).toBe('1.3M');
    expect(HL_MODES.popularity.format(45_300)).toBe('45K');
    expect(HL_MODES.score.format(8.456)).toBe('8.5');
  });
});

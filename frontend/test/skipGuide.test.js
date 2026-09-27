import { describe, it, expect } from 'vitest';
import { skipRanges, skipGuideHTML } from '../src/lib/episodeGuide.js';

describe('episode skip guide', () => {
  it('collapses runs into ranges', () => {
    expect(skipRanges([108, 26, 97, 98, 99, 54, 100, 26])).toBe('26, 54, 97–100, 108');
    expect(skipRanges([])).toBe('');
  });
  it('says nothing when the flags are unavailable, and "no filler" when there is none', () => {
    expect(skipGuideHTML({ available: false, filler: [], recap: [] })).toBe('');
    expect(skipGuideHTML({ available: true, filler: [], recap: [] })).toContain('No filler');
  });
  it('lists filler and recap episodes', () => {
    const html = skipGuideHTML({ available: true, filler: [26, 27], recap: [50] });
    expect(html).toContain('2 filler episodes');
    expect(html).toContain('26–27');
    expect(html).toContain('Recap episode: 50');
  });
});

import { describe, it, expect } from 'vitest';
import { relativeTime } from '../src/pages/tournament.js';

describe('tournament relativeTime', () => {
  const now = Date.parse('2026-09-27T00:00:00Z');
  it('says how long until a round closes', () => {
    expect(relativeTime('2026-09-30T00:00:00Z', now)).toBe('in 3 days');
    expect(relativeTime('2026-09-27T05:00:00Z', now)).toBe('in 5 hours');
    expect(relativeTime('2026-09-27T00:00:20Z', now)).toBe('in 1 minute');
    expect(relativeTime('2026-09-26T00:00:00Z', now)).toBe('1 day ago');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { wrappedNudgeYear, wrappedNudgeHTML } from '../src/lib/wrappedNudge.js';

describe('Wrapped nudge', () => {
  beforeEach(() => localStorage.clear());
  it('runs through December and the first two weeks of January', () => {
    expect(wrappedNudgeYear(new Date(2026, 11, 1))).toBe(2026);
    expect(wrappedNudgeYear(new Date(2027, 0, 14))).toBe(2026);
    expect(wrappedNudgeYear(new Date(2027, 0, 15))).toBe(null);
    expect(wrappedNudgeYear(new Date(2026, 10, 30))).toBe(null);
  });
  it('shows only to signed-in people, until dismissed for that year', () => {
    const dec = new Date(2026, 11, 5);
    expect(wrappedNudgeHTML(null, dec)).toBe('');
    expect(wrappedNudgeHTML({ username: 'ann' }, dec)).toContain('#/wrapped?year=2026');
    localStorage.setItem('aninest-wrapped-nudge-2026', '1');
    expect(wrappedNudgeHTML({ username: 'ann' }, dec)).toBe('');
    expect(wrappedNudgeHTML({ username: 'ann' }, new Date(2027, 11, 5))).toContain('2027');
  });
  it('escapes the username', () => {
    expect(wrappedNudgeHTML({ username: '<b>x' }, new Date(2026, 11, 5))).not.toContain('<b>x');
  });
});

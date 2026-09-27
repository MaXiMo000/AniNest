import { describe, it, expect, beforeEach } from 'vitest';
import { recentlySeen, markSeen, freshFirst } from '../src/lib/recentlySeen.js';
import { drawQuiz, QUESTION_BANK } from '../src/lib/tasteQuiz.js';
import { randomFor } from '../src/lib/rng.js';

const pool = Array.from({ length: 40 }, (_, i) => ({ mal_id: i + 1, year: 1980 + i }));

describe('recently seen', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the newest ids, without duplicates, up to the limit', () => {
    for (const id of [1, 2, 3, 2]) markSeen('g', id, 3);
    expect(recentlySeen('g')).toEqual(['1', '3', '2']);
    markSeen('g', 4, 3);
    expect(recentlySeen('g')).toEqual(['3', '2', '4']);
  });

  it('freshFirst deals unseen items before anything seen recently', () => {
    for (let id = 1; id <= 10; id += 1) markSeen('g', id);
    const deck = freshFirst(pool, 'g');
    const firstThirty = deck.slice(-30).map((a) => a.mal_id); // pop() order starts at the end
    expect(firstThirty.every((id) => id > 10)).toBe(true);
    expect(deck).toHaveLength(40);
  });

  // Choice games are dealt by the server now, which remembers a signed-in
  // player's recent shows itself (backend test "next run deals shows...").

  it("a quiz retake avoids the previous run's questions", () => {
    const first = drawQuiz(randomFor('a'));
    const second = drawQuiz(randomFor('b'), undefined, new Set(first.map((q) => q.q)));
    const overlap = second.filter((q) => first.includes(q));
    // Only a thin category (2 length questions) may force a repeat.
    expect(overlap.length).toBeLessThanOrEqual(1);
    expect(QUESTION_BANK.length - first.length).toBeGreaterThanOrEqual(8);
  });

});

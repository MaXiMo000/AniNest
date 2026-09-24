import { describe, it, expect } from 'vitest';
import {
  synopsisSnippet, pickChoices, normalizeTitle, typedGuessMatches, poolForDifficulty, roundPoints,
} from '../src/lib/guessMechanic.js';
import { randomFor } from '../src/lib/rng.js';

const pool = Array.from({ length: 20 }, (_, i) => ({ mal_id: i + 1, title: `Show ${i + 1}`, members: (i + 1) * 100 }));

describe('guessMechanic', () => {
  it('redacts both the main and the English title from the synopsis', () => {
    const text = synopsisSnippet({ title: 'Shingeki no Kyojin', title_english: 'Attack on Titan', synopsis: 'In Attack on Titan, also Shingeki no Kyojin, walls. (Source: MAL)' });
    expect(text).not.toMatch(/Attack on Titan|Shingeki/);
    expect(text).not.toMatch(/Source/);
  });

  it('pickChoices includes the answer once plus distinct distractors, repeatably with a seed', () => {
    const answer = pool[4];
    const a = pickChoices(pool, answer, 3, randomFor('s'));
    const b = pickChoices(pool, answer, 3, randomFor('s'));
    expect(a.map((c) => c.mal_id)).toEqual(b.map((c) => c.mal_id));
    expect(a).toHaveLength(4);
    expect(a.filter((c) => c.mal_id === answer.mal_id)).toHaveLength(1);
    expect(new Set(a.map((c) => c.title)).size).toBe(4);
  });

  it('normalizes titles for typed answers', () => {
    expect(normalizeTitle('  The Café: Déjà Vu!! ')).toBe('cafe deja vu');
  });

  it('typed answers match main title, English title, or the part before a subtitle', () => {
    const anime = { title: "Sousou no Frieren: Beyond Journey's End", title_english: "Frieren: Beyond Journey's End" };
    expect(typedGuessMatches("frieren beyond journey's end", anime)).toBe(true);
    expect(typedGuessMatches('Frieren', anime)).toBe(true);
    expect(typedGuessMatches('sousou no frieren', anime)).toBe(true);
    expect(typedGuessMatches('fri', anime)).toBe(false);
    expect(typedGuessMatches('', anime)).toBe(false);
    expect(typedGuessMatches('Naruto', anime)).toBe(false);
  });

  it('difficulty picks the famous or the obscure end of the pool', () => {
    const easy = poolForDifficulty(pool, 'easy');
    const hard = poolForDifficulty(pool, 'hard');
    expect(Math.min(...easy.map((a) => a.members))).toBeGreaterThan(Math.max(...hard.map((a) => a.members)) - 1000);
    expect(easy.length).toBeGreaterThanOrEqual(12);
    expect(poolForDifficulty(pool, 'normal')).toBe(pool);
  });

  it('round points fall with clues and rise with the streak', () => {
    expect(roundPoints(0, 0)).toBe(100);
    expect(roundPoints(2, 0)).toBe(60);
    expect(roundPoints(9, 0)).toBe(20);
    expect(roundPoints(0, 30)).toBe(150);
  });
});

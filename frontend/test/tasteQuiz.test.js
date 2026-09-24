import { describe, it, expect } from 'vitest';
import {
  QUESTION_BANK, drawQuiz, buildProfile, scoreAnime, recommend, personaFor, QUIZ_LENGTH,
} from '../src/lib/tasteQuiz.js';
import { randomFor } from '../src/lib/rng.js';

const ANILIST_GENRES = new Set(['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller']);

describe('taste quiz', () => {
  it('has 30+ questions of four options, all genres in AniList\'s enum', () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(30);
    for (const q of QUESTION_BANK) {
      expect(q.options).toHaveLength(4);
      for (const o of q.options) for (const g of Object.keys(o.g || {})) expect(ANILIST_GENRES.has(g), g).toBe(true);
    }
  });

  it('a drawn quiz has no repeats and always covers mood, length and era/format', () => {
    for (let s = 0; s < 20; s += 1) {
      const quiz = drawQuiz(randomFor(`s${s}`));
      expect(quiz).toHaveLength(QUIZ_LENGTH);
      expect(new Set(quiz).size).toBe(QUIZ_LENGTH);
      const dims = quiz.map((q) => q.dim);
      expect(dims).toContain('mood');
      expect(dims).toContain('length');
      expect(dims.some((d) => d === 'era' || d === 'format')).toBe(true);
    }
  });

  it('profile and scoring reward matching genre, length, era and format', () => {
    const profile = buildProfile([{ g: { Comedy: 3 } }, { len: 'short' }, { era: 'modern' }, { fmt: 'movie' }]);
    const match = { title: 'A', genres: [{ name: 'Comedy' }], episodes: 1, year: 2020, type: 'Movie', score: 7 };
    const miss = { title: 'B', genres: [{ name: 'Horror' }], episodes: 50, year: 1995, type: 'TV', score: 9 };
    const a = scoreAnime(match, profile);
    expect(a.total).toBeGreaterThan(scoreAnime(miss, profile).total);
    expect(a.reasons.join(' ')).toMatch(/Comedy/);
    expect(a.reasons).toContain('it’s a quick watch');
  });

  it('recommend returns distinct titles, best match first', () => {
    const profile = buildProfile([{ g: { Sports: 5 } }]);
    const pool = [
      { title: 'Ball', genres: [{ name: 'Sports' }], score: 7 },
      { title: 'Ball', genres: [{ name: 'Sports' }], score: 7 },
      { title: 'Other', genres: [{ name: 'Drama' }], score: 9 },
      { title: 'Third', genres: [{ name: 'Comedy' }], score: 6 },
    ];
    const picks = recommend(pool, profile, 3, () => 0);
    expect(picks.map((p) => p.anime.title)).toEqual(['Ball', 'Other', 'Third']);
  });

  it('persona comes from the strongest genre', () => {
    expect(personaFor(buildProfile([{ g: { Mystery: 3, Comedy: 1 } }])).title).toBe('The Detective');
    expect(personaFor(buildProfile([])).title).toBe('The All-Rounder');
  });
});

import { shuffle } from './shuffle.js';

const SNIPPET_MAX_CHARS = 260;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strips the trailing "(Source: ...)" citation Jikan/AniList synopses often
// carry, then blacks out the anime's own title if it happens to appear in
// the text — otherwise the clue can just hand over the answer. Shared by
// Guess the Anime and the Daily Challenge, which reuses this exact mechanic.
export function synopsisSnippet(anime) {
  let text = (anime.synopsis || '').replace(/\(Source:.*$/is, '').trim();
  for (const t of [anime.title, anime.title_english].filter(Boolean)) {
    text = text.replace(new RegExp(escapeRegExp(t), 'gi'), '████');
  }
  if (text.length > SNIPPET_MAX_CHARS) {
    text = text.slice(0, SNIPPET_MAX_CHARS).replace(/\s+\S*$/, '') + '…';
  }
  return text || 'No synopsis available for this mystery entry — go by the cover alone!';
}

// Builds a shuffled multiple-choice set: the real answer plus `count`
// distractors drawn from `pool`, de-duplicated by title (a pool can contain
// near-duplicate entries, e.g. a TV series and its recap film, that would
// otherwise make a round trivially solvable by elimination).
export function pickChoices(pool, answer, count = 3, rand = Math.random) {
  const seenTitles = new Set([answer.title.toLowerCase()]);
  const distractors = [];
  for (const a of shuffle(pool, rand)) {
    if (a.mal_id === answer.mal_id) continue;
    const key = a.title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    distractors.push(a);
    if (distractors.length === count) break;
  }
  return shuffle([answer, ...distractors], rand);
}

// Loose comparison for a typed answer: case, punctuation, spacing and a
// leading "the" don't matter, so "attack on titan" matches "Attack on Titan".
export function normalizeTitle(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

// A typed guess is right when it matches the main or English title, or is
// the main title minus a subtitle ("Frieren" for "Frieren: Beyond Journey's
// End"), as long as that head is at least 4 characters.
export function typedGuessMatches(guess, anime) {
  const g = normalizeTitle(guess);
  if (g.length < 2) return false;
  const titles = [anime.title, anime.title_english].filter(Boolean);
  for (const t of titles) {
    const full = normalizeTitle(t);
    if (g === full) return true;
    const head = normalizeTitle(String(t).split(/[:\-–—]/)[0]);
    if (head.length >= 4 && g === head) return true;
  }
  return false;
}

// Difficulty buckets by popularity (members). Easy draws from the best-known
// third of the pool, Hard from the lesser-known 60%, Normal from everything.
export function poolForDifficulty(pool, difficulty) {
  if (difficulty === 'normal') return pool;
  const byFame = [...pool].sort((a, b) => (b.members || 0) - (a.members || 0));
  if (difficulty === 'easy') return byFame.slice(0, Math.max(12, Math.ceil(byFame.length * 0.35)));
  if (difficulty === 'hard') return byFame.slice(Math.floor(byFame.length * 0.4));
  return pool;
}

// Points for a correct answer: fewer clues and a longer streak pay more.
export function roundPoints(cluesUsed, streak) {
  return Math.max(20, 100 - cluesUsed * 20) + Math.min(streak, 10) * 5;
}

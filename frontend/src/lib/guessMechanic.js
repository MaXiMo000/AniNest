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
  const titleRe = new RegExp(escapeRegExp(anime.title), 'gi');
  text = text.replace(titleRe, '████');
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

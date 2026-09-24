// The Taste Quiz's question bank and scoring. Pure (no DOM) so it can be
// unit-tested, and so the page stays about rendering.
//
// Each option carries weights along several dimensions instead of a single
// genre: `g` (genre -> points), and optionally `len` (short/long), `era`
// (classic/modern), `fmt` (movie/tv). Genre names must be AniList genre enum
// values - the pool is built from AniList, so any other name never matches.

import { shuffle } from './shuffle.js';

export const QUESTION_BANK = [
  // ---- mood
  { dim: 'mood', q: 'Pick a mood for tonight:', options: [
    { emoji: '😂', label: 'Make me laugh', g: { Comedy: 3 } },
    { emoji: '😢', label: 'Make me cry', g: { Drama: 3 } },
    { emoji: '😱', label: 'Creep me out', g: { Horror: 3, Thriller: 1 } },
    { emoji: '💥', label: 'Get my heart racing', g: { Action: 3 } },
  ] },
  { dim: 'mood', q: 'It’s a rainy Sunday. You want…', options: [
    { emoji: '☕', label: 'Something cozy', g: { 'Slice of Life': 3, Comedy: 1 } },
    { emoji: '🕯️', label: 'A slow-burn mystery', g: { Mystery: 3, Psychological: 1 } },
    { emoji: '🗺️', label: 'A grand journey', g: { Adventure: 3, Fantasy: 1 } },
    { emoji: '💘', label: 'Butterflies', g: { Romance: 3 } },
  ] },
  { dim: 'mood', q: 'Your comfort food is…', options: [
    { emoji: '🍜', label: 'Ramen at 2am', g: { 'Slice of Life': 2, Drama: 1 } },
    { emoji: '🍰', label: 'Something sweet', g: { Romance: 2, Comedy: 1 } },
    { emoji: '🌶️', label: 'The spiciest thing on the menu', g: { Action: 2, Thriller: 1 } },
    { emoji: '🍱', label: 'A bento with a bit of everything', g: { Adventure: 1, Comedy: 1, Fantasy: 1 } },
  ] },
  { dim: 'mood', q: 'Pick a soundtrack:', options: [
    { emoji: '🎸', label: 'Loud rock', g: { Action: 2, Music: 1 } },
    { emoji: '🎻', label: 'Sweeping orchestra', g: { Fantasy: 2, Drama: 1 } },
    { emoji: '🎹', label: 'Lo-fi piano', g: { 'Slice of Life': 2, Romance: 1 } },
    { emoji: '🎛️', label: 'Synthwave', g: { 'Sci-Fi': 2, Mecha: 1 } },
  ] },
  // ---- setting
  { dim: 'setting', q: 'Pick your dream setting:', options: [
    { emoji: '🏫', label: 'A slice of everyday life', g: { 'Slice of Life': 3 } },
    { emoji: '🧙', label: 'A world of magic and monsters', g: { Fantasy: 3 } },
    { emoji: '🛰️', label: 'Deep space or a far future', g: { 'Sci-Fi': 3 } },
    { emoji: '🔍', label: 'A city hiding dark secrets', g: { Mystery: 3 } },
  ] },
  { dim: 'setting', q: 'Where would you live?', options: [
    { emoji: '🏯', label: 'A historical Japanese town', g: { Drama: 1, Adventure: 1, Supernatural: 1 } },
    { emoji: '🌆', label: 'A neon cyberpunk sprawl', g: { 'Sci-Fi': 3, Psychological: 1 } },
    { emoji: '🏝️', label: 'A tiny seaside village', g: { 'Slice of Life': 3 } },
    { emoji: '🐉', label: 'A kingdom at war with dragons', g: { Fantasy: 3, Action: 1 } },
  ] },
  { dim: 'setting', q: 'Your ideal club at school:', options: [
    { emoji: '🏐', label: 'A sports team', g: { Sports: 3 } },
    { emoji: '🎤', label: 'The light-music club', g: { Music: 3 } },
    { emoji: '👻', label: 'The occult research club', g: { Supernatural: 3 } },
    { emoji: '🍵', label: 'The do-nothing club', g: { Comedy: 2, 'Slice of Life': 2 } },
  ] },
  { dim: 'setting', q: 'You wake up in another world. It’s…', options: [
    { emoji: '⚔️', label: 'A game-like fantasy realm', g: { Fantasy: 2, Adventure: 2 } },
    { emoji: '🧟', label: 'A ruined post-apocalypse', g: { Action: 2, Horror: 1, Drama: 1 } },
    { emoji: '🚀', label: 'A starship on a long voyage', g: { 'Sci-Fi': 3 } },
    { emoji: '🏠', label: 'My own world, but slightly off', g: { Psychological: 2, Mystery: 1 } },
  ] },
  // ---- pace / style
  { dim: 'pace', q: 'What’s your ideal pace?', options: [
    { emoji: '💞', label: 'Sweet, slow-building feelings', g: { Romance: 3 } },
    { emoji: '🧩', label: 'Twists that mess with your head', g: { Psychological: 3 } },
    { emoji: '🏆', label: 'Training arcs and big matches', g: { Sports: 3 } },
    { emoji: '⚔️', label: 'Nonstop adventure', g: { Adventure: 3 } },
  ] },
  { dim: 'pace', q: 'The best episode is one with…', options: [
    { emoji: '🥊', label: 'A huge fight', g: { Action: 3 } },
    { emoji: '😳', label: 'A confession', g: { Romance: 3 } },
    { emoji: '🤯', label: 'A plot twist', g: { Mystery: 2, Psychological: 2 } },
    { emoji: '🤣', label: 'A gag that never ends', g: { Comedy: 3 } },
  ] },
  { dim: 'pace', q: 'A villain should be…', options: [
    { emoji: '😈', label: 'Terrifyingly smart', g: { Psychological: 2, Thriller: 2 } },
    { emoji: '👹', label: 'A literal monster', g: { Horror: 2, Supernatural: 1 } },
    { emoji: '🤝', label: 'Someone you end up rooting for', g: { Drama: 3 } },
    { emoji: '🙃', label: 'Not needed at all', g: { 'Slice of Life': 3 } },
  ] },
  { dim: 'pace', q: 'Pick a protagonist:', options: [
    { emoji: '😤', label: 'Hot-headed and loud', g: { Action: 2, Sports: 1 } },
    { emoji: '🧠', label: 'Quiet genius', g: { Mystery: 2, Psychological: 1 } },
    { emoji: '🫶', label: 'Kind to a fault', g: { Drama: 2, 'Slice of Life': 1 } },
    { emoji: '😎', label: 'Overpowered and chill', g: { Fantasy: 2, Comedy: 1 } },
  ] },
  // ---- power
  { dim: 'power', q: 'Pick a power:', options: [
    { emoji: '🤖', label: 'Pilot a giant robot', g: { Mecha: 3 } },
    { emoji: '🎶', label: 'Move people with music', g: { Music: 3 } },
    { emoji: '👻', label: 'See what others can’t', g: { Supernatural: 3 } },
    { emoji: '😰', label: 'Survive against all odds', g: { Thriller: 3 } },
  ] },
  { dim: 'power', q: 'Pick a sidekick:', options: [
    { emoji: '🐱', label: 'A talking cat', g: { Supernatural: 2, Comedy: 1 } },
    { emoji: '🛸', label: 'An AI companion', g: { 'Sci-Fi': 3 } },
    { emoji: '🧚', label: 'A tiny fairy', g: { Fantasy: 3 } },
    { emoji: '🏀', label: 'Your rival-turned-best-friend', g: { Sports: 2, Action: 1 } },
  ] },
  { dim: 'power', q: 'Pick a weapon:', options: [
    { emoji: '🗡️', label: 'A cursed sword', g: { Supernatural: 2, Action: 1 } },
    { emoji: '🔫', label: 'A mech-mounted railgun', g: { Mecha: 3 } },
    { emoji: '📓', label: 'A notebook and a plan', g: { Psychological: 3 } },
    { emoji: '🍳', label: 'A frying pan (for cooking)', g: { 'Slice of Life': 2, Comedy: 1 } },
  ] },
  // ---- ending / tone
  { dim: 'ending', q: 'How should it end?', options: [
    { emoji: '😆', label: 'Everyone laughing together', g: { Comedy: 3 } },
    { emoji: '💔', label: 'Bittersweet, unforgettable', g: { Drama: 3 } },
    { emoji: '🎉', label: 'A hard-won victory', g: { Action: 2, Sports: 1 } },
    { emoji: '🥰', label: 'Warm and cozy', g: { 'Slice of Life': 3 } },
  ] },
  { dim: 'ending', q: 'After the finale you want to feel…', options: [
    { emoji: '😭', label: 'Emotionally wrecked', g: { Drama: 3 } },
    { emoji: '🤔', label: 'Like I need to rewatch it', g: { Psychological: 2, Mystery: 2 } },
    { emoji: '🔥', label: 'Hyped', g: { Action: 2, Adventure: 1 } },
    { emoji: '😊', label: 'Lighter than before', g: { Comedy: 2, Romance: 1 } },
  ] },
  { dim: 'ending', q: 'Pick a sky:', options: [
    { emoji: '🌅', label: 'Golden sunset', g: { Romance: 2, Drama: 1 } },
    { emoji: '🌌', label: 'Starfield', g: { 'Sci-Fi': 2, Adventure: 1 } },
    { emoji: '🌩️', label: 'Thunderstorm', g: { Thriller: 2, Horror: 1 } },
    { emoji: '🌸', label: 'Cherry blossoms', g: { 'Slice of Life': 2, Romance: 1 } },
  ] },
  // ---- length
  { dim: 'length', q: 'How much time have you got?', options: [
    { emoji: '⚡', label: 'One weekend, tops', len: 'short' },
    { emoji: '📆', label: 'A couple of weeks', len: 'short' },
    { emoji: '🗓️', label: 'I want something that lasts', len: 'long' },
    { emoji: '♾️', label: 'Give me hundreds of episodes', len: 'long' },
  ] },
  { dim: 'length', q: 'Your binge style:', options: [
    { emoji: '🍿', label: 'Finish it in one sitting', len: 'short', fmt: 'movie' },
    { emoji: '📺', label: 'A season a week', len: 'short' },
    { emoji: '🏃', label: 'A marathon I can live in', len: 'long' },
    { emoji: '🤷', label: 'Length doesn’t matter', g: { Adventure: 1 } },
  ] },
  // ---- era
  { dim: 'era', q: 'Pick an art style:', options: [
    { emoji: '📼', label: 'Hand-drawn 90s cel look', era: 'classic' },
    { emoji: '💿', label: 'Crisp 2000s digital', era: 'classic' },
    { emoji: '✨', label: 'Modern and super polished', era: 'modern' },
    { emoji: '🎨', label: 'Whatever — story first', g: { Drama: 1 } },
  ] },
  { dim: 'era', q: 'Classics or new releases?', options: [
    { emoji: '🏛️', label: 'Show me the classics', era: 'classic' },
    { emoji: '🆕', label: 'What’s everyone watching now?', era: 'modern' },
    { emoji: '🎲', label: 'Surprise me', g: { Mystery: 1 } },
    { emoji: '⚖️', label: 'A bit of both', g: { Adventure: 1 } },
  ] },
  // ---- format
  { dim: 'format', q: 'Movie night or a series?', options: [
    { emoji: '🎬', label: 'A movie, please', fmt: 'movie' },
    { emoji: '📺', label: 'A series I can follow', fmt: 'tv' },
    { emoji: '🎞️', label: 'Anything with great animation', g: { Action: 1, Fantasy: 1 } },
    { emoji: '🤝', label: 'Whatever my friends are watching', era: 'modern' },
  ] },
  // ---- extra variety
  { dim: 'extra', q: 'Pick a place to hang out:', options: [
    { emoji: '🎮', label: 'An arcade', g: { Comedy: 1, 'Sci-Fi': 1, Sports: 1 } },
    { emoji: '📚', label: 'A library at midnight', g: { Mystery: 2, Supernatural: 1 } },
    { emoji: '🏟️', label: 'A packed stadium', g: { Sports: 3 } },
    { emoji: '🎪', label: 'A festival', g: { Romance: 1, 'Slice of Life': 1, Music: 1 } },
  ] },
  { dim: 'extra', q: 'Your friends call you…', options: [
    { emoji: '🤡', label: 'The joker', g: { Comedy: 3 } },
    { emoji: '🧭', label: 'The explorer', g: { Adventure: 3 } },
    { emoji: '🫂', label: 'The softie', g: { Romance: 2, Drama: 1 } },
    { emoji: '🕵️', label: 'The detective', g: { Mystery: 3 } },
  ] },
  { dim: 'extra', q: 'Pick a pet:', options: [
    { emoji: '🐺', label: 'A wolf', g: { Fantasy: 2, Action: 1 } },
    { emoji: '🦉', label: 'An owl', g: { Mystery: 2, Supernatural: 1 } },
    { emoji: '🐶', label: 'A goofy dog', g: { Comedy: 2, 'Slice of Life': 1 } },
    { emoji: '🦾', label: 'A robot dog', g: { 'Sci-Fi': 2, Mecha: 1 } },
  ] },
  { dim: 'extra', q: 'What would you fight for?', options: [
    { emoji: '👊', label: 'My friends', g: { Action: 2, Adventure: 1 } },
    { emoji: '🏅', label: 'Being the best', g: { Sports: 3 } },
    { emoji: '❤️', label: 'The one I love', g: { Romance: 3 } },
    { emoji: '🌍', label: 'The truth', g: { Mystery: 1, Psychological: 1, Thriller: 1 } },
  ] },
  { dim: 'extra', q: 'Pick a weekend plan:', options: [
    { emoji: '⛺', label: 'Camping trip', g: { 'Slice of Life': 2, Adventure: 1 } },
    { emoji: '🎢', label: 'Theme park', g: { Comedy: 2, Romance: 1 } },
    { emoji: '🏚️', label: 'Explore an abandoned house', g: { Horror: 3 } },
    { emoji: '🎧', label: 'A concert', g: { Music: 3 } },
  ] },
  { dim: 'extra', q: 'Choose a magic item:', options: [
    { emoji: '💍', label: 'A ring that grants wishes', g: { Fantasy: 2, Drama: 1 } },
    { emoji: '⏳', label: 'An hourglass that rewinds time', g: { 'Sci-Fi': 1, Psychological: 1, Thriller: 1 } },
    { emoji: '🎭', label: 'A mask that hides your identity', g: { Mystery: 2, Action: 1 } },
    { emoji: '🧸', label: 'A plushie that talks', g: { Comedy: 2, Supernatural: 1 } },
  ] },
  { dim: 'extra', q: 'Pick a job:', options: [
    { emoji: '🧑‍🍳', label: 'Chef', g: { 'Slice of Life': 3 } },
    { emoji: '🧑‍🚀', label: 'Astronaut', g: { 'Sci-Fi': 3 } },
    { emoji: '🕴️', label: 'Spy', g: { Action: 1, Thriller: 2 } },
    { emoji: '🧑‍⚕️', label: 'Doctor', g: { Drama: 3 } },
  ] },
  { dim: 'extra', q: 'How scary is too scary?', options: [
    { emoji: '🙈', label: 'Nothing scary, thanks', g: { Comedy: 1, 'Slice of Life': 1, Romance: 1 } },
    { emoji: '😬', label: 'A little tension is fun', g: { Mystery: 2, Thriller: 1 } },
    { emoji: '💀', label: 'The scarier the better', g: { Horror: 3 } },
    { emoji: '🧠', label: 'Scary for your brain', g: { Psychological: 3 } },
  ] },
  { dim: 'extra', q: 'Your ideal rival:', options: [
    { emoji: '⚽', label: 'The other team’s ace', g: { Sports: 3 } },
    { emoji: '🎼', label: 'A musical prodigy', g: { Music: 3 } },
    { emoji: '🦹', label: 'An evil mastermind', g: { Thriller: 2, Psychological: 1 } },
    { emoji: '💌', label: 'A love rival', g: { Romance: 2, Comedy: 1 } },
  ] },
  { dim: 'extra', q: 'Giant robots are…', options: [
    { emoji: '🤩', label: 'The coolest thing ever', g: { Mecha: 3 } },
    { emoji: '🙂', label: 'Fine in small doses', g: { 'Sci-Fi': 1, Action: 1 } },
    { emoji: '😐', label: 'Not my thing', g: { 'Slice of Life': 1, Romance: 1 } },
    { emoji: '🧐', label: 'Only if the story is deep', g: { Psychological: 2, Drama: 1 } },
  ] },
];

export const QUIZ_LENGTH = 8;

// Draws a quiz: always one length, one era/format and one mood question, the
// rest random - so every run can shape all the dimensions, not just genre.
// Questions whose text is in `avoid` (recent runs) are only used when there
// aren't enough others, so a retake mostly asks new things.
export function drawQuiz(rand = Math.random, length = QUIZ_LENGTH, avoid = new Set()) {
  const freshFirst = (list) => {
    const s = shuffle(list, rand);
    return [...s.filter((q) => !avoid.has(q.q)), ...s.filter((q) => avoid.has(q.q))];
  };
  const byDim = (d) => QUESTION_BANK.filter((q) => q.dim === d);
  const required = [
    freshFirst(byDim('mood'))[0],
    freshFirst(byDim('length'))[0],
    freshFirst([...byDim('era'), ...byDim('format')])[0],
  ];
  const rest = freshFirst(QUESTION_BANK.filter((q) => !required.includes(q))).slice(0, length - required.length);
  return shuffle([...required, ...rest], rand);
}

// Folds the chosen options into one taste profile.
export function buildProfile(answers) {
  const profile = { g: {}, len: {}, era: {}, fmt: {} };
  for (const a of answers) {
    for (const [genre, w] of Object.entries(a.g || {})) profile.g[genre] = (profile.g[genre] || 0) + w;
    if (a.len) profile.len[a.len] = (profile.len[a.len] || 0) + 1;
    if (a.era) profile.era[a.era] = (profile.era[a.era] || 0) + 1;
    if (a.fmt) profile.fmt[a.fmt] = (profile.fmt[a.fmt] || 0) + 1;
  }
  return profile;
}

function lengthOf(a) {
  const eps = Number(a.episodes) || 0;
  if (!eps) return null;
  return eps <= 13 ? 'short' : eps >= 24 ? 'long' : null;
}
function eraOf(a) {
  const y = Number(a.year) || 0;
  if (!y) return null;
  return y < 2010 ? 'classic' : y >= 2015 ? 'modern' : null;
}
function formatOf(a) {
  return a.type === 'Movie' ? 'movie' : 'tv';
}

// Scores one anime against a profile and says why, for the "because…" line.
export function scoreAnime(anime, profile) {
  let total = 0;
  const reasons = [];
  const matched = [];
  for (const g of anime.genres || []) {
    const w = profile.g[g.name];
    if (w) { total += w; matched.push([g.name, w]); }
  }
  matched.sort((a, b) => b[1] - a[1]);
  if (matched.length) reasons.push(`you lean ${matched.slice(0, 2).map(([n]) => n).join(' + ')}`);
  const len = lengthOf(anime);
  if (len && profile.len[len]) { total += 2 * profile.len[len]; reasons.push(len === 'short' ? 'it’s a quick watch' : 'it’s a long ride'); }
  const era = eraOf(anime);
  if (era && profile.era[era]) { total += 2 * profile.era[era]; reasons.push(era === 'classic' ? 'you like the classics' : 'you want something recent'); }
  const fmt = formatOf(anime);
  if (profile.fmt[fmt]) { total += 2 * profile.fmt[fmt]; reasons.push(fmt === 'movie' ? 'it’s a movie' : 'it’s a series'); }
  // A small nudge toward well-rated picks, never enough to beat taste.
  total += (Number(anime.score) || 0) * 0.3;
  return { total, reasons };
}

// Top `count` recommendations, de-duplicated by title. A little randomness
// among near-ties keeps retakes from always giving the identical list.
export function recommend(pool, profile, count = 3, rand = Math.random) {
  const scored = pool
    .map((anime) => ({ anime, ...scoreAnime(anime, profile) }))
    .map((r) => ({ ...r, jitter: r.total + rand() * 0.8 }))
    .sort((a, b) => b.jitter - a.jitter);
  const out = [];
  const seen = new Set();
  for (const r of scored) {
    const key = r.anime.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length === count) break;
  }
  return out;
}

const PERSONAS = {
  Comedy: ['🤡', 'The Class Clown'],
  Drama: ['🎭', 'The Heartfelt Soul'],
  Horror: ['🕯️', 'The Fearless Night Owl'],
  Action: ['🔥', 'The Hype Machine'],
  'Slice of Life': ['☕', 'The Cozy Connoisseur'],
  Fantasy: ['🧙', 'The Dreamweaver'],
  'Sci-Fi': ['🛰️', 'The Future Seeker'],
  Mystery: ['🕵️', 'The Detective'],
  Romance: ['💘', 'The Hopeless Romantic'],
  Psychological: ['🧠', 'The Mind Bender'],
  Sports: ['🏆', 'The Competitor'],
  Adventure: ['🧭', 'The Explorer'],
  Mecha: ['🤖', 'The Pilot'],
  Music: ['🎶', 'The Performer'],
  Supernatural: ['👻', 'The Spirit Seer'],
  Thriller: ['😰', 'The Thrill Seeker'],
};

export function personaFor(profile) {
  const top = Object.entries(profile.g).sort((a, b) => b[1] - a[1]);
  const [genre] = top[0] || [];
  const [emoji, title] = PERSONAS[genre] || ['🌈', 'The All-Rounder'];
  return { emoji, title, topGenres: top.slice(0, 3).map(([g]) => g) };
}

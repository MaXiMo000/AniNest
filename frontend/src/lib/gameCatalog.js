// Every Game Zone game in one list: the hub, the leaderboard picker and the
// stats page all read from here, so adding a game is one entry (plus its
// page and its backend slug in backend/src/lib/games.js).
//
// `boards`: leaderboard slugs this game posts to (the first is its main one).
// `local`: localStorage stats keys (lib/gameKit.js) that hold its personal
// bests - usually the same as the board slugs.

export const GAME_CATALOG = [
  {
    id: 'daily', emoji: '📅', title: 'Daily Challenge', href: '#/games/daily', group: 'daily',
    desc: 'One shared mystery anime a day. Four guesses, Wordle-style, shareable.',
    gradient: 'linear-gradient(135deg, #ffd23f, #ff7a1a)', dailyPrefix: 'aninest_daily_', boards: [], local: [],
  },
  {
    id: 'manga-daily', emoji: '📖', title: 'Manga Daily', href: '#/games/manga-daily', group: 'daily', isNew: true,
    desc: 'The same idea for manga: one shared mystery manga every day.',
    gradient: 'linear-gradient(135deg, #17e8a0, #00d9ff)', dailyPrefix: 'aninest_manga_daily_', boards: [], local: [],
  },
  {
    id: 'guess-the-anime', emoji: '🕵️', title: 'Guess the Anime', href: '#/games/guess-the-anime', group: 'streak',
    desc: 'Blurred cover, clues to buy, three lives. Easy, Normal, Hard, typed answers or a 60s Blitz.',
    gradient: 'linear-gradient(135deg, #ff2d78, #7b2ff7)',
    boards: [
      { slug: 'guess-the-anime', label: 'Normal' }, { slug: 'gta-hard', label: 'Hard' }, { slug: 'gta-blitz', label: 'Blitz' },
    ],
    local: ['guess-the-anime', 'gta-hard', 'gta-blitz', 'gta-local-easy'],
  },
  {
    id: 'higher-lower', emoji: '📈', title: 'Higher or Lower', href: '#/games/higher-lower', group: 'streak',
    desc: 'Score, popularity, episodes or release year: is the challenger higher or lower?',
    gradient: 'linear-gradient(135deg, #00d9ff, #7b2ff7)',
    boards: [
      { slug: 'higher-lower', label: 'Score' }, { slug: 'hl-popularity', label: 'Popularity' },
      { slug: 'hl-episodes', label: 'Episodes' }, { slug: 'hl-year', label: 'Year' },
    ],
    local: ['higher-lower', 'hl-popularity', 'hl-episodes', 'hl-year'],
  },
  {
    id: 'name-that-opening', emoji: '🎵', title: 'Name That Opening', href: '#/games/name-that-opening', group: 'streak', isNew: true,
    desc: 'Twelve seconds of an opening song. Which anime is it?',
    gradient: 'linear-gradient(135deg, #7b2ff7, #ff6ec7)',
    boards: [{ slug: 'name-that-opening', label: 'All' }], local: ['name-that-opening'],
  },
  {
    id: 'timeline', emoji: '📆', title: 'Timeline', href: '#/games/timeline', group: 'streak', isNew: true,
    desc: 'Put four (then five) anime in release order, oldest first.',
    gradient: 'linear-gradient(135deg, #ff7a1a, #ff2d78)',
    boards: [{ slug: 'timeline', label: 'All' }], local: ['timeline'],
  },
  {
    id: 'emoji-plot', emoji: '😀', title: 'Emoji Plot', href: '#/games/emoji-plot', group: 'streak', isNew: true,
    desc: 'A famous anime told only in emoji. Can you decode it?',
    gradient: 'linear-gradient(135deg, #ffd23f, #17e8a0)',
    boards: [{ slug: 'emoji-plot', label: 'All' }], local: ['emoji-plot'],
  },
  {
    id: 'cast-call', emoji: '🎙️', title: 'Cast Call', href: '#/games/cast-call', group: 'streak', isNew: true,
    desc: 'The main cast and their voice actors. Name the show.',
    gradient: 'linear-gradient(135deg, #00d9ff, #17e8a0)',
    boards: [{ slug: 'cast-call', label: 'All' }], local: ['cast-call'],
  },
  {
    id: 'studio-match', emoji: '🏢', title: 'Studio Match', href: '#/games/studio-match', group: 'streak', isNew: true,
    desc: 'Which studio animated it? MAPPA, Bones, Madhouse…',
    gradient: 'linear-gradient(135deg, #7b2ff7, #00d9ff)',
    boards: [{ slug: 'studio-match', label: 'All' }], local: ['studio-match'],
  },
  {
    id: 'source-guess', emoji: '📚', title: 'Source Material', href: '#/games/source-guess', group: 'streak', isNew: true,
    desc: 'Manga, light novel, game or original? Guess where it came from.',
    gradient: 'linear-gradient(135deg, #ff6ec7, #ffd23f)',
    boards: [{ slug: 'source-guess', label: 'All' }], local: ['source-guess'],
  },
  {
    id: 'quiz', emoji: '🧭', title: 'Taste Quiz', href: '#/games/quiz', group: 'fun',
    desc: '8 questions from a bank of 33. Get your anime persona and three picks.',
    gradient: 'linear-gradient(135deg, #17e8a0, #7b2ff7)', boards: [], local: ['taste-quiz'],
  },
];

// All leaderboard slugs with a display name, for the leaderboard page.
export const BOARDS = GAME_CATALOG.flatMap((g) => g.boards.map((b) => ({
  slug: b.slug,
  game: g,
  label: g.boards.length > 1 ? `${g.title}: ${b.label}` : g.title,
})));

export function boardBySlug(slug) {
  return BOARDS.find((b) => b.slug === slug) || null;
}

export function playHrefFor(slug) {
  const board = boardBySlug(slug);
  if (!board) return '#/games';
  const hlMode = { 'hl-popularity': 'popularity', 'hl-episodes': 'episodes', 'hl-year': 'year' }[slug];
  return hlMode ? `${board.game.href}?mode=${hlMode}` : board.game.href;
}

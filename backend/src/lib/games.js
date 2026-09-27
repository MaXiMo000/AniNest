// Every game with a leaderboard. The server deals and judges all of them
// (lib/hlGame.js for Higher or Lower, lib/roundGames.js for the rest) and
// records each score itself, so adding a ranked game means adding it there
// and listing it here.
export const GAME_RULES = {
  'higher-lower': { label: 'Higher or Lower: Score' },
  'hl-popularity': { label: 'Higher or Lower: Popularity' },
  'hl-episodes': { label: 'Higher or Lower: Episodes' },
  'hl-year': { label: 'Higher or Lower: Release Year' },
  'guess-the-anime': { label: 'Guess the Anime' },
  'gta-hard': { label: 'Guess the Anime: Hard' },
  'gta-blitz': { label: 'Guess the Anime: Blitz' },
  'name-that-opening': { label: 'Name That Opening' },
  timeline: { label: 'Timeline' },
  'studio-match': { label: 'Studio Match' },
  'emoji-plot': { label: 'Emoji Plot' },
  'source-guess': { label: 'Source Material' },
  'cast-call': { label: 'Cast Call' },
};

export const GAMES = Object.keys(GAME_RULES);

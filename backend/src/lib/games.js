// Every game that posts a score to a leaderboard, with the least time one
// scoring round can honestly take (ms). Shared by the score/leaderboard routes
// (validating the `:game` param, the time-plausibility check) so adding a game
// is one entry here plus its frontend page - no schema change.
//
// Each client forces a reveal delay per round BEFORE a point counts, plus
// real decision time, so these sit above that floor for a fast human but far
// above "instant". Blitz games have a short reveal but a hard 60s clock.
export const GAME_RULES = {
  'higher-lower': { label: 'Higher or Lower: Score', minMsPerRound: 1500 },
  'hl-popularity': { label: 'Higher or Lower: Popularity', minMsPerRound: 1500 },
  'hl-episodes': { label: 'Higher or Lower: Episodes', minMsPerRound: 1500 },
  'hl-year': { label: 'Higher or Lower: Release Year', minMsPerRound: 1500 },
  'guess-the-anime': { label: 'Guess the Anime', minMsPerRound: 2500 },
  'gta-hard': { label: 'Guess the Anime: Hard', minMsPerRound: 2500 },
  'gta-blitz': { label: 'Guess the Anime: Blitz', minMsPerRound: 900, maxScore: 80 },
  'name-that-opening': { label: 'Name That Opening', minMsPerRound: 3000 },
  timeline: { label: 'Timeline', minMsPerRound: 4000 },
  'studio-match': { label: 'Studio Match', minMsPerRound: 2000 },
  'emoji-plot': { label: 'Emoji Plot', minMsPerRound: 2000 },
  'source-guess': { label: 'Source Material', minMsPerRound: 1500 },
  'cast-call': { label: 'Cast Call', minMsPerRound: 2500 },
};

export const GAMES = Object.keys(GAME_RULES);

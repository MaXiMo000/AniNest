// Achievements/badges: the last item on the original roadmap, deliberately
// kept "cheap" the way it was scoped there - no new table, no unlock
// events to track, nothing to migrate. A badge is just a pure function of
// data that already exists (favorites, reviews, game streaks, account
// age), recomputed fresh every time a profile is requested. If someone's
// 6th favorite pushes them over a threshold, the badge just appears next
// time their profile loads - there's nothing to "award" or backfill.
//
// Each category keeps only the highest tier reached (an if/else-if chain,
// not one badge per threshold crossed) - a user with 100 favorites sees
// "Archivist", not "Collector" + "Curator" + "Archivist" stacked.

const DAY_MS = 24 * 60 * 60 * 1000;

function pick(tiers, value) {
  for (const tier of tiers) {
    if (value >= tier.min) return tier;
  }
  return null;
}

const FAVORITES_TIERS = [
  { min: 100, id: 'favorites-gold', tier: 'gold', emoji: '💖', label: 'Archivist', desc: '100+ favorites' },
  { min: 25, id: 'favorites-silver', tier: 'silver', emoji: '💖', label: 'Curator', desc: '25+ favorites' },
  { min: 5, id: 'favorites-bronze', tier: 'bronze', emoji: '💖', label: 'Collector', desc: '5+ favorites' },
];

const REVIEWS_TIERS = [
  { min: 50, id: 'reviews-gold', tier: 'gold', emoji: '💬', label: 'Community Voice', desc: '50+ reviews written' },
  { min: 10, id: 'reviews-silver', tier: 'silver', emoji: '💬', label: 'Prolific Reviewer', desc: '10+ reviews written' },
  { min: 1, id: 'reviews-bronze', tier: 'bronze', emoji: '💬', label: 'Critic', desc: 'Wrote a review' },
];

const COMPLETED_TIERS = [
  { min: 25, id: 'completed-gold', tier: 'gold', emoji: '✅', label: 'Marathoner', desc: '25+ anime completed' },
  { min: 10, id: 'completed-silver', tier: 'silver', emoji: '✅', label: 'Completionist', desc: '10+ anime completed' },
];

const STREAK_TIERS = [
  { min: 30, id: 'streak-gold', tier: 'gold', emoji: '🎮', label: 'Unbeatable', desc: '30+ streak in a Game Zone game' },
  { min: 15, id: 'streak-silver', tier: 'silver', emoji: '🎮', label: 'Sharp Shooter', desc: '15+ streak in a Game Zone game' },
  { min: 5, id: 'streak-bronze', tier: 'bronze', emoji: '🎮', label: 'Warming Up', desc: '5+ streak in a Game Zone game' },
];

const MEMBER_TIERS = [
  { min: 365, id: 'member-gold', tier: 'gold', emoji: '🗓️', label: 'Veteran Member', desc: 'On AniNest for a year+' },
  { min: 30, id: 'member-bronze', tier: 'bronze', emoji: '🗓️', label: 'Regular', desc: 'On AniNest for a month+' },
];

const DAILY_TIERS = [
  { min: 50, id: 'daily-gold', tier: 'gold', emoji: '📅', label: 'Daily Legend', desc: '50+ daily challenges solved' },
  { min: 10, id: 'daily-silver', tier: 'silver', emoji: '📅', label: 'Daily Detective', desc: '10+ daily challenges solved' },
  { min: 1, id: 'daily-bronze', tier: 'bronze', emoji: '📅', label: 'Case Closed', desc: 'Solved a daily challenge' },
];

const VARIETY_TIERS = [
  { min: 10, id: 'variety-gold', tier: 'gold', emoji: '🕹️', label: 'Arcade Legend', desc: 'Scored in 10+ different games' },
  { min: 6, id: 'variety-silver', tier: 'silver', emoji: '🕹️', label: 'Arcade Regular', desc: 'Scored in 6+ different games' },
  { min: 3, id: 'variety-bronze', tier: 'bronze', emoji: '🕹️', label: 'Game Hopper', desc: 'Scored in 3+ different games' },
];

// One "mastery" badge per game for a 20+ best in it. Games not listed here
// simply have no mastery badge yet.
const MASTERY_THRESHOLD = 20;
const MASTERY = {
  'higher-lower': { emoji: '📈', label: 'Score Oracle' },
  'hl-popularity': { emoji: '👥', label: 'Trend Reader' },
  'hl-episodes': { emoji: '🎞️', label: 'Episode Counter' },
  'hl-year': { emoji: '⏳', label: 'Time Keeper' },
  'guess-the-anime': { emoji: '🕵️', label: 'Cover Detective' },
  'gta-hard': { emoji: '🧠', label: 'Deep Cut Expert' },
  'gta-blitz': { emoji: '⚡', label: 'Speed Demon' },
  'name-that-opening': { emoji: '🎵', label: 'Perfect Pitch' },
  timeline: { emoji: '📆', label: 'Historian' },
  'studio-match': { emoji: '🏢', label: 'Studio Insider' },
  'emoji-plot': { emoji: '😀', label: 'Emoji Whisperer' },
  'source-guess': { emoji: '📚', label: 'Source Scholar' },
  'cast-call': { emoji: '🎙️', label: 'Casting Director' },
};

function masteryBadges(streaksByGame = {}) {
  return Object.entries(streaksByGame)
    .filter(([game, best]) => MASTERY[game] && Number(best) >= MASTERY_THRESHOLD)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([game]) => ({
      id: `mastery-${game}`, tier: 'gold', emoji: MASTERY[game].emoji,
      label: MASTERY[game].label, desc: `${MASTERY_THRESHOLD}+ best in one game`,
    }));
}

// `streaksByGame` ({ slug: best }), `dailyWon` and the anime/manga daily wins
// are optional so older callers keep working; missing means zero.
export function computeBadges({
  favoritesCount, reviewsCount, completedCount, bestStreak, createdAt,
  streaksByGame = {}, dailyWon = 0,
}) {
  const accountAgeDays = createdAt ? (Date.now() - new Date(`${createdAt.replace(' ', 'T')}Z`).getTime()) / DAY_MS : 0;

  return [
    pick(FAVORITES_TIERS, favoritesCount),
    pick(REVIEWS_TIERS, reviewsCount),
    pick(COMPLETED_TIERS, completedCount),
    pick(STREAK_TIERS, bestStreak),
    pick(MEMBER_TIERS, accountAgeDays),
    pick(DAILY_TIERS, Number(dailyWon) || 0),
    pick(VARIETY_TIERS, Object.values(streaksByGame).filter((v) => Number(v) > 0).length),
  ]
    .filter(Boolean)
    .concat(masteryBadges(streaksByGame))
    .map(({ id, tier, emoji, label, desc }) => ({ id, tier, emoji, label, desc }));
}

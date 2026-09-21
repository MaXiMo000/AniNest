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

export function computeBadges({ favoritesCount, reviewsCount, completedCount, bestStreak, createdAt }) {
  const accountAgeDays = createdAt ? (Date.now() - new Date(`${createdAt.replace(' ', 'T')}Z`).getTime()) / DAY_MS : 0;

  return [
    pick(FAVORITES_TIERS, favoritesCount),
    pick(REVIEWS_TIERS, reviewsCount),
    pick(COMPLETED_TIERS, completedCount),
    pick(STREAK_TIERS, bestStreak),
    pick(MEMBER_TIERS, accountAgeDays),
  ]
    .filter(Boolean)
    .map(({ id, tier, emoji, label, desc }) => ({ id, tier, emoji, label, desc }));
}

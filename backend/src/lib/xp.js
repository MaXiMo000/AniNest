// Account-level XP and levels. Like badges.js this is a pure function of data
// that already exists - nothing is stored, no unlock events are tracked - so
// it is retroactive (every existing account has a level the moment this
// ships) and can't be farmed by toggling: un-favoriting and re-favoriting
// the same anime never adds XP, because XP is derived from what is in the
// database NOW, not from a ledger of things that happened.
//
// The trade-off, accepted on purpose: deleting a favorite or review lowers
// XP (badges already behave the same way), and game results are reported by
// the client (as streaks already were), so every game-derived source is
// capped and the daily award is at most once per date.
//
// Deliberately absent: "watched an episode" and "read a chapter". Free
// episodes play inside a YouTube iframe (no playback signal) and manga is a
// link-out, so neither can be measured honestly. Marking something
// completed already counts, which is the real signal we do have.
import { computeBadges } from './badges.js';

export const XP_RULES = {
  favorite: 5,            // per anime OR manga favorite
  favoriteCap: 200,
  review: 25,
  completed: 15,          // per anime OR manga marked completed (on top of the favorite XP)
  completedCap: 200,
  streakPoint: 10,        // per point of a game's best streak
  streakCap: 50,          // points counted per game
  dailyPlayed: 10,
  dailyWon: 30,           // replaces dailyPlayed on a win, not added to it
  approvedLink: 50,       // a free-watch link someone submitted and an admin approved
  approvedLinkCap: 100,
  badge: { bronze: 50, silver: 100, gold: 200 },
};

const TITLES = [
  { fromLevel: 18, title: 'Legendary Otaku' },
  { fromLevel: 12, title: 'Anime Sage' },
  { fromLevel: 8, title: 'Nest Regular' },
  { fromLevel: 5, title: 'Seasoned Otaku' },
  { fromLevel: 3, title: 'Rookie Watcher' },
  { fromLevel: 1, title: 'Newbie Nakama' },
];

export function titleFor(level) {
  return TITLES.find((t) => level >= t.fromLevel).title;
}

// level 1 at 0 XP; level n starts at 50 * (n-1)^2  (L2 @ 50, L3 @ 200, L5 @ 800, L10 @ 4050).
export function levelFor(xp) {
  const safe = Math.max(0, Math.floor(xp));
  const level = Math.floor(Math.sqrt(safe / 50)) + 1;
  const levelStart = 50 * (level - 1) ** 2;
  const nextLevelAt = 50 * level ** 2;
  return {
    level,
    levelStart,
    nextLevelAt,
    progress: (safe - levelStart) / (nextLevelAt - levelStart),
    title: titleFor(level),
  };
}

const n = (v) => Math.max(0, Number(v) || 0);
const capped = (v, cap) => Math.min(n(v), cap);

// `i`: { favoritesCount, completedCount, mangaFavoritesCount, mangaCompletedCount,
//        reviewsCount, streaks: number[] (best streak per game),
//        streaksByGame: { slug: best }, dailyPlayed, dailyWon (anime + manga
//        dailies combined), approvedLinks, createdAt }
export function computeXp(i) {
  const streaks = (i.streaks || []).map(n);
  const bestStreak = streaks.length ? Math.max(...streaks) : 0;
  const dailyLosses = Math.max(0, n(i.dailyPlayed) - n(i.dailyWon));

  const badges = computeBadges({
    favoritesCount: n(i.favoritesCount),
    reviewsCount: n(i.reviewsCount),
    completedCount: n(i.completedCount),
    bestStreak,
    createdAt: i.createdAt,
    streaksByGame: i.streaksByGame || {},
    dailyWon: n(i.dailyWon),
  });

  const rows = [
    { id: 'favorites', emoji: '💖', label: 'Anime favorites', count: n(i.favoritesCount), xp: capped(i.favoritesCount, XP_RULES.favoriteCap) * XP_RULES.favorite },
    { id: 'manga-favorites', emoji: '📖', label: 'Manga saved', count: n(i.mangaFavoritesCount), xp: capped(i.mangaFavoritesCount, XP_RULES.favoriteCap) * XP_RULES.favorite },
    { id: 'reviews', emoji: '💬', label: 'Reviews written', count: n(i.reviewsCount), xp: n(i.reviewsCount) * XP_RULES.review },
    {
      id: 'completed', emoji: '✅', label: 'Completed',
      count: n(i.completedCount) + n(i.mangaCompletedCount),
      xp: (capped(i.completedCount, XP_RULES.completedCap) + capped(i.mangaCompletedCount, XP_RULES.completedCap)) * XP_RULES.completed,
    },
    {
      id: 'streaks', emoji: '🎮', label: 'Game streaks', count: bestStreak,
      xp: streaks.reduce((sum, s) => sum + Math.min(s, XP_RULES.streakCap) * XP_RULES.streakPoint, 0),
    },
    {
      id: 'daily', emoji: '📅', label: 'Daily challenges', count: n(i.dailyPlayed),
      xp: n(i.dailyWon) * XP_RULES.dailyWon + dailyLosses * XP_RULES.dailyPlayed,
    },
    { id: 'links', emoji: '🆓', label: 'Free-watch links approved', count: n(i.approvedLinks), xp: capped(i.approvedLinks, XP_RULES.approvedLinkCap) * XP_RULES.approvedLink },
    { id: 'badges', emoji: '🏅', label: 'Badges earned', count: badges.length, xp: badges.reduce((sum, b) => sum + XP_RULES.badge[b.tier], 0) },
  ];

  const total = rows.reduce((sum, r) => sum + r.xp, 0);
  return { total, ...levelFor(total), breakdown: rows.filter((r) => r.xp > 0), badges };
}

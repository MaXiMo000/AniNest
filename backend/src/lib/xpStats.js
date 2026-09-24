import { db } from './db.js';
import { computeXp } from './xp.js';

// The one place XP inputs are read from the database, shared by the public
// profile (one user) and the XP leaderboard (everyone) so the two can never
// disagree about how a total was reached. Each source is a single GROUP BY
// query rather than a query per user.
//
// Free-watch links only count when SOMEONE ELSE approved them
// (submitted_by != reviewed_by): admin bulk imports and direct adds are
// stored as submitted_by = reviewed_by = the admin, and would otherwise hand
// the admin thousands of XP for pressing Import.
export async function loadXpInputs(userId = null) {
  const only = userId == null ? '' : ' WHERE user_id = ?';
  const args = userId == null ? [] : [userId];

  const [users, favorites, manga, reviews, scores, daily, links] = await Promise.all([
    db.execute({
      sql: `SELECT id, username, created_at FROM users${userId == null ? '' : ' WHERE id = ?'}`,
      args,
    }),
    db.execute({
      sql: `SELECT user_id, COUNT(*) AS n, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done FROM favorites${only} GROUP BY user_id`,
      args,
    }),
    db.execute({
      sql: `SELECT user_id, COUNT(*) AS n, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done FROM manga_favorites${only} GROUP BY user_id`,
      args,
    }),
    // Anime and manga reviews both count as "reviews written".
    db.execute({ sql: `SELECT user_id, COUNT(*) AS n FROM (SELECT user_id FROM reviews UNION ALL SELECT user_id FROM manga_reviews)${only} GROUP BY user_id`, args }),
    db.execute({ sql: `SELECT user_id, game, best_streak FROM game_scores${only}`, args }),
    // The anime and manga dailies both count as "daily challenges".
    db.execute({
      sql: `SELECT user_id, COUNT(*) AS played, SUM(won) AS won
            FROM (SELECT user_id, won FROM daily_results UNION ALL SELECT user_id, won FROM manga_daily_results)${only}
            GROUP BY user_id`,
      args,
    }),
    db.execute({
      sql: `SELECT submitted_by AS user_id, COUNT(*) AS n FROM anime_watch_sources
            WHERE status = 'approved' AND submitted_by IS NOT NULL AND submitted_by != COALESCE(reviewed_by, -1)
            ${userId == null ? '' : 'AND submitted_by = ?'}
            GROUP BY submitted_by`,
      args,
    }),
  ]);

  const byUser = new Map();
  for (const u of users.rows) {
    byUser.set(Number(u.id), {
      username: u.username, createdAt: u.created_at,
      favoritesCount: 0, completedCount: 0, mangaFavoritesCount: 0, mangaCompletedCount: 0,
      reviewsCount: 0, streaks: [], streaksByGame: {}, dailyPlayed: 0, dailyWon: 0, approvedLinks: 0,
    });
  }
  const get = (row) => byUser.get(Number(row.user_id));

  for (const r of favorites.rows) { const u = get(r); if (u) { u.favoritesCount = Number(r.n); u.completedCount = Number(r.done) || 0; } }
  for (const r of manga.rows) { const u = get(r); if (u) { u.mangaFavoritesCount = Number(r.n); u.mangaCompletedCount = Number(r.done) || 0; } }
  for (const r of reviews.rows) { const u = get(r); if (u) u.reviewsCount = Number(r.n); }
  for (const r of scores.rows) { const u = get(r); if (u) { u.streaks.push(Number(r.best_streak)); u.streaksByGame[r.game] = Number(r.best_streak); } }
  for (const r of daily.rows) { const u = get(r); if (u) { u.dailyPlayed = Number(r.played); u.dailyWon = Number(r.won) || 0; } }
  for (const r of links.rows) { const u = get(r); if (u) u.approvedLinks = Number(r.n); }
  return byUser;
}

export async function xpForUser(userId) {
  const inputs = (await loadXpInputs(userId)).get(Number(userId));
  return inputs ? computeXp(inputs) : null;
}

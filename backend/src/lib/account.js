import { db } from './db.js';

// Everything a user owns, for "download my data" and "delete my account".
// Deletes are explicit rather than left to ON DELETE CASCADE: SQLite only
// enforces foreign keys on a connection that ran PRAGMA foreign_keys = ON,
// and a remote Turso client doesn't promise every statement shares the
// connection that ran it (see db.js).

// Tables keyed by user_id whose rows go into the export. user_id itself is
// dropped from each row; it means nothing outside this database.
const EXPORT_TABLES = [
  'favorites', 'manga_favorites', 'reviews', 'manga_reviews', 'game_scores',
  'daily_results', 'manga_daily_results', 'episode_log', 'episode_ratings', 'theme_tournament_votes',
  'predictions', 'manga_continuations', 'custom_lists', 'novel_favorites', 'novel_reviews',
];
// Also exported, but deleted separately below.
const EXPORT_ALSO = ['game_score_log', 'it_clicked'];

export async function exportUserData(userId) {
  const user = await db.execute({ sql: 'SELECT username, email, created_at, is_private FROM users WHERE id = ?', args: [userId] });
  const out = { exportedAt: new Date().toISOString(), account: user.rows[0] || null };
  for (const table of [...EXPORT_TABLES, ...EXPORT_ALSO]) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await db.execute({ sql: `SELECT * FROM ${table} WHERE user_id = ?`, args: [userId] });
    out[table] = rows.rows.map(({ user_id: _drop, id: _id, ...row }) => ({ ...row }));
  }
  const following = await db.execute({
    sql: 'SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?',
    args: [userId],
  });
  out.following = following.rows.map((r) => ({ ...r }));
  const listItems = await db.execute({
    sql: 'SELECT i.* FROM custom_list_items i JOIN custom_lists l ON l.id = i.list_id WHERE l.user_id = ? ORDER BY i.list_id, i.position',
    args: [userId],
  });
  out.custom_list_items = listItems.rows.map((r) => ({ ...r }));
  return out;
}

export async function deleteUserData(userId) {
  const byUser = (table) => ({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [userId] });
  const ownRooms = 'SELECT id FROM watch_rooms WHERE created_by = ?';
  const ownSeats = `SELECT id FROM watch_room_members WHERE user_id = ? OR room_id IN (${ownRooms})`;
  await db.batch([
    { sql: `DELETE FROM watch_room_votes WHERE member_id IN (${ownSeats})`, args: [userId, userId] },
    { sql: `DELETE FROM watch_room_members WHERE user_id = ? OR room_id IN (${ownRooms})`, args: [userId, userId] },
    { sql: 'DELETE FROM watch_rooms WHERE created_by = ?', args: [userId] },
    { sql: 'DELETE FROM custom_list_items WHERE list_id IN (SELECT id FROM custom_lists WHERE user_id = ?)', args: [userId] },
    ...EXPORT_TABLES.map(byUser),
    byUser('game_runs'),
    byUser('game_score_log'),
    byUser('notifications'),
    byUser('it_clicked'),
    byUser('password_resets'),
    byUser('email_verifications'),
    byUser('known_devices'),
    byUser('push_subscriptions'),
    { sql: 'DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', args: [userId, userId] },
    { sql: 'DELETE FROM review_reports WHERE reporter_id = ?', args: [userId] },
    byUser('sessions'),
    // Free-watch links they suggested or reviewed stay up; only the credit goes.
    { sql: 'UPDATE anime_watch_sources SET submitted_by = NULL WHERE submitted_by = ?', args: [userId] },
    { sql: 'UPDATE anime_watch_sources SET reviewed_by = NULL WHERE reviewed_by = ?', args: [userId] },
    { sql: 'DELETE FROM users WHERE id = ?', args: [userId] },
  ], 'write');
}

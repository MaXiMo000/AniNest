import { db } from './db.js';

// What the people `me` follows added, finished or reviewed within `window`
// (an SQLite modifier like '-30 days'). Built on read from favorites and
// reviews (no events table), skipping private accounts and hidden reviews.
// One list entry gives one item: its latest change (added, or a status change).
// Used by the activity feed (routes/feed.js) and the weekly digest (lib/digest.js).
export async function friendsActivity(me, window, limit) {
  const followingResult = await db.execute({
    sql: `SELECT u.username, u.is_private FROM follows f JOIN users u ON u.id = f.followee_id
          WHERE f.follower_id = ? ORDER BY u.username COLLATE NOCASE`,
    args: [me],
  });
  const following = followingResult.rows.map((r) => ({ username: r.username, private: Boolean(Number(r.is_private)) }));
  if (!following.length) return { following, items: [] };

  const followed = `SELECT u.id FROM follows f JOIN users u ON u.id = f.followee_id
                    WHERE f.follower_id = ? AND u.is_private = 0`;
  const [lists, reviews] = await Promise.all([
    db.execute({
      sql: `SELECT u.username, fa.mal_id, fa.title, fa.image, fa.status,
                   MAX(fa.added_at, COALESCE(fa.status_at, fa.added_at)) AS at,
                   COALESCE(fa.status_at, '') > fa.added_at AS changed
            FROM favorites fa JOIN users u ON u.id = fa.user_id
            WHERE fa.user_id IN (${followed})
              AND MAX(fa.added_at, COALESCE(fa.status_at, fa.added_at)) >= datetime('now', ?)
            ORDER BY at DESC LIMIT ?`,
      args: [me, window, limit],
    }),
    db.execute({
      sql: `SELECT u.username, r.mal_id, r.rating, r.body, r.updated_at AS at,
                   COALESCE(fa.title, t.title) AS title, COALESCE(fa.image, t.image) AS image
            FROM reviews r JOIN users u ON u.id = r.user_id
            LEFT JOIN favorites fa ON fa.user_id = r.user_id AND fa.mal_id = r.mal_id
            LEFT JOIN anime_titles t ON t.mal_id = r.mal_id
            WHERE r.user_id IN (${followed}) AND r.hidden = 0 AND r.updated_at >= datetime('now', ?)
            ORDER BY r.updated_at DESC LIMIT ?`,
      args: [me, window, limit],
    }),
  ]);

  const items = [
    ...lists.rows.map((r) => ({
      kind: Number(r.changed) ? 'status' : 'added',
      username: r.username, mal_id: Number(r.mal_id), title: r.title, image: r.image || null,
      status: r.status || null, at: r.at,
    })),
    ...reviews.rows.map((r) => ({
      kind: 'review',
      username: r.username, mal_id: Number(r.mal_id), title: r.title || null, image: r.image || null,
      rating: Number(r.rating), body: r.body ? String(r.body).slice(0, 280) : null, at: r.at,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);

  return { following, items };
}

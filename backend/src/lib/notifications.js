import { db } from './db.js';
import { logger } from './logger.js';

// In-app notifications for titles a user is following. Two kinds:
//   'anime-episodes' - free episodes were added for an anime (by an import, an
//                      approval or an admin add)
//   'manga-chapter'  - a manga in the user's reading list has a new chapter
//                      (detected by lib/mangaUpdates.js)
//
// A user is "following" a title if it's in their favorites and they haven't
// finished with it: no status yet, or watching/plan-to-watch (anime) or
// reading/plan-to-read (manga). Completed and dropped titles stay quiet.
//
// Everything here is best-effort: a notification failing must never break
// the admin action or background job that triggered it, so errors are logged
// and swallowed.

async function bump(userId, kind, ref, title, addCount) {
  const existing = await db.execute({
    sql: 'SELECT id FROM notifications WHERE user_id = ? AND kind = ? AND ref = ? AND read_at IS NULL',
    args: [userId, kind, ref],
  });
  if (existing.rows.length) {
    await db.execute({
      sql: "UPDATE notifications SET count = count + ?, title = ?, updated_at = datetime('now') WHERE id = ?",
      args: [addCount, title, existing.rows[0].id],
    });
  } else {
    await db.execute({
      sql: 'INSERT INTO notifications (user_id, kind, ref, title, count) VALUES (?, ?, ?, ?, ?)',
      args: [userId, kind, ref, title, addCount],
    });
  }
}

// Returns how many users were notified.
export async function notifyNewEpisodes(malId, count) {
  if (!count || count < 1) return 0;
  try {
    const followers = await db.execute({
      sql: "SELECT user_id, title FROM favorites WHERE mal_id = ? AND (status IS NULL OR status IN ('watching', 'plan_to_watch'))",
      args: [malId],
    });
    for (const f of followers.rows) {
      // eslint-disable-next-line no-await-in-loop
      await bump(Number(f.user_id), 'anime-episodes', String(malId), f.title, count);
    }
    return followers.rows.length;
  } catch (err) {
    logger.error({ err, malId }, 'notifyNewEpisodes failed');
    return 0;
  }
}

export async function notifyNewChapter(mangaId) {
  try {
    const followers = await db.execute({
      sql: "SELECT user_id, title FROM manga_favorites WHERE manga_id = ? AND (status IS NULL OR status IN ('reading', 'plan_to_read'))",
      args: [mangaId],
    });
    for (const f of followers.rows) {
      // eslint-disable-next-line no-await-in-loop
      await bump(Number(f.user_id), 'manga-chapter', mangaId, f.title, 1);
    }
    return followers.rows.length;
  } catch (err) {
    logger.error({ err, mangaId }, 'notifyNewChapter failed');
    return 0;
  }
}

export function describe(n) {
  const count = Number(n.count);
  if (n.kind === 'anime-episodes') {
    return { message: `${count} new free episode${count === 1 ? '' : 's'} available`, link: `#/anime/${n.ref}` };
  }
  return { message: count > 1 ? `${count} new chapters available` : 'New chapter available', link: `#/manga/${n.ref}` };
}

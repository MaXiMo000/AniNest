import { db } from './db.js';
import { logger } from './logger.js';
import { sendPush } from './push.js';

// In-app notifications for titles a user is following. Two kinds:
//   'anime-episodes' - free episodes were added for an anime (by an import, an
//                      approval or an admin add)
//   'manga-chapter'  - a manga in the user's reading list has a new chapter
//                      (detected by lib/mangaUpdates.js)
//
// A user is "following" a title if it's in their favorites and they haven't
// finished with it: no status yet, or watching/plan-to-watch (anime) or
// reading/plan-to-read (manga). Completed and dropped titles stay quiet, and
// so does a kind the user turned off (users.notify_episodes / notify_chapters).
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
  // Also to their devices, if they turned push on. Not awaited: a slow push
  // service must not hold up the import or poll that found the news.
  const { message, link } = describe({ kind, ref, count: addCount });
  sendPush(userId, { title, body: message, url: link }).catch(() => {});
}

// Returns how many users were notified.
export async function notifyNewEpisodes(malId, count) {
  if (!count || count < 1) return 0;
  try {
    const followers = await db.execute({
      sql: `SELECT f.user_id, f.title FROM favorites f JOIN users u ON u.id = f.user_id
            WHERE f.mal_id = ? AND (f.status IS NULL OR f.status IN ('watching', 'plan_to_watch')) AND u.notify_episodes = 1`,
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
      sql: `SELECT f.user_id, f.title FROM manga_favorites f JOIN users u ON u.id = f.user_id
            WHERE f.manga_id = ? AND (f.status IS NULL OR f.status IN ('reading', 'plan_to_read')) AND u.notify_chapters = 1`,
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

// One notification to each of `userIds` (bell, and push where turned on).
export async function notifyUsers(userIds, { kind, ref, title }) {
  for (const id of userIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await bump(Number(id), kind, ref, title, 1);
    } catch (err) {
      logger.error({ err, kind, ref }, 'notifyUsers failed for one user');
    }
  }
}

export function describe(n) {
  const count = Number(n.count);
  if (n.kind === 'predictions') {
    // ref is "lock:SEASON:YEAR" or "final:SEASON:YEAR"
    const [what, season, year] = String(n.ref).split(':');
    const link = `#/predictions?season=${season}&year=${year}`;
    return what === 'lock'
      ? { message: 'Picks lock in less than a day. Finish your guesses!', link }
      : { message: 'Final results are in. See where you placed!', link };
  }
  if (n.kind === 'anime-episodes') {
    return { message: `${count} new free episode${count === 1 ? '' : 's'} available`, link: `#/anime/${n.ref}` };
  }
  return { message: count > 1 ? `${count} new chapters available` : 'New chapter available', link: `#/manga/${n.ref}` };
}

import { db } from './db.js';
import { logger } from './logger.js';
import { mangaLatestChapters } from './mangadex.js';
import { notifyNewChapter } from './notifications.js';

// Background check for new chapters of manga people are reading. It compares
// MangaDex's own `latestUploadedChapter` metadata id (from the MANGA endpoint,
// batched 100 ids per request) against the id we saw last time - if it
// changed, there's a new chapter. Chapter content is never requested.
//
// The first time a manga is seen it only records a baseline (otherwise
// everyone would be told about a "new" chapter that's been out for years).
const CHUNK = 100;

export async function pollMangaUpdates({ fetchLatest = mangaLatestChapters } = {}) {
  const tracked = await db.execute(`
    SELECT DISTINCT manga_id FROM manga_favorites
    WHERE status IS NULL OR status IN ('reading', 'plan_to_read')
  `);
  const ids = tracked.rows.map((r) => r.manga_id);
  let checked = 0;
  let notified = 0;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const latest = await fetchLatest(chunk); // Map<mangaId, chapterId|null>
    for (const [mangaId, chapterId] of latest) {
      if (!chapterId) continue;
      checked += 1;
      // eslint-disable-next-line no-await-in-loop
      const prev = await db.execute({ sql: 'SELECT latest_chapter FROM manga_chapter_state WHERE manga_id = ?', args: [mangaId] });
      if (!prev.rows.length) {
        // eslint-disable-next-line no-await-in-loop
        await db.execute({ sql: 'INSERT INTO manga_chapter_state (manga_id, latest_chapter) VALUES (?, ?)', args: [mangaId, chapterId] });
      } else if (prev.rows[0].latest_chapter !== chapterId) {
        // eslint-disable-next-line no-await-in-loop
        await db.execute({
          sql: "UPDATE manga_chapter_state SET latest_chapter = ?, checked_at = datetime('now') WHERE manga_id = ?",
          args: [chapterId, mangaId],
        });
        // eslint-disable-next-line no-await-in-loop
        notified += await notifyNewChapter(mangaId);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await db.execute({ sql: "UPDATE manga_chapter_state SET checked_at = datetime('now') WHERE manga_id = ?", args: [mangaId] });
      }
    }
  }
  return { tracked: ids.length, checked, notified };
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// Started from server.js only (never by the test suite, which builds the app
// via createApp). The first pass waits a couple of minutes so a fresh deploy
// isn't doing upstream work while it warms up.
export function startMangaUpdatePolling() {
  if (process.env.NODE_ENV === 'test' || process.env.MANGA_POLL === 'off') return;
  const run = () => pollMangaUpdates()
    .then((r) => logger.info(r, 'manga update poll finished'))
    .catch((err) => logger.error({ err }, 'manga update poll failed'));
  setTimeout(run, 2 * 60 * 1000).unref();
  setInterval(run, SIX_HOURS_MS).unref();
}

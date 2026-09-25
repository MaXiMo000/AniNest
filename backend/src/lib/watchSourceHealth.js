import { db } from './db.js';
import { logger } from './logger.js';
import { isConfigured, videoAvailability } from './youtube.js';

// Daily check of the free-watch links against YouTube: stores each video's
// region lists (the detail page filters by the viewer's country) and marks
// links that no longer play 'expired' so they vanish from the page. Expired
// links are re-checked too, so a video that comes back is restored.
// Oldest-checked first, capped per run: 2000 links = 40 quota units.
const MAX_PER_RUN = 2000;

let check = videoAvailability;
// Test hook: the suite never calls YouTube.
export function setAvailabilityChecker(fn) {
  check = fn || videoAvailability;
}

export async function checkWatchSources({ limit = MAX_PER_RUN } = {}) {
  const rows = await db.execute({
    sql: `SELECT id, youtube_video_id, status FROM anime_watch_sources WHERE status IN ('approved', 'expired')
          ORDER BY checked_at IS NOT NULL, checked_at LIMIT ?`,
    args: [limit],
  });
  if (!rows.rows.length) return { checked: 0, expired: 0, restored: 0 };

  const availability = await check([...new Set(rows.rows.map((r) => r.youtube_video_id))]);
  // Every link dead at once is far likelier an API glitch than reality, and
  // acting on it would empty every free-watch section until the next run.
  if (rows.rows.length >= 20 && ![...availability.values()].some((a) => a.playable)) {
    throw new Error('YouTube reported every checked video as unplayable - not applying this run');
  }
  let expired = 0;
  let restored = 0;
  const statements = rows.rows.map((r) => {
    const a = availability.get(r.youtube_video_id);
    const status = a?.playable ? 'approved' : 'expired';
    if (status !== r.status) (status === 'expired' ? expired += 1 : restored += 1);
    return {
      sql: "UPDATE anime_watch_sources SET status = ?, allowed_regions = ?, blocked_regions = ?, checked_at = datetime('now') WHERE id = ?",
      args: [status, a?.allowed ? JSON.stringify(a.allowed) : null, a?.blocked ? JSON.stringify(a.blocked) : null, r.id],
    };
  });
  await db.batch(statements, 'write');
  return { checked: rows.rows.length, expired, restored };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Started from server.js only, and only with a YouTube key.
export function startWatchSourceChecks() {
  if (process.env.NODE_ENV === 'test' || !isConfigured()) return;
  const run = () => checkWatchSources()
    .then((r) => logger.info(r, 'watch source check finished'))
    .catch((err) => logger.error({ err }, 'watch source check failed'));
  setTimeout(run, 5 * 60 * 1000).unref();
  setInterval(run, DAY_MS).unref();
}

import { createApp } from './app.js';
import { pruneExpiredSessions } from './lib/auth.js';
import { db } from './lib/db.js';
import { logger } from './lib/logger.js';
import { startMangaUpdatePolling } from './lib/mangaUpdates.js';
import { startWatchSourceChecks } from './lib/watchSourceHealth.js';

const PORT = process.env.PORT || 8787;
const app = createApp();

const runPruneExpiredSessions = () => pruneExpiredSessions().catch((err) => logger.error({ err }, 'pruneExpiredSessions failed'));
setInterval(runPruneExpiredSessions, 60 * 60 * 1000).unref();
runPruneExpiredSessions();

startMangaUpdatePolling();
startWatchSourceChecks();

const server = app.listen(PORT, () => {
  logger.info(`AniNest backend listening on http://localhost:${PORT}`);
});

// Render (and most PaaS hosts) send SIGTERM before killing a container on
// redeploy/scale-down. Without this, in-flight requests get dropped instead
// of finishing, and the SQLite file handle isn't closed cleanly.
function shutdown(signal) {
  logger.info(`${signal} received, shutting down...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Last-resort safety nets: without these, an unexpected error in a spot that
// isn't wrapped in Express's own error handling (a stray promise rejection,
// a bug in a timer callback) crashes the process with no trace of why. Log
// loudly and exit so the platform's process manager restarts us cleanly,
// rather than limping on in a possibly-corrupted state.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});

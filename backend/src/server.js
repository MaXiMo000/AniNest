import { createApp } from './app.js';
import { pruneExpiredSessions } from './lib/auth.js';
import { db } from './lib/db.js';

const PORT = process.env.PORT || 8787;
const app = createApp();

setInterval(pruneExpiredSessions, 60 * 60 * 1000).unref();
pruneExpiredSessions();

const server = app.listen(PORT, () => {
  console.log(`AniNest backend listening on http://localhost:${PORT}`);
});

// Render (and most PaaS hosts) send SIGTERM before killing a container on
// redeploy/scale-down. Without this, in-flight requests get dropped instead
// of finishing, and the SQLite file handle isn't closed cleanly.
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
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
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});

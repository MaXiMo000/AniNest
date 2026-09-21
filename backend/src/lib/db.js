import { createClient } from '@libsql/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Two modes, same client library and same SQL everywhere else in the app:
//  - Local file (dev, tests, or any host with real persistent disk): set
//    DB_PATH, or let it default to backend/data/aninest.db.
//  - Remote Turso (recommended for hosts with no persistent disk, e.g. a
//    free-tier Render web service, which can't attach one at all): set
//    TURSO_DATABASE_URL + TURSO_AUTH_TOKEN and this ignores DB_PATH entirely.
const isRemote = Boolean(process.env.TURSO_DATABASE_URL);
const localPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'aninest.db');
// Windows paths (C:\...) need forward slashes in a file: URL — backslashes
// and the drive-letter colon otherwise confuse the URL parser.
const localFileUrl = `file:${localPath.replace(/\\/g, '/')}`;

export const db = createClient(
  isRemote
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: localFileUrl },
);

await db.execute('PRAGMA foreign_keys = ON');

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mal_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    image TEXT,
    score REAL,
    type TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, mal_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mal_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    body TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, mal_id)
  );

  -- One row per calendar date (UTC): the single mystery anime every visitor
  -- gets that day. Written once, lazily, by whichever request is first to
  -- ask for a date with no row yet (see lib/dailyChallenge.js) - persisted
  -- here rather than in the in-memory cache specifically so it survives a
  -- Render free-tier cold start/redeploy without visitors getting a
  -- different puzzle mid-day.
  CREATE TABLE IF NOT EXISTS daily_challenges (
    date TEXT PRIMARY KEY,
    mal_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    image TEXT,
    synopsis TEXT,
    score REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Server-side best streak per user per game, so Higher/Lower and Guess the
  -- Anime streaks (previously only in localStorage) are visible on a shared
  -- leaderboard. The game column is a short slug ('higher-lower',
  -- 'guess-the-anime'), validated against lib/games.js's GAMES list at the
  -- route layer, not a DB CHECK constraint - keeps adding a future game a
  -- code-only change.
  CREATE TABLE IF NOT EXISTS game_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    best_streak INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, game)
  );

  -- Manga reading-list, parallel to favorites but keyed by a MangaDex
  -- UUID (manga_id TEXT) instead of a numeric MAL id - MangaDex ids don't
  -- fit favorites.mal_id's INTEGER column, so this is a new table rather
  -- than a widened one, keeping the existing anime favorites/reviews
  -- tables and data completely untouched. status mirrors favorites'
  -- watch-status idea, adapted to reading (reading/plan_to_read/completed/
  -- dropped). manga_reviews (mirroring reviews) is intentionally not
  -- created yet - out of scope for this slice, a near-identical fast-follow.
  CREATE TABLE IF NOT EXISTS manga_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    manga_id TEXT NOT NULL,
    title TEXT NOT NULL,
    image TEXT,
    format TEXT,
    status TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, manga_id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_mal_id ON reviews(mal_id);
  CREATE INDEX IF NOT EXISTS idx_game_scores_leaderboard ON game_scores(game, best_streak DESC);
  CREATE INDEX IF NOT EXISTS idx_manga_favorites_user ON manga_favorites(user_id);
`);

// SQLite has no "ADD COLUMN IF NOT EXISTS" — this is the idempotent
// equivalent, safe to run on every boot against both a fresh DB and one
// that already has the column. `favorites` predates the watch-status
// feature, so this is a real migration, not part of the CREATE TABLE above.
async function ensureColumn(table, column, ddl) {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
}
await ensureColumn('favorites', 'status', 'TEXT');

export default db;

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

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_mal_id ON reviews(mal_id);
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

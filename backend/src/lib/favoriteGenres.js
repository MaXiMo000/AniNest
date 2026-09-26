import { db } from './db.js';
import { anilistGenresForMalIds } from './anilist.js';

// Favorites saved before genres were stored (see db.js) have genres = NULL.
// Taste match needs them, so they're filled in from AniList the first time
// they're needed, up to MAX per call (2 AniList requests), and saved. A title
// AniList doesn't know gets '[]' so it isn't asked about again.
const MAX = 100;

let lookup = anilistGenresForMalIds;
// Test hook: the suite never calls AniList.
export function setGenreLookup(fn) {
  lookup = fn || anilistGenresForMalIds;
}

export async function fillMissingGenres(userId) {
  const missing = await db.execute({ sql: `SELECT mal_id FROM favorites WHERE user_id = ? AND genres IS NULL LIMIT ${MAX}`, args: [userId] });
  if (!missing.rows.length) return 0;
  const ids = missing.rows.map((r) => Number(r.mal_id));
  const genres = await lookup(ids);
  await db.batch(ids.map((id) => ({
    sql: 'UPDATE favorites SET genres = ? WHERE user_id = ? AND mal_id = ? AND genres IS NULL',
    args: [JSON.stringify(genres.get(id) || []), userId, id],
  })), 'write');
  return ids.length;
}

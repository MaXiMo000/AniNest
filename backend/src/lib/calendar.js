import crypto from 'node:crypto';
import { db } from './db.js';
import { cached } from './cache.js';
import { anilistAiringForMalIds } from './anilist.js';
import { buildCalendar } from './ics.js';

// Private airing-calendar feed: GET /api/calendar/<token>.ics lists the next
// episodes of everything the user is Watching, for Google/Apple/Outlook
// calendar subscriptions. Calendar apps can't send our session cookie, so a
// random token in the URL is the credential. It is stored as-is (not hashed
// like sessions) so the account page can show the link again. That's
// acceptable because the feed only reveals a Watching list, which the public
// profile shows anyway. Rotating the token kills the old link.

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const PAST_DAYS = 7; // keep last week's episodes, so the calendar doesn't look empty right after one airs
const AHEAD_DAYS = 14;
const MAX_SHOWS = 150;
const FEED_TTL_MS = 60 * 60 * 1000;

let fetchAiring = anilistAiringForMalIds;
// Test hook: the suite never calls AniList.
export function setAiringFetcher(fn) {
  fetchAiring = fn || anilistAiringForMalIds;
}

const newToken = () => crypto.randomBytes(24).toString('base64url');

export async function calendarToken(userId) {
  const res = await db.execute({ sql: 'SELECT calendar_token FROM users WHERE id = ?', args: [userId] });
  if (res.rows[0]?.calendar_token) return res.rows[0].calendar_token;
  return rotateCalendarToken(userId);
}

export async function rotateCalendarToken(userId) {
  const token = newToken();
  await db.execute({ sql: 'UPDATE users SET calendar_token = ? WHERE id = ?', args: [token, userId] });
  return token;
}

// The .ics text for a token, or null when no user has it.
export async function calendarFeed(token, { frontendOrigin }) {
  if (!TOKEN_PATTERN.test(token)) return null;
  const userRes = await db.execute({ sql: 'SELECT id, username FROM users WHERE calendar_token = ?', args: [token] });
  const user = userRes.rows[0];
  if (!user) return null;

  // Keyed by token, so a rotated link never serves a cached copy.
  return cached(`calendar:${token}`, FEED_TTL_MS, async () => {
    const favs = await db.execute({
      sql: `SELECT mal_id FROM favorites WHERE user_id = ? AND status = 'watching' ORDER BY added_at DESC LIMIT ${MAX_SHOWS}`,
      args: [user.id],
    });
    const malIds = favs.rows.map((r) => Number(r.mal_id));
    const now = Math.floor(Date.now() / 1000);
    const airing = malIds.length ? await fetchAiring(malIds, now - PAST_DAYS * 86400, now + AHEAD_DAYS * 86400) : [];
    return buildCalendar({
      name: `AniNest: ${user.username}'s airing schedule`,
      events: airing.map((a) => ({
        uid: `${a.mal_id}-${a.episode}@aninest`,
        start: a.airingAt,
        minutes: a.duration,
        summary: `${a.title} · Episode ${a.episode}`,
        description: `Episode ${a.episode} of ${a.title} airs now (Japanese broadcast; streaming sites may be later).`,
        url: `${frontendOrigin}/#/anime/${a.mal_id}`,
      })),
    });
  });
}

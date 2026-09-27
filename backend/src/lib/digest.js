import { db } from './db.js';
import { logger } from './logger.js';
import { isMailEnabled, sendMail } from './mailer.js';
import { anilistAiringForMalIds } from './anilist.js';
import { friendsActivity } from './feed.js';
import { describe } from './notifications.js';

// Weekly email digest, opt-in (users.email_digest, set on the account page).
// An hourly check mails everyone whose last digest is a week old: episodes
// that aired for shows on their Watching list, unread free-episode and
// chapter alerts, and what the people they follow did. A week with nothing
// to say sends nothing. Each mail carries a one-click unsubscribe link.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const CHECK_MS = 60 * 60 * 1000;
// ponytail: Gmail SMTP allows ~500 mails a day; move to Resend (or batch sends) past that.
const PER_RUN = 100;

let airing = anilistAiringForMalIds;
// Test hook: the suite never calls AniList.
export function setDigestAiring(fn) { airing = fn || anilistAiringForMalIds; }

const origin = () => (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',')[0].trim();

const STATUS_VERB = { watching: 'started watching', completed: 'completed', dropped: 'dropped', plan_to_watch: 'plans to watch' };
function friendLine(i) {
  if (i.kind === 'review') return `${i.username} rated ${i.title || 'a show'} ${i.rating}/10`;
  if (i.kind === 'status') return `${i.username} ${STATUS_VERB[i.status] || 'updated'} ${i.title}`;
  return `${i.username} added ${i.title}`;
}

// { subject, text }, or null when there's nothing worth a mail.
export function digestText({ username, token, aired, news, friends }) {
  if (!aired.length && !news.length && !friends.length) return null;
  const site = origin();
  const parts = [`Hi ${username}, here's your week on AniNest.`];
  if (aired.length) {
    parts.push(['NEW EPISODES OF SHOWS YOU\'RE WATCHING', ...aired.map((a) => (
      `- ${a.title}: episode${a.episodes.length === 1 ? '' : 's'} ${a.episodes.join(', ')}\n  ${site}/#/anime/${a.mal_id}`
    ))].join('\n'));
  }
  if (news.length) {
    parts.push(['FREE EPISODES AND NEW CHAPTERS', ...news.map((n) => {
      const { message, link } = describe(n);
      return `- ${n.title}: ${message}\n  ${site}/${link}`;
    })].join('\n'));
  }
  if (friends.length) {
    parts.push(['FROM PEOPLE YOU FOLLOW', ...friends.map((i) => `- ${friendLine(i)}`), `More: ${site}/#/feed`].join('\n'));
  }
  parts.push(`Change what you get: ${site}/#/account\nUnsubscribe from this email: ${site}/#/unsubscribe?token=${token}`);
  const count = aired.length + news.length;
  return {
    subject: count ? `Your AniNest week: ${count} update${count === 1 ? '' : 's'}` : 'Your AniNest week',
    text: parts.join('\n\n'),
  };
}

// Returns how many digests were sent.
export async function runDigests(nowMs = Date.now()) {
  const due = await db.execute({
    sql: `SELECT id, username, email, digest_token FROM users
          WHERE email_digest = 1 AND email_verified = 1 AND digest_token IS NOT NULL AND (digest_sent_at IS NULL OR digest_sent_at <= ?)
          ORDER BY digest_sent_at LIMIT ?`,
    args: [new Date(nowMs - WEEK_MS).toISOString(), PER_RUN],
  });
  if (!due.rows.length) return 0;

  const ids = due.rows.map((u) => Number(u.id));
  const watching = await db.execute({
    sql: `SELECT user_id, mal_id FROM favorites WHERE status = 'watching' AND user_id IN (${ids.map(() => '?').join(',')})`,
    args: ids,
  });
  const allShows = [...new Set(watching.rows.map((r) => Number(r.mal_id)))];
  let aired = [];
  if (allShows.length) {
    try {
      aired = await airing(allShows, Math.floor((nowMs - WEEK_MS) / 1000), Math.floor(nowMs / 1000));
    } catch (err) {
      logger.warn({ err }, 'digest: airing lookup failed, sending without new episodes');
    }
  }

  let sent = 0;
  for (const u of due.rows) {
    const userId = Number(u.id);
    const mine = new Set(watching.rows.filter((r) => Number(r.user_id) === userId).map((r) => Number(r.mal_id)));
    const byShow = new Map();
    for (const a of aired.filter((x) => mine.has(x.mal_id))) {
      const show = byShow.get(a.mal_id) || { mal_id: a.mal_id, title: a.title, episodes: [] };
      show.episodes.push(a.episode);
      byShow.set(a.mal_id, show);
    }
    // eslint-disable-next-line no-await-in-loop
    const [news, activity] = await Promise.all([
      db.execute({
        sql: `SELECT kind, ref, title, count FROM notifications
              WHERE user_id = ? AND read_at IS NULL AND updated_at >= datetime('now', '-7 days') ORDER BY updated_at DESC LIMIT 10`,
        args: [userId],
      }),
      friendsActivity(userId, '-7 days', 10),
    ]);
    const mail = digestText({
      username: u.username, token: u.digest_token, aired: [...byShow.values()], news: news.rows, friends: activity.items,
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      if (mail) { await sendMail({ to: u.email, ...mail }); sent += 1; }
    } catch (err) {
      logger.warn({ err: err?.message, userId }, 'digest: send failed, skipping this week');
    }
    // Marked either way, so one bad address can't be retried every hour.
    // eslint-disable-next-line no-await-in-loop
    await db.execute({ sql: 'UPDATE users SET digest_sent_at = ? WHERE id = ?', args: [new Date(nowMs).toISOString(), userId] });
  }
  return sent;
}

export function startDigests() {
  if (!isMailEnabled()) return;
  const run = () => runDigests().catch((err) => logger.error({ err }, 'weekly digest run failed'));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, CHECK_MS).unref();
}

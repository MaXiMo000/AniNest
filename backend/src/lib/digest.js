import { db } from './db.js';
import { logger } from './logger.js';
import { isMailEnabled, sendMail } from './mailer.js';
import { anilistAiringForMalIds } from './anilist.js';
import { friendsActivity } from './feed.js';
import { describe } from './notifications.js';
import { renderEmail } from './emailTemplate.js';

// Weekly email digest, opt-in (users.email_digest, set on the account page).
// It goes out on Sundays from SEND_HOUR_UTC (an hourly check; if more are due
// than one run sends, the next runs carry on that day): episodes
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

const STATUS_VERB = { watching: 'started watching it', completed: 'completed it', dropped: 'dropped it', plan_to_watch: 'plans to watch it' };
// What a friend did, said under the show's title.
function friendLine(i) {
  if (i.kind === 'review') return `${i.username} rated it ${i.rating}/10`;
  if (i.kind === 'status') return `${i.username} ${STATUS_VERB[i.status] || 'updated it'}`;
  return `${i.username} added it to their list`;
}
const episodesLine = (eps) => (eps.length === 1 ? `Episode ${eps[0]}` : `Episodes ${eps.slice(0, -1).join(', ')} and ${eps[eps.length - 1]}`);

// { subject, text, html }, or null when there's nothing worth a mail.
export function digestText({ username, token, aired, news, friends }) {
  if (!aired.length && !news.length && !friends.length) return null;
  const site = origin();
  const sections = [];
  if (aired.length) {
    sections.push({
      title: 'New episodes of shows you’re watching',
      emoji: '📺',
      items: aired.map((a) => ({ text: a.title, sub: episodesLine(a.episodes), url: `${site}/#/anime/${a.mal_id}` })),
    });
  }
  if (news.length) {
    sections.push({
      title: 'Your alerts',
      emoji: '🔔',
      items: news.map((n) => {
        const { message, link } = describe(n);
        return { text: n.title, sub: message, url: `${site}/${link}` };
      }),
    });
  }
  if (friends.length) {
    sections.push({
      title: 'From people you follow',
      emoji: '👥',
      items: friends.map((i) => ({ text: i.title || 'A show', sub: friendLine(i), url: i.mal_id ? `${site}/#/anime/${i.mal_id}` : undefined })),
      more: { label: 'See all their activity', url: `${site}/#/feed` },
    });
  }
  const count = aired.length + news.length;
  const summary = [
    aired.length && `${aired.length} show${aired.length === 1 ? '' : 's'} with new episodes`,
    news.length && `${news.length} alert${news.length === 1 ? '' : 's'}`,
    friends.length && `${friends.length} update${friends.length === 1 ? '' : 's'} from friends`,
  ].filter(Boolean).join(', ');
  return {
    subject: count ? `Your AniNest week: ${count} update${count === 1 ? '' : 's'}` : 'Your AniNest week',
    ...renderEmail({
      preheader: `This week: ${summary}.`,
      heading: 'Your week on AniNest',
      greeting: `Hi ${username}, here’s what happened this week.`,
      sections,
      footer: ['You got this because you turned on the weekly email. It comes on Sundays.', 'AniNest, your anime and manga home base.'],
      footerLinks: [
        { label: 'Open AniNest', url: `${site}/#/` },
        { label: 'Change what you get', url: `${site}/#/account` },
        { label: 'Unsubscribe', url: `${site}/#/unsubscribe?token=${token}` },
      ],
    }),
  };
}

const SEND_DAY_UTC = 0; // Sunday
const SEND_HOUR_UTC = 9;

// Midnight UTC at the start of this week's send day, or null outside the
// send window (another day, or before SEND_HOUR_UTC on the day).
export function sendWindowStart(nowMs) {
  const d = new Date(nowMs);
  if (d.getUTCDay() !== SEND_DAY_UTC || d.getUTCHours() < SEND_HOUR_UTC) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Returns how many digests were sent.
export async function runDigests(nowMs = Date.now()) {
  const windowStart = sendWindowStart(nowMs);
  if (windowStart == null) return 0;
  const due = await db.execute({
    sql: `SELECT id, username, email, digest_token FROM users
          WHERE email_digest = 1 AND email_verified = 1 AND digest_token IS NOT NULL AND (digest_sent_at IS NULL OR digest_sent_at < ?)
          ORDER BY digest_sent_at LIMIT ?`,
    args: [new Date(windowStart).toISOString(), PER_RUN],
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

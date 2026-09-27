import webpush from 'web-push';
import { db } from './db.js';
import { logger } from './logger.js';

// Optional browser push for the in-app notifications (lib/notifications.js).
// Off unless VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set; generate a pair
// once with `npx web-push generate-vapid-keys`. Best-effort like the bell:
// a failed push is logged, never thrown.

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@aninest.app';

let sender = null;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    sender = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 24 * 3600 });
  } catch (err) {
    logger.error({ err }, 'VAPID keys rejected - web push stays off');
  }
}

export const pushEnabled = () => Boolean(sender);
export const pushPublicKey = () => (sender ? PUBLIC_KEY : null);

// Tests swap in a fake sender (and turn push on without real keys).
export function setPushSender(fn) {
  sender = fn;
}

// Subscriptions go only to the browsers' own push services: the endpoint is
// a URL the client hands us and this server POSTs to it, so anything else
// would let a user point our server at arbitrary hosts.
const PUSH_HOSTS = [
  'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com',
  'web.push.apple.com', 'push.apple.com', 'notify.windows.com',
];
export function isPushEndpoint(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.port) return false;
  return PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

export async function sendPush(userId, { title, body, url }) {
  if (!sender) return 0;
  let subs;
  try {
    subs = await db.execute({ sql: 'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', args: [userId] });
  } catch (err) {
    logger.error({ err, userId }, 'push subscriptions lookup failed');
    return 0;
  }
  const payload = JSON.stringify({ title, body, url });
  let sent = 0;
  await Promise.all(subs.rows.map(async (s) => {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent += 1;
    } catch (err) {
      // 404/410: the browser dropped this subscription, so forget it.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE id = ?', args: [s.id] }).catch(() => {});
      } else {
        logger.warn({ err: err?.message, userId }, 'push send failed');
      }
    }
  }));
  return sent;
}

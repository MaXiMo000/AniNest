import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { describe } from '../lib/notifications.js';
import { pushEnabled, pushPublicKey, isPushEndpoint } from '../lib/push.js';
import { isMailEnabled } from '../lib/mailer.js';

// A user's own notifications only - one file, one auth boundary.
export const notificationsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// The weekly digest's unsubscribe link (#/unsubscribe?token=) works signed
// out, so it sits before the auth check. The token is the only credential,
// and all it can do is turn that one email off.
notificationsRouter.post('/unsubscribe', asyncRoute(async (req, res) => {
  const token = typeof req.body?.token === 'string' && /^[0-9a-f]{64}$/.test(req.body.token) ? req.body.token : null;
  const result = token
    ? await db.execute({ sql: 'UPDATE users SET email_digest = 0 WHERE digest_token = ?', args: [token] })
    : { rowsAffected: 0 };
  if (!result.rowsAffected) return res.status(404).json({ error: 'That unsubscribe link isn’t valid.' });
  res.json({ ok: true });
}));

notificationsRouter.use(requireAuth);

async function settingsOf(userId) {
  const row = (await db.execute({
    sql: 'SELECT notify_episodes, notify_chapters, email_digest FROM users WHERE id = ?', args: [userId],
  })).rows[0];
  return {
    notifyEpisodes: Boolean(Number(row.notify_episodes)),
    notifyChapters: Boolean(Number(row.notify_chapters)),
    emailDigest: Boolean(Number(row.email_digest)),
    mailEnabled: isMailEnabled(),
  };
}

notificationsRouter.get('/settings', asyncRoute(async (req, res) => {
  res.json(await settingsOf(req.user.id));
}));

const settingsSchema = z.object({
  notifyEpisodes: z.boolean().optional(),
  notifyChapters: z.boolean().optional(),
  emailDigest: z.boolean().optional(),
});
const SETTING_COLUMNS = { notifyEpisodes: 'notify_episodes', notifyChapters: 'notify_chapters', emailDigest: 'email_digest' };

notificationsRouter.post('/settings', asyncRoute(async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input.' });
  if (parsed.data.emailDigest && !isMailEnabled()) return res.status(409).json({ error: 'Email isn’t set up on this site yet.' });
  const changes = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (changes.length) {
    await db.execute({
      sql: `UPDATE users SET ${changes.map(([k]) => `${SETTING_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
      args: [...changes.map(([, v]) => (v ? 1 : 0)), req.user.id],
    });
  }
  if (parsed.data.emailDigest) {
    await db.execute({
      sql: 'UPDATE users SET digest_token = ? WHERE id = ? AND digest_token IS NULL',
      args: [crypto.randomBytes(32).toString('hex'), req.user.id],
    });
  }
  res.json(await settingsOf(req.user.id));
}));

const LIST_LIMIT = 50;

notificationsRouter.get('/', asyncRoute(async (req, res) => {
  const [rows, unread] = await Promise.all([
    db.execute({
      sql: 'SELECT id, kind, ref, title, count, updated_at, read_at FROM notifications WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?',
      args: [req.user.id, LIST_LIMIT],
    }),
    db.execute({ sql: 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', args: [req.user.id] }),
  ]);
  res.json({
    unread: Number(unread.rows[0].n),
    notifications: rows.rows.map((n) => ({
      id: Number(n.id),
      kind: n.kind,
      title: n.title,
      ...describe(n),
      unread: n.read_at == null,
      updatedAt: n.updated_at,
    })),
  });
}));

// Lightweight, for the header bell's polling.
notificationsRouter.get('/unread-count', asyncRoute(async (req, res) => {
  const result = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', args: [req.user.id] });
  res.json({ unread: Number(result.rows[0].n) });
}));

const readSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ id: z.number().int().positive() }),
]);

// Only ever touches the caller's own rows (user_id is in every WHERE).
notificationsRouter.post('/read', asyncRoute(async (req, res) => {
  const parsed = readSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input.' });
  if ('all' in parsed.data) {
    await db.execute({ sql: "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", args: [req.user.id] });
  } else {
    await db.execute({ sql: "UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL", args: [parsed.data.id, req.user.id] });
  }
  res.status(204).end();
}));

// Browser push (lib/push.js). `enabled` is false when the server has no VAPID
// keys, and the page then doesn't offer it.
notificationsRouter.get('/push/key', (req, res) => {
  res.json({ enabled: pushEnabled(), publicKey: pushPublicKey() });
});

const MAX_DEVICES = 10;
const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint, 'Unsupported push service.'),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

notificationsRouter.post('/push/subscribe', asyncRoute(async (req, res) => {
  if (!pushEnabled()) return res.status(404).json({ error: 'Push alerts aren’t available on this server.' });
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid subscription.' });
  const { endpoint, keys } = parsed.data;
  const count = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND endpoint != ?', args: [req.user.id, endpoint] });
  if (Number(count.rows[0].n) >= MAX_DEVICES) return res.status(429).json({ error: `Push is on for ${MAX_DEVICES} devices already. Turn it off on one first.` });
  // The same browser re-subscribing (or a shared device changing hands)
  // moves the endpoint to whoever is signed in now.
  await db.execute({
    sql: `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    args: [req.user.id, endpoint, keys.p256dh, keys.auth],
  });
  res.status(201).json({ ok: true });
}));

notificationsRouter.post('/push/unsubscribe', asyncRoute(async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
  await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', args: [req.user.id, endpoint] });
  res.status(204).end();
}));

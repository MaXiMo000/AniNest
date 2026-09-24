import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { describe } from '../lib/notifications.js';

// A user's own notifications only - one file, one auth boundary.
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

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

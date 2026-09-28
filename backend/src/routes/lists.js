import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { httpUrl } from './favorites.js';

// Custom lists: named, ordered, shareable lists ("Comfort shows", "Best of
// 2026"), each anime with an optional note. Anyone can view a list unless its
// owner's profile is private; only the owner can change it.
export const listsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const MAX_LISTS = 50;
const MAX_ITEMS = 200;
const idOf = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Each list with its item count and first few covers, for list-of-lists views.
async function summaries(where, args) {
  const rows = await db.execute({
    sql: `SELECT l.id, l.name, l.description, l.updated_at,
                 (SELECT COUNT(*) FROM custom_list_items i WHERE i.list_id = l.id) AS count,
                 (SELECT json_group_array(image) FROM (SELECT image FROM custom_list_items i
                    WHERE i.list_id = l.id AND image IS NOT NULL ORDER BY position LIMIT 4)) AS covers
          FROM custom_lists l WHERE ${where} ORDER BY l.updated_at DESC`,
    args,
  });
  return rows.rows.map((r) => ({
    id: Number(r.id), name: r.name, description: r.description || null, updatedAt: r.updated_at,
    count: Number(r.count), covers: JSON.parse(r.covers || '[]'),
  }));
}

// The list and its owner, or null if it doesn't exist or the viewer can't see it.
async function findList(id, viewerId) {
  const res = await db.execute({
    sql: `SELECT l.*, u.username, u.is_private FROM custom_lists l JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
    args: [id],
  });
  const l = res.rows[0];
  if (!l) return null;
  if (Number(l.is_private) && Number(l.user_id) !== viewerId) return null;
  return l;
}

async function listView(l, viewerId) {
  const [items, follows] = await Promise.all([
    db.execute({ sql: 'SELECT mal_id, title, image, note FROM custom_list_items WHERE list_id = ? ORDER BY position', args: [l.id] }),
    db.execute({
      sql: 'SELECT COUNT(*) AS n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine FROM list_follows WHERE list_id = ?',
      args: [viewerId ?? 0, l.id],
    }),
  ]);
  return {
    followers: Number(follows.rows[0].n),
    following: Number(follows.rows[0].mine) > 0,
    id: Number(l.id),
    name: l.name,
    description: l.description || null,
    owner: l.username,
    mine: Number(l.user_id) === viewerId,
    updatedAt: l.updated_at,
    items: items.rows.map((i) => ({ mal_id: Number(i.mal_id), title: i.title, image: i.image || null, note: i.note || null })),
  };
}

// Owner-only lookup for the write routes; sends the error itself.
async function ownList(req, res) {
  const id = idOf(req.params.id);
  const l = id && await findList(id, req.user.id);
  if (!l || Number(l.user_id) !== req.user.id) {
    res.status(404).json({ error: 'No such list.' });
    return null;
  }
  return l;
}

const touch = (id) => ({ sql: "UPDATE custom_lists SET updated_at = datetime('now') WHERE id = ?", args: [id] });

listsRouter.get('/mine', requireAuth, asyncRoute(async (req, res) => {
  res.json({ lists: await summaries('l.user_id = ?', [req.user.id]) });
}));

// Lists the signed-in user follows that they can still see (an owner who
// went private hides theirs).
listsRouter.get('/following', requireAuth, asyncRoute(async (req, res) => {
  const lists = await summaries(
    'l.id IN (SELECT list_id FROM list_follows WHERE user_id = ?) AND l.user_id IN (SELECT id FROM users WHERE is_private = 0)',
    [req.user.id],
  );
  res.json({ lists });
}));

listsRouter.get('/user/:username', asyncRoute(async (req, res) => {
  const found = await db.execute({
    sql: 'SELECT id, is_private FROM users WHERE username = ? COLLATE NOCASE ORDER BY username = ? DESC LIMIT 1',
    args: [req.params.username, req.params.username],
  });
  const u = found.rows[0];
  if (!u) return res.status(404).json({ error: 'No such user.' });
  const own = Number(u.id) === req.user?.id;
  res.json({ lists: Number(u.is_private) && !own ? [] : await summaries('l.user_id = ?', [u.id]) });
}));

listsRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  const l = id && await findList(id, req.user?.id);
  if (!l) return res.status(404).json({ error: 'No such list.' });
  res.json({ data: await listView(l, req.user?.id) });
}));

const listSchema = z.object({
  name: z.string().trim().min(1, 'Give the list a name.').max(60),
  description: z.string().trim().max(300).nullable().optional(),
});

listsRouter.post('/', requireAuth, asyncRoute(async (req, res) => {
  const parsed = listSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const count = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM custom_lists WHERE user_id = ?', args: [req.user.id] });
  if (Number(count.rows[0].n) >= MAX_LISTS) return res.status(409).json({ error: `You can have up to ${MAX_LISTS} lists.` });
  const info = await db.execute({
    sql: 'INSERT INTO custom_lists (user_id, name, description) VALUES (?, ?, ?)',
    args: [req.user.id, parsed.data.name, parsed.data.description || null],
  });
  const l = await findList(Number(info.lastInsertRowid), req.user.id);
  res.status(201).json({ data: await listView(l, req.user.id) });
}));

listsRouter.post('/:id', requireAuth, asyncRoute(async (req, res) => {
  const l = await ownList(req, res);
  if (!l) return;
  const parsed = listSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  await db.execute({
    sql: "UPDATE custom_lists SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?",
    args: [parsed.data.name, parsed.data.description || null, l.id],
  });
  res.json({ data: await listView(await findList(Number(l.id), req.user.id), req.user.id) });
}));

// Follow someone else's list (it shows under "Lists you follow").
listsRouter.post('/:id/follow', requireAuth, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  const l = id && await findList(id, req.user.id);
  if (!l) return res.status(404).json({ error: 'No such list.' });
  if (Number(l.user_id) === req.user.id) return res.status(400).json({ error: 'That’s your own list.' });
  await db.execute({ sql: 'INSERT OR IGNORE INTO list_follows (user_id, list_id) VALUES (?, ?)', args: [req.user.id, l.id] });
  res.json({ data: await listView(l, req.user.id) });
}));

listsRouter.delete('/:id/follow', requireAuth, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(404).json({ error: 'No such list.' });
  await db.execute({ sql: 'DELETE FROM list_follows WHERE user_id = ? AND list_id = ?', args: [req.user.id, id] });
  const l = await findList(id, req.user.id);
  res.json({ data: l ? await listView(l, req.user.id) : null });
}));

listsRouter.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const l = await ownList(req, res);
  if (!l) return;
  await db.batch([
    { sql: 'DELETE FROM list_follows WHERE list_id = ?', args: [l.id] },
    { sql: 'DELETE FROM custom_list_items WHERE list_id = ?', args: [l.id] },
    { sql: 'DELETE FROM custom_lists WHERE id = ?', args: [l.id] },
  ], 'write');
  res.status(204).end();
}));

const itemSchema = z.object({
  mal_id: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  image: httpUrl.optional().or(z.literal('')),
  note: z.string().trim().max(200).nullable().optional(),
});

// Adds an anime to the end of the list, or updates its note if it's already there.
listsRouter.post('/:id/items', requireAuth, asyncRoute(async (req, res) => {
  const l = await ownList(req, res);
  if (!l) return;
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { mal_id: malId, title, image, note } = parsed.data;
  const count = await db.execute({ sql: 'SELECT COUNT(*) AS n, MAX(position) AS last FROM custom_list_items WHERE list_id = ?', args: [l.id] });
  const exists = await db.execute({ sql: 'SELECT 1 FROM custom_list_items WHERE list_id = ? AND mal_id = ?', args: [l.id, malId] });
  if (!exists.rows.length && Number(count.rows[0].n) >= MAX_ITEMS) {
    return res.status(409).json({ error: `A list holds up to ${MAX_ITEMS} anime.` });
  }
  await db.batch([
    {
      sql: `INSERT INTO custom_list_items (list_id, mal_id, title, image, note, position) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(list_id, mal_id) DO UPDATE SET note = excluded.note`,
      args: [l.id, malId, title, image || null, note || null, Number(count.rows[0].last ?? -1) + 1],
    },
    touch(l.id),
  ], 'write');
  res.json({ data: await listView(l, req.user.id) });
}));

listsRouter.delete('/:id/items/:malId', requireAuth, asyncRoute(async (req, res) => {
  const l = await ownList(req, res);
  if (!l) return;
  await db.batch([
    { sql: 'DELETE FROM custom_list_items WHERE list_id = ? AND mal_id = ?', args: [l.id, idOf(req.params.malId) || 0] },
    touch(l.id),
  ], 'write');
  res.json({ data: await listView(l, req.user.id) });
}));

const orderSchema = z.object({ mal_ids: z.array(z.number().int().positive()).max(MAX_ITEMS) });

// Reorders the list: mal_ids is the whole list in its new order.
listsRouter.post('/:id/order', requireAuth, asyncRoute(async (req, res) => {
  const l = await ownList(req, res);
  if (!l) return;
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid order.' });
  const current = await db.execute({ sql: 'SELECT mal_id FROM custom_list_items WHERE list_id = ?', args: [l.id] });
  const have = current.rows.map((r) => Number(r.mal_id)).sort((a, b) => a - b);
  const given = [...parsed.data.mal_ids].sort((a, b) => a - b);
  if (have.length !== given.length || have.some((id, i) => id !== given[i])) {
    return res.status(409).json({ error: 'The list changed. Reload and try again.' });
  }
  await db.batch([
    ...parsed.data.mal_ids.map((malId, i) => ({ sql: 'UPDATE custom_list_items SET position = ? WHERE list_id = ? AND mal_id = ?', args: [i, l.id, malId] })),
    touch(l.id),
  ], 'write');
  res.json({ data: await listView(l, req.user.id) });
}));

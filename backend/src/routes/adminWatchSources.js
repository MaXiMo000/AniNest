import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAdmin } from '../middleware/session.js';
import * as youtube from '../lib/youtube.js';
import { parseYouTubeVideoId } from '../lib/youtubeUrl.js';

// Admin-only curation tools for anime_watch_sources: search the YouTube API
// (see lib/youtube.js for why this is admin-gated - shared, scarce quota),
// directly add an already-confirmed link, and review/approve-or-reject
// what ordinary users have submitted (animeWatchSources.js).
export const adminWatchSourcesRouter = Router();
adminWatchSourcesRouter.use(requireAdmin);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

adminWatchSourcesRouter.get('/channels', (_req, res) => {
  res.json({ data: youtube.CURATED_CHANNELS.map(({ id, name }) => ({ id, name })), configured: youtube.isConfigured() });
});

adminWatchSourcesRouter.get('/search', asyncRoute(async (req, res) => {
  const channel = typeof req.query.channel === 'string' ? req.query.channel : '';
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
  if (!channel || !q) return res.status(400).json({ error: 'channel and q are required.' });

  try {
    const data = await youtube.searchOfficialChannel({ channelId: channel, query: q });
    res.json({ data });
  } catch (err) {
    if (err.notConfigured) return res.status(503).json({ error: err.message, notConfigured: true });
    // Surfaced distinctly so the admin UI can prompt "search quota's out for
    // today - use the submission form instead" rather than a generic error.
    if (err.quotaExceeded) return res.status(429).json({ error: 'YouTube search quota is exhausted for today.', quotaExceeded: true });
    throw err;
  }
}));

const addSchema = z.object({
  mal_id: z.number().int().positive(),
  youtube_url: z.string().trim().max(500),
  channel_name: z.string().trim().max(80).optional(),
  label: z.string().trim().max(80).optional(),
});

// Same parseYouTubeVideoId gate as the public submission route - an admin
// picking a search result or pasting a link by hand goes through the exact
// same strict validation, no separate "trusted" code path. The only
// difference from a regular submission is this lands as already-'approved'
// (the admin's own action is the confirmation) with reviewed_by set.
adminWatchSourcesRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { mal_id: malId, youtube_url: youtubeUrl, channel_name: channelName, label } = parsed.data;

  const videoId = parseYouTubeVideoId(youtubeUrl);
  if (!videoId) return res.status(400).json({ error: "That doesn't look like a YouTube video link." });

  try {
    await db.execute({
      sql: `INSERT INTO anime_watch_sources (mal_id, youtube_video_id, channel_name, label, status, submitted_by, reviewed_by, reviewed_at)
            VALUES (?, ?, ?, ?, 'approved', ?, ?, datetime('now'))`,
      args: [malId, videoId, channelName || null, label || null, req.user.id, req.user.id],
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That link is already added for this anime.' });
    }
    throw err;
  }

  res.status(201).json({ ok: true });
}));

adminWatchSourcesRouter.get('/pending', asyncRoute(async (_req, res) => {
  const result = await db.execute(`
    SELECT aws.id, aws.mal_id, aws.youtube_video_id, aws.channel_name, aws.label, aws.created_at,
           u.username AS submitted_by_username
    FROM anime_watch_sources aws
    LEFT JOIN users u ON u.id = aws.submitted_by
    WHERE aws.status = 'pending'
    ORDER BY aws.created_at ASC
  `);
  res.json({ data: result.rows });
}));

adminWatchSourcesRouter.post('/:id/approve', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
  await db.execute({
    sql: "UPDATE anime_watch_sources SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'",
    args: [req.user.id, id],
  });
  res.status(204).end();
}));

adminWatchSourcesRouter.post('/:id/reject', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
  await db.execute({
    sql: "UPDATE anime_watch_sources SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'",
    args: [req.user.id, id],
  });
  res.status(204).end();
}));

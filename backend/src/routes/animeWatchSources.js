import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { parseYouTubeVideoId } from '../lib/youtubeUrl.js';

// Flat-mounted at /api/anime-watch-sources (POST only), same convention as
// favorites.js/mangaFavorites.js being siblings of anime.js/manga.js rather
// than nested under them - one file, one auth boundary
// (router.use(requireAuth) below covers the whole file). The read side
// (GET /api/anime/:id/watch-sources, public/no auth) lives in anime.js
// itself instead, alongside its other anime-metadata routes.
export const animeWatchSourcesRouter = Router();
animeWatchSourcesRouter.use(requireAuth);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const MAX_PENDING_PER_USER = 20;

const submitSchema = z.object({
  mal_id: z.number().int().positive(),
  youtube_url: z.string().trim().max(500),
  channel_name: z.string().trim().max(80).optional(),
  label: z.string().trim().max(80).optional(),
});

// Any logged-in user can submit - this is the always-available fallback
// path (surfaced prominently when the admin's YouTube-search quota runs
// out for the day, but not gated behind that - a submission never touches
// the YouTube API at all, it costs nothing). Always lands as 'pending';
// only an admin approving it (adminWatchSources.js) makes it public.
animeWatchSourcesRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const { mal_id: malId, youtube_url: youtubeUrl, channel_name: channelName, label } = parsed.data;

  // The one and only place a raw URL is ever looked at - parseYouTubeVideoId
  // either hands back a bare 11-char id or null, full stop. Nothing else
  // about the submitted string (query params, path, host) is ever stored.
  const videoId = parseYouTubeVideoId(youtubeUrl);
  if (!videoId) return res.status(400).json({ error: "That doesn't look like a YouTube video link." });

  const pendingCount = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM anime_watch_sources WHERE submitted_by = ? AND status = 'pending'",
    args: [req.user.id],
  });
  if (Number(pendingCount.rows[0].count) >= MAX_PENDING_PER_USER) {
    return res.status(429).json({ error: `You've hit the ${MAX_PENDING_PER_USER}-pending-submission limit — wait for some to be reviewed.` });
  }

  try {
    await db.execute({
      sql: `INSERT INTO anime_watch_sources (mal_id, youtube_video_id, channel_name, label, status, submitted_by)
            VALUES (?, ?, ?, ?, 'pending', ?)`,
      args: [malId, videoId, channelName || null, label || null, req.user.id],
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That link has already been submitted for this anime.' });
    }
    throw err;
  }

  res.status(201).json({ ok: true });
}));

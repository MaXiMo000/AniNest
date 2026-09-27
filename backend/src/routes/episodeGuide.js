import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { episodeFlags } from '../lib/episodeFlags.js';

// Community episode guide for one anime: the average 1-5 rating per episode
// and the episode where people say the show "clicks". You can only rate or
// mark episodes you've reached on your own progress (routes/favorites.js),
// which also keeps drive-by rating bombs out.
export const episodeGuideRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Below this many votes an episode's average (or the "clicks at" answer) isn't shown.
export const MIN_VOTES = 5;

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// The median, not the mean, so one troll saying "episode 900" can't move it.
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

// Filler and recap episodes from MAL, separate from the guide itself so the
// guide never waits on Jikan. available: false when Jikan is down and
// nothing is stored yet; the page then just shows no skip guide.
episodeGuideRouter.get('/:id/flags', asyncRoute(async (req, res) => {
  const malId = parseId(req.params.id);
  if (!malId) return res.status(400).json({ error: 'Invalid anime id.' });
  try {
    res.json({ available: true, ...(await episodeFlags(malId)) });
  } catch (err) {
    req.log.warn({ err, malId }, 'episode flags unavailable');
    res.json({ available: false, filler: [], recap: [] });
  }
}));

episodeGuideRouter.get('/:id', asyncRoute(async (req, res) => {
  const malId = parseId(req.params.id);
  if (!malId) return res.status(400).json({ error: 'Invalid anime id.' });
  const [stats, clicks] = await Promise.all([
    db.execute({
      sql: 'SELECT episode, AVG(rating) AS avg, COUNT(*) AS n FROM episode_ratings WHERE mal_id = ? GROUP BY episode ORDER BY episode',
      args: [malId],
    }),
    db.execute({ sql: 'SELECT episode FROM it_clicked WHERE mal_id = ?', args: [malId] }),
  ]);
  const clickEpisodes = clicks.rows.map((r) => Number(r.episode));
  const body = {
    minVotes: MIN_VOTES,
    // Averages only once enough people rated; the count is always shown.
    episodes: stats.rows.map((r) => ({
      episode: Number(r.episode),
      n: Number(r.n),
      avg: Number(r.n) >= MIN_VOTES ? Math.round(Number(r.avg) * 10) / 10 : null,
    })),
    clicksAt: clickEpisodes.length >= MIN_VOTES ? median(clickEpisodes) : null,
    clickVotes: clickEpisodes.length,
  };
  if (req.user) {
    const [mine, clicked, progress] = await Promise.all([
      db.execute({ sql: 'SELECT episode, rating FROM episode_ratings WHERE user_id = ? AND mal_id = ?', args: [req.user.id, malId] }),
      db.execute({ sql: 'SELECT episode FROM it_clicked WHERE user_id = ? AND mal_id = ?', args: [req.user.id, malId] }),
      db.execute({ sql: 'SELECT episodes_watched FROM favorites WHERE user_id = ? AND mal_id = ?', args: [req.user.id, malId] }),
    ]);
    body.mine = {
      ratings: Object.fromEntries(mine.rows.map((r) => [Number(r.episode), Number(r.rating)])),
      clickedAt: clicked.rows[0] ? Number(clicked.rows[0].episode) : null,
      watched: Number(progress.rows[0]?.episodes_watched) || 0,
    };
  }
  res.json(body);
}));

async function watchedSoFar(userId, malId) {
  const res = await db.execute({ sql: 'SELECT episodes_watched FROM favorites WHERE user_id = ? AND mal_id = ?', args: [userId, malId] });
  return Number(res.rows[0]?.episodes_watched) || 0;
}

const rateSchema = z.object({
  episode: z.number().int().positive().max(5000),
  rating: z.number().int().min(1).max(5).nullable(), // null takes the rating back
});

episodeGuideRouter.post('/:id/rate', requireAuth, asyncRoute(async (req, res) => {
  const malId = parseId(req.params.id);
  const parsed = rateSchema.safeParse(req.body);
  if (!malId || !parsed.success) return res.status(400).json({ error: 'Invalid rating.' });
  const { episode, rating } = parsed.data;
  if (episode > await watchedSoFar(req.user.id, malId)) return res.status(403).json({ error: 'Mark the episode as watched first.' });
  await db.execute(rating == null
    ? { sql: 'DELETE FROM episode_ratings WHERE user_id = ? AND mal_id = ? AND episode = ?', args: [req.user.id, malId, episode] }
    : {
      sql: `INSERT INTO episode_ratings (user_id, mal_id, episode, rating) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, mal_id, episode) DO UPDATE SET rating = excluded.rating, updated_at = datetime('now')`,
      args: [req.user.id, malId, episode, rating],
    });
  res.json({ ok: true });
}));

const clickedSchema = z.object({ episode: z.number().int().positive().max(5000).nullable() });

episodeGuideRouter.post('/:id/clicked', requireAuth, asyncRoute(async (req, res) => {
  const malId = parseId(req.params.id);
  const parsed = clickedSchema.safeParse(req.body);
  if (!malId || !parsed.success) return res.status(400).json({ error: 'Invalid episode.' });
  const { episode } = parsed.data;
  if (episode != null && episode > await watchedSoFar(req.user.id, malId)) return res.status(403).json({ error: 'Mark the episode as watched first.' });
  await db.execute(episode == null
    ? { sql: 'DELETE FROM it_clicked WHERE user_id = ? AND mal_id = ?', args: [req.user.id, malId] }
    : {
      sql: 'INSERT INTO it_clicked (user_id, mal_id, episode) VALUES (?, ?, ?) ON CONFLICT(user_id, mal_id) DO UPDATE SET episode = excluded.episode',
      args: [req.user.id, malId, episode],
    });
  res.json({ ok: true });
}));

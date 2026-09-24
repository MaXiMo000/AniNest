import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAdmin } from '../middleware/session.js';
import * as youtube from '../lib/youtube.js';
import { parseYouTubeVideoId } from '../lib/youtubeUrl.js';
import * as watchSourceMatcher from '../lib/watchSourceMatcher.js';

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

// Bulk-populates real, currently-available free episodes from one curated
// channel. Lists everything the channel has actually uploaded (cheap - see
// lib/youtube.js's listChannelUploads), parses each title into series/
// season/episode/language (lib/watchSourceMatcher.js - anything that isn't a
// full episode or a "Complete Series" upload is dropped), groups the
// episodes by series+season, and matches each GROUP once against AniList
// using strict exact-title equality. A confident match inserts every
// episode in the group as approved; anything else goes into
// watch_source_candidates for a human to assign - nothing is ever guessed
// into the database, because a wrong auto-match puts a stranger's episode on
// the wrong anime's page.
//
// AniList allows ~90 req/min and a channel can have hundreds of distinct
// series, so one request works through as many groups as fit in a time
// budget (paced) and reports how many are left; the caller just runs it
// again. Videos already known (approved/pending/rejected source, or in the
// candidate queue) are skipped up front, so each run only does new work.
const VALID_YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const IMPORT_TIME_BUDGET_MS = 40_000;
const ANILIST_PACE_MS = 750;
// A link an admin previously took down keeps its row (status 'removed'), which
// would otherwise block re-adding the same video to the same anime through
// the UNIQUE(mal_id, youtube_video_id) constraint - so the bulk paths revive it.
const REVIVE_REMOVED = "ON CONFLICT(mal_id, youtube_video_id) DO UPDATE SET status = 'approved', reviewed_at = datetime('now') WHERE anime_watch_sources.status = 'removed'";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

adminWatchSourcesRouter.post('/bulk-import', asyncRoute(async (req, res) => {
  const channel = typeof req.body.channel === 'string' ? req.body.channel : '';
  if (!channel) return res.status(400).json({ error: 'channel is required.' });
  const maxItems = Math.min(3000, Math.max(1, Number(req.body.maxItems) || 2000));

  let uploads;
  try {
    uploads = await youtube.listChannelUploads(channel, { maxItems });
  } catch (err) {
    if (err.notConfigured) return res.status(503).json({ error: err.message, notConfigured: true });
    if (err.quotaExceeded) return res.status(429).json({ error: 'YouTube quota is exhausted for today.', quotaExceeded: true });
    throw err;
  }

  const knownRows = await db.execute(`
    SELECT youtube_video_id AS id FROM anime_watch_sources WHERE status IN ('approved','pending','rejected')
    UNION SELECT youtube_video_id FROM watch_source_candidates
  `);
  const known = new Set(knownRows.rows.map((r) => r.id));

  let alreadyKnown = 0;
  let skippedNotEpisode = 0;
  const skippedSamples = [];
  const groups = new Map();
  for (const video of uploads) {
    if (!VALID_YOUTUBE_ID_RE.test(video.videoId)) continue; // defense in depth; shouldn't happen from our own API response
    if (known.has(video.videoId)) { alreadyKnown += 1; continue; }
    const parsed = watchSourceMatcher.parseUploadTitle(video.title);
    if (!parsed) {
      skippedNotEpisode += 1;
      if (skippedSamples.length < 8) skippedSamples.push(video.title);
      continue;
    }
    const g = groups.get(parsed.groupKey) || { parsed, videos: [] };
    g.videos.push({ videoId: video.videoId, title: video.title, label: parsed.label, channelName: video.channelName });
    groups.set(parsed.groupKey, g);
  }

  const deadline = Date.now() + IMPORT_TIME_BUDGET_MS;
  const added = [];
  let addedEpisodes = 0;
  let queuedGroups = 0;
  let queuedEpisodes = 0;
  let remainingGroups = 0;

  for (const [groupKey, g] of [...groups.entries()].sort((a, b) => b[1].videos.length - a[1].videos.length)) {
    if (Date.now() > deadline) { remainingGroups += 1; continue; }

    let match;
    try {
      match = await watchSourceMatcher.matchSeries(g.parsed);
    } catch {
      // AniList couldn't answer (rate limit/outage) - retry next run rather
      // than queueing it as "unmatched", which it isn't.
      remainingGroups += 1;
      await sleep(ANILIST_PACE_MS);
      continue;
    }
    await sleep(ANILIST_PACE_MS);

    if (match) {
      let n = 0;
      for (const v of g.videos) {
        try {
          await db.execute({
            sql: `INSERT INTO anime_watch_sources (mal_id, youtube_video_id, channel_name, label, status, submitted_by, reviewed_by, reviewed_at)
                  VALUES (?, ?, ?, ?, 'approved', ?, ?, datetime('now'))
                  ${REVIVE_REMOVED}`,
            args: [match.malId, v.videoId, v.channelName, v.label, req.user.id, req.user.id],
          });
          n += 1;
        } catch (err) {
          if (!String(err.message).includes('UNIQUE')) throw err;
        }
      }
      addedEpisodes += n;
      added.push({ malId: match.malId, animeTitle: match.title, episodes: n });
    } else {
      for (const v of g.videos) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO watch_source_candidates (youtube_video_id, title, channel_name, group_key, series_guess, season, label)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [v.videoId, v.title, v.channelName, groupKey, g.parsed.series, g.parsed.season, v.label],
        });
      }
      queuedGroups += 1;
      queuedEpisodes += g.videos.length;
    }
  }

  res.json({
    totalUploadsScanned: uploads.length,
    alreadyKnown,
    skippedNotEpisode,
    skippedSamples,
    added,
    addedEpisodes,
    queuedGroups,
    queuedEpisodes,
    remainingGroups,
  });
}));

// --- Review queue for uploads the importer couldn't confidently match -------

adminWatchSourcesRouter.get('/candidates', asyncRoute(async (_req, res) => {
  const result = await db.execute(`
    SELECT group_key, series_guess, season, channel_name,
           COUNT(*) AS episodes, MIN(title) AS sample_title, MIN(youtube_video_id) AS sample_video
    FROM watch_source_candidates
    WHERE status = 'open'
    GROUP BY group_key
    ORDER BY episodes DESC
    LIMIT 200
  `);
  res.json({ data: result.rows });
}));

const assignSchema = z.object({
  group_key: z.string().trim().min(1).max(400),
  mal_id: z.number().int().positive(),
});

// Assigns every open episode in one group to an anime in a single action -
// the whole point of grouping: "Fairy Tail" x 100 episodes is one decision.
adminWatchSourcesRouter.post('/candidates/assign', asyncRoute(async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input.' });
  const { group_key: groupKey, mal_id: malId } = parsed.data;

  const rows = await db.execute({
    sql: "SELECT id, youtube_video_id, channel_name, label FROM watch_source_candidates WHERE status = 'open' AND group_key = ?",
    args: [groupKey],
  });
  let added = 0;
  for (const r of rows.rows) {
    try {
      await db.execute({
        sql: `INSERT INTO anime_watch_sources (mal_id, youtube_video_id, channel_name, label, status, submitted_by, reviewed_by, reviewed_at)
              VALUES (?, ?, ?, ?, 'approved', ?, ?, datetime('now'))
              ${REVIVE_REMOVED}`,
        args: [malId, r.youtube_video_id, r.channel_name, r.label, req.user.id, req.user.id],
      });
      added += 1;
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
    await db.execute({ sql: 'DELETE FROM watch_source_candidates WHERE id = ?', args: [r.id] });
  }
  res.json({ added });
}));

adminWatchSourcesRouter.post('/candidates/dismiss', asyncRoute(async (req, res) => {
  const groupKey = typeof req.body.group_key === 'string' ? req.body.group_key : '';
  if (!groupKey) return res.status(400).json({ error: 'group_key is required.' });
  await db.execute({ sql: "UPDATE watch_source_candidates SET status = 'dismissed' WHERE group_key = ?", args: [groupKey] });
  res.status(204).end();
}));

// --- Managing what's already live -------------------------------------------

adminWatchSourcesRouter.get('/approved', asyncRoute(async (req, res) => {
  const malId = Number(req.query.mal_id);
  if (!Number.isInteger(malId) || malId <= 0) return res.status(400).json({ error: 'mal_id is required.' });
  const result = await db.execute({
    sql: "SELECT id, youtube_video_id, channel_name, label FROM anime_watch_sources WHERE mal_id = ? AND status = 'approved' ORDER BY id",
    args: [malId],
  });
  res.json({ data: result.rows });
}));

// Takes a live link down (a wrong auto-match, a video that went private...).
// Marked 'removed' - not deleted, and deliberately not one of the statuses
// the importer treats as "already handled" - so a later import re-evaluates
// that video from scratch and can attach it to the RIGHT anime.
adminWatchSourcesRouter.post('/:id/remove', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
  await db.execute({
    sql: "UPDATE anime_watch_sources SET status = 'removed', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'approved'",
    args: [req.user.id, id],
  });
  res.status(204).end();
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

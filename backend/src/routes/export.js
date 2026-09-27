import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { toCsv, toMalXml } from '../lib/listExport.js';

// "Export my list" on the account page, the counterpart of AniList import.
// ("Download my data", everything as JSON, is GET /api/auth/export.)
//   GET /api/export/csv   your anime list with your ratings, for spreadsheets
//   GET /api/export/mal   your anime list as MyAnimeList import XML
// Plain GETs answered as file downloads, so the page can link to them directly.
export const exportRouter = Router();
exportRouter.use(requireAuth);

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

async function animeList(userId) {
  const result = await db.execute({
    sql: `
      SELECT f.mal_id, f.title, f.type, f.status, f.episodes, f.episodes_watched, f.added_at,
             r.rating AS my_rating, r.body AS my_review
      FROM favorites f
      LEFT JOIN reviews r ON r.user_id = f.user_id AND r.mal_id = f.mal_id
      WHERE f.user_id = ?
      ORDER BY f.title COLLATE NOCASE
    `,
    args: [userId],
  });
  return result.rows.map((r) => ({ ...r }));
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function sendFile(res, filename, type, body) {
  res.set({
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.send(body);
}

exportRouter.get('/csv', asyncRoute(async (req, res) => {
  sendFile(res, `aninest-${req.user.username}-anime-${stamp()}.csv`, 'text/csv; charset=utf-8', toCsv(await animeList(req.user.id)));
}));

exportRouter.get('/mal', asyncRoute(async (req, res) => {
  const xml = toMalXml(await animeList(req.user.id), { username: req.user.username });
  sendFile(res, `aninest-${req.user.username}-mal-${stamp()}.xml`, 'application/xml; charset=utf-8', xml);
}));

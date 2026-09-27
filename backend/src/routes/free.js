import { Router } from 'express';
import { db } from '../lib/db.js';
import { titlesFor, backfillTitles } from '../lib/animeTitles.js';

// "Free in my country": every anime with an approved official upload that
// YouTube says plays in the given country (same region rules as the detail
// page's picker, frontend/src/lib/country.js playableIn). Public.
export const freeRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const parse = (text) => {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
};

export function playableIn(row, country) {
  if (!country) return true;
  const blocked = parse(row.blocked_regions);
  const allowed = parse(row.allowed_regions);
  if (blocked?.includes(country)) return false;
  if (allowed && !allowed.includes(country)) return false;
  return true;
}

freeRouter.get('/', asyncRoute(async (req, res) => {
  const raw = String(req.query.country || '').toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) ? raw : null;
  const rows = await db.execute("SELECT mal_id, allowed_regions, blocked_regions FROM anime_watch_sources WHERE status = 'approved'");
  const uploads = new Map();
  let elsewhere = 0;
  for (const r of rows.rows) {
    const id = Number(r.mal_id);
    if (playableIn(r, country)) uploads.set(id, (uploads.get(id) || 0) + 1);
    else elsewhere += 1;
  }
  const ids = [...uploads.keys()];
  const titles = await titlesFor(ids);
  const missing = ids.filter((id) => !titles.has(id));
  // Fill a few more in the background; they show up on a later visit.
  if (missing.length) backfillTitles(missing).catch(() => {});
  const data = ids.filter((id) => titles.has(id))
    .map((id) => ({ ...titles.get(id), uploads: uploads.get(id) }))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title));
  res.json({ country, data, pending: missing.length, blockedUploads: elsewhere });
}));

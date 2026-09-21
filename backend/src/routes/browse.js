import { Router } from 'express';
import { anilistStudioByName, anilistStaffByName } from '../lib/anilist.js';
import { cached } from '../lib/cache.js';

export const studiosRouter = Router();
export const peopleRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Studio/VA rosters change rarely (a studio doesn't gain a new past credit
// often) - a longer TTL than the anime-list caches is fine and cuts repeat
// AniList calls for a popular studio/VA page.
const TTL = 60 * 60 * 1000;

studiosRouter.get('/:name', asyncRoute(async (req, res) => {
  const name = String(req.params.name).slice(0, 100);
  const data = await cached(`studio:${name.toLowerCase()}`, TTL, () => anilistStudioByName(name));
  if (!data) return res.status(404).json({ error: 'Studio not found.' });
  res.json(data);
}));

peopleRouter.get('/:name', asyncRoute(async (req, res) => {
  const name = String(req.params.name).slice(0, 100);
  const data = await cached(`staff:${name.toLowerCase()}`, TTL, () => anilistStaffByName(name));
  if (!data) return res.status(404).json({ error: 'Person not found.' });
  res.json(data);
}));

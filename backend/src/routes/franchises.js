import { Router } from 'express';
import { franchiseBySlug } from '../lib/franchiseStore.js';

export const franchisesRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const SLUG = /^[a-z0-9-]{1,70}$/;

// Public watch guide for one franchise. Guides are created from a member
// anime's page (GET /api/anime/:id/franchise), never from a slug, so an
// unknown slug is a plain 404 and can't be used to make the server walk AniList.
franchisesRouter.get('/:slug', asyncRoute(async (req, res) => {
  if (!SLUG.test(req.params.slug)) return res.status(400).json({ error: 'Invalid franchise.' });
  const franchise = await franchiseBySlug(req.params.slug);
  if (!franchise) return res.status(404).json({ error: 'No such franchise.' });
  res.json({ data: franchise });
}));

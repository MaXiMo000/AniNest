import { Router } from 'express';
import { requireAuth } from '../middleware/session.js';
import { friendsActivity } from '../lib/feed.js';

export const feedRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// The signed-in user's activity feed: the last 30 days of the people they follow.
feedRouter.get('/', requireAuth, asyncRoute(async (req, res) => {
  res.json(await friendsActivity(req.user.id, '-30 days', 60));
}));


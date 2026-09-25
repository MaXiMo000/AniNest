import { Router } from 'express';
import { requireAuth } from '../middleware/session.js';
import { calendarToken, rotateCalendarToken, calendarFeed } from '../lib/calendar.js';

export const calendarRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// The feed URL is built from this request's own host, so it points at the
// API whichever domain served it (trust proxy makes the protocol https behind Render).
function feedUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/api/calendar/${token}.ics`;
}

calendarRouter.get('/link', requireAuth, asyncRoute(async (req, res) => {
  res.json({ url: feedUrl(req, await calendarToken(req.user.id)) });
}));

// A new token; the old link stops working immediately.
calendarRouter.post('/link/rotate', requireAuth, asyncRoute(async (req, res) => {
  res.json({ url: feedUrl(req, await rotateCalendarToken(req.user.id)) });
}));

// Public by design (calendar apps send no cookie): the token is the credential.
// Unknown and malformed tokens get the same 404.
calendarRouter.get('/:file', asyncRoute(async (req, res) => {
  const match = /^(.+)\.ics$/.exec(req.params.file);
  const frontendOrigin = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const body = match ? await calendarFeed(match[1], { frontendOrigin }) : null;
  if (!body) return res.status(404).json({ error: 'No such calendar.' });
  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="aninest.ics"',
    'Cache-Control': 'private, max-age=900',
  });
  res.send(body);
}));

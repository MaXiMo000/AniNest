import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { logger } from './lib/logger.js';
import { tidewatchMetrics } from './lib/tidewatch-metrics.js';
import { attachUser } from './middleware/session.js';
import { ensureCsrfCookie, verifyCsrf } from './middleware/csrf.js';
import { generalLimiter, authLimiter } from './middleware/rateLimits.js';
import { authRouter } from './routes/auth.js';
import { favoritesRouter } from './routes/favorites.js';
import { animeRouter } from './routes/anime.js';
import { reviewsRouter } from './routes/reviews.js';
import { usersRouter } from './routes/users.js';
import { clientErrorsRouter } from './routes/clientErrors.js';
import { gamesRouter } from './routes/games.js';
import { recommendationsRouter } from './routes/recommendations.js';
import { studiosRouter, peopleRouter } from './routes/browse.js';
import { importRouter } from './routes/import.js';
import { screenshotSearchRouter } from './routes/screenshotSearch.js';
import { mangaRouter } from './routes/manga.js';
import { mangaFavoritesRouter } from './routes/mangaFavorites.js';
import { animeWatchSourcesRouter } from './routes/animeWatchSources.js';
import { adminWatchSourcesRouter } from './routes/adminWatchSources.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { mangaReviewsRouter } from './routes/mangaReviews.js';
import { notificationsRouter } from './routes/notifications.js';
import { franchisesRouter } from './routes/franchises.js';
import { calendarRouter } from './routes/calendar.js';

// Express app assembly lives here, separate from server.js's listen()/signal
// handling, so tests can import and exercise `app` directly (e.g. with
// app.listen(0) on an ephemeral port) without booting a real long-running
// process or fighting over a fixed port.
export function createApp() {
  const app = express();
  const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    // This process only ever serves JSON — the CSP that matters lives on the
    // frontend's own HTML. Cross-origin resource policy must be relaxed since
    // the frontend is a genuinely different origin (different port) by design.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // Tidewatch dashboard: request timing + GET /tidewatch/metrics (aggregates only, Bearer
  // token). Only mounted when TIDEWATCH_METRICS_TOKEN is set; placed before CORS, cookies,
  // request logging and the rate limiter so the poll is never logged, limited or sessioned.
  tidewatchMetrics(app);

  app.use(cors({
    origin: FRONTEND_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-csrf-token'],
    // Custom response headers are invisible to frontend JS by default even
    // within an allowed CORS origin — this is what lets the frontend read
    // the CSRF token from the x-csrf-token response header (see csrf.js).
    exposedHeaders: ['x-csrf-token'],
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '10kb' }));
  // One structured log line per request (method, path, status, duration,
  // an auto-generated request id) - skips /api/health so Render's own
  // uptime pings don't drown out everything else in the log stream.
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/api/health' },
  }));
  app.use(generalLimiter);
  app.use(attachUser);
  app.use(ensureCsrfCookie);
  app.use(verifyCsrf);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/favorites', favoritesRouter);
  app.use('/api/anime', animeRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/client-errors', clientErrorsRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/recommendations', recommendationsRouter);
  app.use('/api/studios', studiosRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api/import', importRouter);
  app.use('/api/screenshot-search', screenshotSearchRouter);
  app.use('/api/manga', mangaRouter);
  app.use('/api/manga-favorites', mangaFavoritesRouter);
  app.use('/api/manga-reviews', mangaReviewsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/franchises', franchisesRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/anime-watch-sources', animeWatchSourcesRouter);
  app.use('/api/admin/watch-sources', adminWatchSourcesRouter);
  // Not under /api/users: usersRouter's /:username would swallow /leaderboard.
  app.use('/api/leaderboard', leaderboardRouter);

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // Centralized error handler: never leak stack traces or internal error
  // strings to clients — log them server-side (via the same structured
  // logger/request id as everything else) and return a generic message.
  app.use((err, req, res, _next) => {
    (req.log || logger).error({ err }, 'unhandled request error');
    const status = err.status && err.status < 500 ? err.status : 502;
    res.status(status).json({ error: status < 500 ? err.message : 'Upstream anime data source is unavailable right now.' });
  });

  return app;
}

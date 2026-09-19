import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { attachUser } from './middleware/session.js';
import { ensureCsrfCookie, verifyCsrf } from './middleware/csrf.js';
import { generalLimiter, authLimiter } from './middleware/rateLimits.js';
import { authRouter } from './routes/auth.js';
import { favoritesRouter } from './routes/favorites.js';
import { animeRouter } from './routes/anime.js';

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

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // Centralized error handler: never leak stack traces or internal error
  // strings to clients — log them server-side and return a generic message.
  app.use((err, req, res, _next) => {
    console.error(err);
    const status = err.status && err.status < 500 ? err.status : 502;
    res.status(status).json({ error: status < 500 ? err.message : 'Upstream anime data source is unavailable right now.' });
  });

  return app;
}

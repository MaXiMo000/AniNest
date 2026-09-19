import rateLimit from 'express-rate-limit';

// Limits are env-overridable so the test suite can raise them (many tests
// legitimately hit /api/auth/* in the same process, sharing one IP-keyed
// bucket — without this they'd trip each other's rate limit) without
// changing the secure defaults used everywhere else.
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down a little.' },
});

// Auth endpoints get a much tighter limit to blunt credential-stuffing /
// brute-force and registration-spam attempts.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

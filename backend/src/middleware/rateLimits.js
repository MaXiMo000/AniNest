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
  // A manga browse page loads ~20 covers at once; counting those against the
  // same budget as API calls would 429 real users mid-page. The cover route
  // is strictly allowlisted, size-capped and cached (see routes/manga.js).
  skip: (req) => req.path.startsWith('/api/manga/cover/'),
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

// Screenshot search uploads up to 5 MB per request and forwards it to
// trace.moe, whose free quota is per calling IP - ours, shared by every
// visitor. A few searches a minute is plenty for a person.
export const screenshotLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.SCREENSHOT_RATE_LIMIT) || 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That’s a lot of screenshots! Wait a minute and try again.' },
});

import crypto from 'node:crypto';

// Double-submit-cookie CSRF defense: a random token is set as a *readable*
// (non-httpOnly) cookie; the frontend echoes it back in a custom header on
// every mutating request. A cross-site page can trigger a request that
// carries the cookie automatically, but it cannot read the cookie's value
// (blocked by same-origin policy) to also set the matching header — so the
// two won't match unless the request actually originated from our own
// frontend JS. Combined with SameSite=Lax cookies and a locked-down CORS
// origin, this covers CSRF without needing server-side token storage.
export const CSRF_COOKIE = 'aninest_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function ensureCsrfCookie(req, res, next) {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    req.cookies[CSRF_COOKIE] = token;
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensMatch(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length must match before timingSafeEqual (it throws on mismatched
  // lengths); leaking token *length* via timing is not meaningful since
  // both tokens are always the same fixed size in normal use.
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }
  next();
}

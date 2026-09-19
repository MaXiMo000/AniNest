import crypto from 'node:crypto';

// Double-submit-cookie CSRF defense: a random token is set as a cookie; the
// frontend echoes it back in a custom header on every mutating request, and
// the server checks the two match. A cross-site page can trigger a request
// that carries the cookie automatically, but it can't produce the matching
// header without first learning the token value.
//
// The frontend learns that value from THIS response header, not by reading
// the cookie via `document.cookie` — frontend and backend are deployed as
// genuinely different hostnames (aninest-frontend/-backend.onrender.com),
// so a cookie set by the backend is invisible to frontend-origin JS no
// matter its httpOnly flag; that's normal same-origin-policy cookie scoping,
// not a bug to route around with a shared cookie domain (onrender.com is a
// registered public suffix — browsers block exactly that trick anyway).
// Handing the token over via a response header instead still preserves the
// security property: this header is only readable by JS if CORS exposes it
// AND the request's origin matches our allowlist, so a malicious third-party
// page still can't learn the token even though it can trigger the request.
export const CSRF_COOKIE = 'aninest_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const isProd = process.env.NODE_ENV === 'production';

export function ensureCsrfCookie(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: true,
      // Same reasoning as the session cookie (see auth.js's cookieOpts):
      // frontend and backend are different *sites* under onrender.com (a
      // public suffix), so SameSite=Lax never sends this cookie back on
      // cross-site fetch() calls in production — every request looked like
      // a brand-new client, generating a fresh token each time and making
      // every mutating request fail with "Invalid or missing CSRF token."
      // regardless of what the frontend sent.
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
    });
    req.cookies[CSRF_COOKIE] = token;
  }
  res.set(CSRF_HEADER, token);
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

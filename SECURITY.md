# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Don't open a public issue for them.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply as soon as
possible, and a fix will be released before any details are made public.

## Protections in place

- Passwords are hashed with bcrypt and never logged or returned.
- Sessions are random tokens in an httpOnly, Secure cookie; the database stores only their hash.
- Email verification, alerts on password changes and new-device logins, and optional two-factor login with recovery codes.
- CSRF protection on every request that changes data.
- Rate limits on the whole API, with stricter limits on sign-in and account routes.
- Every write is validated, every SQL value is a bound parameter, and every user-owned row is checked against the signed-in user.
- CORS allows only the site's own origin; security headers and a strict Content-Security-Policy are set on every page.
- Submitted video links are reduced to a video id and embedded only from official players; no raw URL is stored or embedded.
- Ranked game rounds are dealt and scored on the server.
- Errors returned to visitors are generic; details go only to the server log.
- Development and test runs cannot reach the production database, and secrets live only in environment settings.

# AniNest — Session Handoff

Living document — read this first in a new session, then update it before your context runs out again. Last updated by a session that: migrated the DB to Turso, found and fixed a critical cross-site cookie bug, shipped weekly schedule + reviews/ratings, and re-added Turnstile.

## What this is

A comic-book styled anime discovery site — browse/search/filter anime, watch official trailers, save favorites, leave ratings/reviews, check a weekly airing schedule. Full-stack, deployed free (Render + Turso + Cloudflare).

- **Live**: https://aninest-frontend.onrender.com (frontend), https://aninest-backend.onrender.com (backend)
- **Repo**: https://github.com/MaXiMo000/AniNest (public)
- **Stack**: Vite + vanilla JS frontend, Express + `@libsql/client` (Turso/SQLite) backend, no framework either side
- **Owner's account on the live site**: username `mxximo` (their real account, migrated in — see "Data migration" below, don't touch its data carelessly)

## Architecture at a glance

```
AniNest/
  frontend/   Vite + vanilla JS SPA, hash-based routing (#/browse, #/anime/123, ...)
  backend/    Express API — auth, favorites, reviews, anime-data proxy/cache
    src/app.js       Express app assembly (importable, used by tests)
    src/server.js    Thin entrypoint: listen() + signal handling
    src/lib/db.js    Turso/local-SQLite client (same code, two modes)
    test/            22 integration tests, node:test + fetch, no mocking framework
  render.yaml   Render Blueprint (both services)
  DEPLOY.md     Deployment steps
  README.md     Feature list + security writeup
```

No streaming of actual episodes/movies (would require piracy-scraper APIs — declined on copyright grounds). Trailers are official YouTube embeds; "Where to Watch" links to legit platforms.

## Everything built this session, roughly in order

1. **Full backend added** — Express + auth (bcrypt, httpOnly sessions, CSRF) + favorites tied to accounts, replacing the original localStorage-only frontend-only version.
2. **Security hardening pass** — found and fixed a real stored-XSS gap (favorites `image` field wasn't escaped in `src=` attributes), timing-safe CSRF comparison, per-user favorites cap, CSP as a real header (not just `<meta>`), 17-test suite, crash safety nets (`uncaughtException`/`unhandledRejection`, graceful shutdown).
3. **Rebrand** AnimeVerse → AniNest.
4. **Deployed to Render** via Blueprint (`render.yaml`) — hit real platform constraints along the way (see "Render gotchas" below).
5. **Migrated DB to Turso** — Render's free tier can't attach a persistent disk at all; SQLite-on-disk was a non-starter there. `@libsql/client` supports both local-file (dev/tests) and remote-Turso (prod) through identical code.
6. **Found and fixed a critical `SameSite` cookie bug** (see "The big one" below) — this was the real cause of login/register never working in production, not the Turnstile widget everyone suspected.
7. **Weekly schedule page** (`#/schedule`) with an AniList fallback (Jikan's `/schedules` is just as flaky as everything else Jikan).
8. **Reviews & ratings** — users rate + review any anime; aggregate community score shown next to MAL's official score on detail pages.
9. **Turnstile bot-check on registration** — added, removed (while chasing the CSRF bug, wrongly suspected), re-added properly once the real bug was found and fixed.

## The big one: SameSite cookie bug (read this if anything auth-related seems broken again)

**Symptom**: registration/login always failed with "Invalid or missing CSRF token", no matter what.

**Root cause**: both the session cookie (`aninest_sid`) and CSRF cookie (`aninest_csrf`) used `SameSite=Lax`. `onrender.com` is a registered public suffix, so `aninest-frontend.onrender.com` and `aninest-backend.onrender.com` are genuinely different **sites** for cookie purposes (not just different origins). `SameSite=Lax` cookies are never sent on cross-site `fetch()` calls — only same-site requests or top-level navigations — and `credentials: 'include'` does not override that. Every request looked like a brand-new, cookie-less client to the server.

This silently broke **all session persistence**, not just the visible CSRF error — nobody could ever stay logged in on the deployed site, even before Turnstile existed.

**Fix**: `sameSite: isProd ? 'none' : 'lax'` (with `secure: isProd`, required for `None`) in both `backend/src/routes/auth.js` (`cookieOpts`) and `backend/src/middleware/csrf.js` (`ensureCsrfCookie`). Local dev keeps `Lax` since `localhost:5173`/`localhost:8787` differ only by port, which *is* same-site.

**How it was actually diagnosed** (useful pattern if something similar recurs): called `GET /api/auth/me` three times in a row from the browser and compared the returned CSRF token each time. If it's genuinely round-tripping, all three match; if the cookie never comes back, the server thinks each request is a new client and mints a fresh token every time. That's a fast, decisive test for "is a cookie actually being sent back" that doesn't require guessing.

**Verified fixed**: registered a fresh account, reloaded the page (session persisted), favorited an anime, reloaded again (favorite persisted). All via real browser interaction against the live deployed site, not just curl.

## Data migration note

The Turso migration (item 5 above) only changed the *code* to support Turso — it didn't copy existing data. The owner's real account (`mxximo`, 4 favorites) existed only in the local dev SQLite file and was **not** in the live Turso database until manually migrated (raw `INSERT` preserving original IDs, verified via a join query). If you're troubleshooting "missing data" again, check whether it's a similar local-vs-remote split before assuming corruption.

## Render gotchas hit this session (so you don't re-discover them)

- **Free tier can't attach a persistent disk at all.** Not a config bug — a hard platform rule. This is why the DB is on Turso, not local SQLite-on-disk.
- **`render.yaml` schema surprises**: it's `env: node` / `env: static`, not `runtime: node/static` (despite Render's own docs suggesting `runtime`). Custom headers are flat `{path, name, value}` entries (repeat one per header), not nested. Routes use `{type: rewrite, source, destination}` — no `path` field at all. All of this was verified against real, currently-deployed `render.yaml` files on GitHub after Render's own docs (fetched via WebFetch) turned out to describe a different/inaccurate shape.
- **Free-tier cold start**: an idle service spins down and takes 20-60s to wake on the next request; the first couple of parallel requests on wake can transiently 502 even though nothing is actually broken. Don't panic-debug a fresh 502 without first checking if it self-resolves in the next request.
- **Blueprint auto-sync**: pushing to `master` auto-deploys both services. Header/env config syncs can land faster than a full code rebuild — if you check a deploy log entry from Render's dashboard, confirm it's actually the *latest* one (Render keeps full history, and clicking an older entry shows its log even though newer commits have since deployed on top of it — this caused real confusion this session).

## Jikan reliability — this is a real, recurring problem, not a one-off

Jikan (the free MyAnimeList API this app uses as primary) returned 504 "MyAnimeList may be down/unavailable" **repeatedly throughout this entire session** — sometimes per-endpoint (e.g. `/top/anime` failing while `/seasons/now` succeeded seconds later), sometimes for extended stretches. This is because **Jikan is an unofficial scraper/proxy in front of MyAnimeList**, not a first-party API — it inherits every hiccup MAL's own infrastructure has, plus its own.

**What's already mitigated**: every list/detail endpoint has an AniList fallback (`backend/src/lib/animeSource.js` → `withFallback()`), so a Jikan outage degrades gracefully instead of breaking the page. This is working well and caught live during testing multiple times.

**What's NOT yet done, worth considering next**:

1. **Make AniList primary, Jikan secondary (or drop Jikan)** — AniList is a genuine first-party API (not a proxy to someone else's site), has a materially higher rate limit (~90/min vs Jikan's ~60/min shared globally), and has been rock-solid every time it's been hit this session, in contrast to Jikan. The tradeoff: AniList doesn't have MAL's curated "official streaming links" field, so the "Where to Watch" section would lose its best-case data (falls back to a Crunchyroll search link either way, so it's not a hard blocker — just a slight downgrade). This is probably the highest-value, lowest-effort fix available: **swap the primary/fallback order in `withFallback()` calls**, keep both, done in probably under an hour.

2. **MyAnimeList's own official API v2** (register a free client ID at myanimelist.net/apiconfig) — this is the "fix the actual root cause" option, since it talks to MAL directly with no scraper in between. Bigger lift: needs its own client module (similar shape to `anilist.js`), a new client ID to register, and MAL's official API has a different pagination/field shape than Jikan so `animeSource.js`'s normalization would need new mapping work. Worth doing eventually if Jikan's flakiness keeps being a problem after trying option 1, but don't start here — try the cheap swap first.

3. **Kitsu API** (kitsu.io/api/edge) — a third free option, JSON:API shaped, not evaluated this session at all. Lower priority than the two above; mentioned for completeness if both AniList and Jikan ever have a bad day simultaneously.

Recommendation for next session if this keeps being annoying: try #1 first (cheap, reversible, already 90% built), measure whether it actually reduces user-visible errors, and only invest in #2 if #1 isn't enough.

## What's tested vs. not

- `backend/test/api.test.js`: 22 integration tests, `npm test` in `backend/`. Covers auth lifecycle, CSRF (including the double-submit mechanics), favorites CRUD + the XSS-normalization fix, reviews CRUD + aggregate scoring + validation, rate limiting, input validation. Deliberately does **not** hit live Jikan/AniList (would make it flaky and burn shared rate-limit budget) — those routes are tested for input validation only.
- Frontend has no automated tests — every frontend verification this session was manual (real browser interaction via the browser tool, or temporary in-page mocks for UI-only checks like card rendering).
- Schedule feature's AniList fallback was verified once, directly, by forcing a Jikan failure and confirming real data came back — not covered by the automated suite (would need network access, same reasoning as other Jikan/AniList routes).

## Remaining roadmap (user-approved priority order, from an earlier discussion of "what would make this feel like a real community, not just a catalog")

Done: **#1 weekly schedule**, **#2 reviews & ratings**. Still open, in order:

3. **Public profile pages** (`#/u/username`) — favorites, reviews, join date. Natural next step since reviews now need somewhere to link back to (currently reviewer usernames in the reviews section aren't clickable). Needs: a new public (unauthenticated) `GET /api/users/:username` backend endpoint returning only non-sensitive fields (username, created_at, favorites, reviews — never email/password_hash), plus a new frontend page.
4. **Original games using existing data** (explicitly: no drawing/reproducing actual anime character art — that's a real copyright line, not a style preference). Ideas already discussed with the user: Higher/Lower on MAL score, guess-the-anime from a blurred synopsis/cover, a short recommendation quiz.
5. **Achievements/badges** — cheap gamification layer once reviews/favorites have enough data to badge against.

## Known TODOs / things a future session should double check

- **Turnstile keys**: re-added to code, but the user needs to re-enter `TURNSTILE_SECRET_KEY` (backend) and `VITE_TURNSTILE_SITE_KEY` (frontend) in Render's dashboard if they weren't retained from before removal — check whether registration currently shows the widget live before assuming it's configured.
- **CSP `connect-src`** uses a `*.onrender.com` wildcard for portability across Render redeploys — fine for now, but if a custom domain ever gets added, tighten it to the exact origin.
- **No email verification / password reset / 2FA** — explicitly out of scope (needs real email infrastructure), flagged repeatedly, not forgotten.
- **Rate limits are env-overridable** (`RATE_LIMIT`, `AUTH_RATE_LIMIT`) specifically so the test suite can raise them without touching production defaults — don't "fix" this by hardcoding, it's intentional.
- Any Turso/GitHub credentials shared in chat during this session should be treated as already-rotated-or-should-be — don't reuse a token pasted in an old conversation transcript as if it's still the live one without checking.

## Quick reference: running it locally

```bash
# backend (http://localhost:8787)
cd backend && npm install && cp .env.example .env && npm run dev

# frontend (http://localhost:5173), separate terminal
cd frontend && npm install && npm run dev

# tests
cd backend && npm test
```

See `README.md` for the full feature list and security writeup, `DEPLOY.md` for Render deployment steps.

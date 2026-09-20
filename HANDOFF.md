# AniNest — Session Handoff

Living document — read this first in a new session, then update it before your context runs out again. Last updated by a session that: swapped AniList to be the primary anime data source (Jikan is now the fallback, not the other way around), and shipped public profile pages.

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

## Anime data source: AniList is now primary, Jikan is the fallback

Previous sessions hit repeated Jikan 504s ("MyAnimeList may be down/unavailable") — Jikan is an unofficial scraper/proxy in front of MyAnimeList, not a first-party API, so it inherits every hiccup MAL's own infrastructure has, plus its own. This session **swapped the primary/fallback order** in `backend/src/lib/animeSource.js`'s `withFallback()` calls for `topAnime`, `schedule`, `seasonNow`, `search`, and `randomAnime`: AniList (first-party GraphQL API, ~90 req/min, no proxy in front of it) is now tried first, Jikan second. Verified working end-to-end (registered a test account, browsed lists, opened a detail page, favorited, reviewed — all served by AniList with no Jikan calls needed).

Two endpoints deliberately kept Jikan-first:
- **`genres()`** — lightweight, rarely fails, and the static fallback list is instant; not worth a network round-trip to AniList.
- **`fullById()`** (anime detail pages) — now tries **AniList first**, but falls back to **Jikan**, kept specifically because Jikan/MAL has fields AniList's schema doesn't: `rank`, `popularity`, `duration`, MAL's own content `rating`, and curated official "where to watch" streaming links. If AniList is up (the common case), detail pages lose those fields (they render as `—` / fall back to a Crunchyroll search link) — a known, accepted tradeoff for reliability, not a bug.

**Still open, worth considering next** if AniList+Jikan together ever aren't enough:
1. **MyAnimeList's own official API v2** (free client ID at myanimelist.net/apiconfig) — talks to MAL directly, no scraper in between. Needs its own client module (shape like `anilist.js`) and new pagination/field mapping in `animeSource.js`. Bigger lift than the swap above.
2. **Kitsu API** (kitsu.io/api/edge) — third free option, JSON:API shaped, not evaluated at all yet. Would slot in as a third fallback tier in `withFallback()`. Lower priority — only worth it if AniList+Jikan have simultaneous bad days often enough to matter.
3. **Wider "more APIs" ask from the user**: they've flagged wanting broader resilience across *all* the list/filter/schedule surfaces, not just a primary/fallback pair — worth scoping properly (which endpoints, how many tiers, is a 3-way fallback chain actually simpler or more fragile than 2-way) before building rather than bolting on more sources reactively.

## What's tested vs. not

- `backend/test/api.test.js`: 22 integration tests, `npm test` in `backend/`. Covers auth lifecycle, CSRF (including the double-submit mechanics), favorites CRUD + the XSS-normalization fix, reviews CRUD + aggregate scoring + validation, rate limiting, input validation. Deliberately does **not** hit live Jikan/AniList (would make it flaky and burn shared rate-limit budget) — those routes are tested for input validation only.
- Frontend has no automated tests — every frontend verification this session was manual (real browser interaction via the browser tool, or temporary in-page mocks for UI-only checks like card rendering).
- Schedule feature's AniList fallback was verified once, directly, by forcing a Jikan failure and confirming real data came back — not covered by the automated suite (would need network access, same reasoning as other Jikan/AniList routes).

## Remaining roadmap (user-approved priority order, from an earlier discussion of "what would make this feel like a real community, not just a catalog")

Done: **#1 weekly schedule**, **#2 reviews & ratings**, **#3 public profile pages**, **#4a Higher/Lower game**, **#4b Guess the Anime game**. Still open, in order:

4. **Original games using existing data**, being built one at a time (user explicitly asked not to rush these — best-effort UI, not just functional):
   - ✅ **Higher/Lower** — done. `#/games` (hub, `frontend/src/pages/games/hub.js`) and `#/games/higher-lower` (`higherLower.js`). Guess whether a "challenger" anime's score is higher/lower than the current "champion"; correct guesses chain the streak, wrong ends it. Best streak persisted in `localStorage` (`aninest_hl_best`) — no backend/account involvement, purely client-side. Anime pool comes from `frontend/src/lib/animePool.js`, which samples `topAnime` across pages `[1,4,8,12,16,20]` (not just page 1) specifically so the score range is wide enough for the game to be interesting rather than a near-coin-flip between two 9.0s — worth reusing this same pool helper for the next games rather than re-deriving one.
   - ✅ **Guess the Anime** — done. `#/games/guess-the-anime` (`guessTheAnime.js`). Blurred poster (CSS `filter: blur()`, unblurs on reveal) + a redacted synopsis snippet (strips the `(Source: ...)` citation and blacks out any literal occurrence of the answer's own title text) + 4 multiple-choice title buttons (1 correct + 3 distractors from the same pool, deduped by title so two options can't look identical). Same streak/best/localStorage pattern as Higher/Lower (`aninest_gta_best`), same pool helper, same "Game Over → Play Again / More Games" screen for consistency across games. `shuffle()` was factored out of `higherLower.js` into `frontend/src/lib/shuffle.js` since both games need it now — reuse that rather than re-inlining a Fisher-Yates.
   - ⬜ **Recommendation Quiz** — not started. Card exists on the hub already, marked "Coming soon".

Known limitation worth knowing about **Guess the Anime**: title redaction only blacks out the exact answer title string. Recap/compilation-film entries often have synopses that name the *parent series* instead (e.g. a "BOCCHI THE ROCK! Recap Part 1" synopsis says "Bocchi the Rock!"), which isn't redacted and makes those rounds nearly free. Not worth fixing unless it turns out to be a big fraction of rounds in practice — most pool entries don't have this issue.
5. **Achievements/badges** — cheap gamification layer once reviews/favorites have enough data to badge against.

### UI note: the header's logged-in user chip

Fixed this session — `.user-chip` (`frontend/src/style.css`) used `border: 2.5px solid var(--ink)`, and `--ink` (#16101f, near-black) is nearly invisible against the header's own dark background, so the chip looked like unbordered floating text. This is a trap worth remembering for *any* new UI on the header/dark hero areas: the app's whole "comic ink outline" look only works where the bordered element sits on a *lighter* panel than the outline color — on the dark header itself, use a bright accent border (this fix used `var(--purple)`, brightening to `var(--pink2)` on hover) instead of `var(--ink)`.

### #3 detail: public profile pages (done this session)

- Backend: `GET /api/users/:username` (`backend/src/routes/users.js`, mounted at `/api/users` in `app.js`) — public, unauthenticated, returns only `{ username, createdAt }` + that user's favorites + reviews. Never returns email/password_hash. 404s for a non-matching or malformed username (reuses the same `[a-zA-Z0-9_]{3,20}` shape the registration form enforces) rather than leaking existence via a different error.
- Frontend: `frontend/src/pages/profile.js`, routed at `#/u/:username` (`main.js`). Favorites render as a card grid (flat data from the `favorites` table — no fav-toggle button, this isn't the viewer's own list). Reviews are capped at 12 shown and each one is enriched with the anime's title/poster via `Api.fullById()` (the reviews table itself only stores `mal_id`, not a title) — fine at this size since `fullById` is already cached both server- and client-side; would need rethinking if a single user's review count ever got large.
- Reviewer usernames in the reviews section on anime detail pages (`details.js` → `reviewCardHTML`) are now links to `#/u/<username>`. The account page (`account.js`) also links to the signed-in user's own public profile.
- No privacy toggle exists — a registered user's favorites and reviews are always publicly visible under their username. That was an implicit simplification, not an explicit user decision — revisit if that's ever a concern.

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

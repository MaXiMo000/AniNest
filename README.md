# AniNest 🪺

Your anime home base — a comic-book styled site to discover trending, top-rated, and seasonal anime, search and filter, watch official trailers, and save favorites to an account.

```
AniNest/
  frontend/         Vite + vanilla JS SPA (the UI)
  backend/          Express API (auth, favorites, anime-data proxy/cache)
    src/app.js        Express app assembly (importable, for tests)
    src/server.js     Thin entrypoint: listen() + signal handling
    test/             Integration test suite (node:test)
  render.yaml       One-click deploy blueprint for Render
  DEPLOY.md         Deployment steps + what to double-check after deploying
```

## Testing

```bash
cd backend
npm test
```

37 integration tests against a real (ephemeral, temp-file) instance of the app — no mocking, no separate test framework, just Node's built-in `node:test` + `fetch`. Covers the auth lifecycle, CSRF enforcement, input validation, the favorites XSS-normalization fix, per-account isolation, rate limiting, reviews, the game leaderboard/score endpoints, the aggregate-recommendations endpoint, the AniList list-import endpoint, the screenshot-search endpoint, and achievement-badge computation. Deliberately does *not* hit the live Jikan/AniList/trace.moe/AnimeThemes APIs (would make the suite flaky and burn shared rate-limit/quota budget) — see the comment at the top of `backend/test/api.test.js`.

## Running it locally

Two processes, two terminals:

```bash
# Terminal 1 — backend (http://localhost:8787)
cd backend
npm install
cp .env.example .env   # then edit SESSION_SECRET
npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Open the frontend URL. The frontend talks to the backend via `VITE_API_URL` (`frontend/.env`, defaults to `http://localhost:8787`).

## Database

The backend talks to SQLite either way, via [`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts) — same SQL, same code, two modes:

- **Local file** (default): no config needed, lives at `backend/data/aninest.db`. Fine for local dev, or a host with a real persistent disk.
- **Remote [Turso](https://turso.tech)** (free, SQLite-compatible): set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` and local mode is ignored entirely. This is what production uses — **a free-tier Render web service can't attach a persistent disk at all** (confirmed the hard way: Render's own Blueprint validator rejects a `disk:` block on the free plan), so a local SQLite file would just evaporate on every restart. Turso sidesteps that without needing a paid Render plan.

## Features

- **Home** — hero spotlight, trending-now rail, this-season grid, all-time top-rated rail, genre tiles, "Feeling Lucky" random anime, and (signed in with 3+ favorites) a personalized "Recommended For You" rail aggregated from your favorites.
- **Browse** — search, filter by genre/type/status, sort, pagination.
- **Details** — synopsis, stats, genres, official YouTube trailer, recommendations, "Where to Watch" (official platforms only).
- **Accounts** — register/login, favorites saved server-side and synced across devices. Import an existing public AniList list by username from the account page, mapping AniList's watch statuses onto ours.
- **Public profiles** (`/u/username`) — a user's join date, favorites, reviews, and earned achievement badges, linked from their username anywhere it appears (reviews section, account page).
- **Achievements/badges** — earned automatically from existing activity (favorites, reviews, completed anime, Game Zone streaks, account age), shown on public profiles and the account page. No separate "unlock" step — a badge just reflects your current stats.
- **Game Zone** (`/games`) — four original, data-driven games (no reproduced anime character art — a real copyright line, not a style choice): a **Daily Challenge** (one shared mystery anime a day, same puzzle for every visitor, Wordle-style guesses with a shareable emoji-grid result), **Higher/Lower** (guess whether the next anime's score is higher or lower), **Guess the Anime** (blurred cover + redacted synopsis, multiple choice), and a **Taste Quiz** (five questions → a genre-matched recommendation). Higher/Lower and Guess the Anime streaks are saved to a **global leaderboard** when signed in (`/games/leaderboard/:game`); playing itself never requires an account, and per-browser bests still work via `localStorage` either way.
- **Watch status** — a lightweight tracker (Watching / Plan to Watch / Completed / Dropped) on top of favorites, with filter tabs on the Favorites page.
- **Characters & voice actors** on the details page, sourced from whichever data source served the page (AniList or Jikan). Studio and voice-actor names link to their own browse pages (`/studio/:name`, `/person/:name`) listing everything else they've worked on.
- **Continue browsing** — a "recently viewed" rail on Home, plus scroll-position restoration on the browser's Back/Forward buttons.
- **Compare mode** (`/compare`) — pick two anime and see score/episodes/members/genres side by side.
- **Min-score filter** on Browse.
- **Installable (PWA)** — "Add to Home Screen" support with an offline-capable app shell.
- **Airing-today ticker** on Home, using the same schedule data as the weekly schedule page.
- **Screenshot search** (`/screenshot-search`) — upload a frame from any anime and get candidate matches via [trace.moe](https://trace.moe), linking straight to that anime's detail page.
- **OP/ED jukebox** on the details page — play an anime's actual opening/ending themes via [AnimeThemes.moe](https://animethemes.moe).
- **Tier-list maker** (`/tier-list`) — drag your favorites into S/A/B/C/D/F and export the result as a PNG. Purely client-side.

## Why a backend at all?

Two reasons:

1. **Rate limits, solved structurally.** Both upstream APIs cap requests per minute, shared across everyone using them worldwide. If the browser called them directly, every visitor to the site burned through that budget individually. Now the backend is the only thing that ever calls out, caches every response for several minutes, and serves all visitors from that shared cache — so traffic no longer multiplies API calls 1:1 with visitors.
2. **Two data sources, so one bad day doesn't break the site.** `backend/src/lib/animeSource.js` tries [AniList](https://anilist.co)'s GraphQL API first — a genuine first-party API (not a scraper), with a materially higher limit (~90 req/min) and, in practice, the more reliable uptime of the two — and transparently falls back to [Jikan](https://jikan.moe) (the free MyAnimeList API, ~60 req/min shared globally) if AniList is slow or erroring. Anime detail pages (`fullById`) are the one exception worth knowing about: they still fall back *to* Jikan specifically because it has fields AniList's schema doesn't — MAL's own rank/popularity/duration/content-rating, and curated "where to watch" streaming links.

You can watch which source served a request in the backend's console logs (`[animeSource] AniList failed... falling back to Jikan`).

## Security

This was built with the assumption it might be exposed publicly, so:

**Backend**
- Passwords hashed with bcrypt (cost 12); never logged or returned in any response.
- Sessions are opaque random tokens in an **httpOnly** cookie (`aninest_sid`) — JavaScript can never read it, so it can't be stolen via XSS the way a `localStorage` JWT could. Only the token's **SHA-256 hash** is stored in the database, so a leaked DB dump can't be replayed as a live session.
- **CSRF**: double-submit cookie pattern — a separate, readable `aninest_csrf` cookie must be echoed back as an `x-csrf-token` header on every mutating request, compared with `crypto.timingSafeEqual` (not `===`, which leaks comparison timing).
- **Login** returns the same generic error for "no such account" and "wrong password" (prevents account enumeration), and always runs a bcrypt comparison either way so response timing doesn't leak which case it was.
- **Rate limiting**: 120 req/min per IP globally, 10 req/15min per IP on `/api/auth/*` (blunts brute-force and registration spam). Limits are env-overridable (`RATE_LIMIT`, `AUTH_RATE_LIMIT`) so the test suite can raise them without touching production defaults.
- **Input validation** via `zod` schemas on every write endpoint; every database query passes values as bound `args`, never string-concatenated into the SQL — no injection surface, whether the DB is a local file or the same client talking to Turso. The favorites `image` field is specifically re-parsed through `new URL()` and stored as its normalized `.toString()`, not the raw client input — closes a stored-XSS path where a URL can contain a raw `"` and still pass a naive `.url()` check.
- A logged-in user is capped at 500 favorites — a defensive limit against DB bloat from a scripted client, not a normal-use restriction.
- **CORS** locked to the configured frontend origin only, credentials explicitly enabled.
- Security headers via `helmet` (HSTS, X-Content-Type-Options, X-Frame-Options, etc.), request bodies capped at 10kb, generic error responses (no stack traces or internal messages ever reach a client).
- Favorites/account endpoints check `req.user.id` server-side on every request — there's no way to read or modify another account's data by guessing an ID.
- `unhandledRejection`/`uncaughtException` handlers and a `SIGTERM`/`SIGINT` graceful-shutdown path (closes the DB cleanly, finishes in-flight requests) — without these, an unexpected error crashes the process silently with no trace, and a PaaS redeploy can drop in-flight requests.

**Frontend**
- All dynamic content is HTML-escaped before being inserted into the page — including URLs going into `src`/`href`/`style` attributes, not just visible text (an early version of this app only escaped visible text, which left an attribute-breakout XSS gap via the favorites `image` field; fixed and covered by a regression test now).
- A baseline Content-Security-Policy is set via `<meta>` in `index.html`; the deployed version additionally sets it as a real HTTP response header (`render.yaml`), which is the only way to get `frame-ancestors` (clickjacking protection) — a `<meta>` CSP can't do that directive at all.
- No secrets, API keys, or tokens live in frontend code — the browser never talks to Jikan/AniList directly, only to our own backend.

**Verified, not just written** — `backend/test/api.test.js` (`npm test`) actually exercises SQL injection attempts, the XSS-via-image-URL path, CSRF bypass attempts, oversized/malformed payloads, and rate-limit enforcement, in addition to the normal auth/favorites flows.

**Logging**: structured JSON logs via `pino`/`pino-http` (one line per request: method, path, status, duration, request id), not scattered `console.log`. Frontend errors (`window.onerror`/`unhandledrejection`) are relayed to a public `POST /api/client-errors` and logged through the same stream, so a frontend bug shows up next to backend errors instead of only in a browser console nobody's watching. Render aggregates one service's stdout into one place already, which is what "centralized" means at this scale; a real alerting tool (Sentry, etc.) would need its own account and isn't wired up.

**What's deliberately not included** (would need real infrastructure/an external account to do properly — happy to add if you want them):
- Email verification / password reset (needs an SMTP or transactional-email provider).
- Two-factor auth.
- Account lockout after N failed logins (rate limiting covers the same threat at a smaller scale).
- A production-grade multi-instance session store (the current SQLite-backed store is perfect for one server; a horizontally-scaled deployment would want Redis instead — see DEPLOY.md).
- **Redis for the anime-data cache** — the current in-memory cache is genuinely fine for a single free-tier instance (nothing to be inconsistent with), but it does reset on every cold start/redeploy. Would help, but needs an external free Redis (e.g. Upstash) since Render's free tier has none.
- **Real error tracking/alerting** (Sentry or similar) — logs tell you an error happened if you go looking; they don't page anyone. Needs the user's own account + DSN.

## Ideas for later (UI & features)

Everything previously listed here has shipped, including achievements/badges. Nothing is currently queued.

## Data sources

[AniList](https://anilist.co) (primary) and [Jikan](https://jikan.moe) (fallback, and still primary for the fields AniList lacks on detail pages) — both free, keyless, third-party APIs. [trace.moe](https://trace.moe) (also free, keyless) powers screenshot search, with its own much smaller shared daily quota. [AnimeThemes.moe](https://animethemes.moe) (also free, keyless) powers the OP/ED jukebox. Trailers are official YouTube embeds. No episode/movie streaming is implemented — see the note in the app footer about why.

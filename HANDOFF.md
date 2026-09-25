# AniNest - Developer Handoff

Read this first when picking the project up. It describes the app **as it is now**; the history of why each
piece looks the way it does is in `git log` (every commit message explains its reasoning). Keep this file current
when you change something the next person would need to know.

Other docs: [README.md](README.md) (overview, features, security) and [DEPLOY.md](DEPLOY.md) (Render + Turso setup).

## At a glance

- **Live**: https://aninest-frontend.onrender.com (static site) and https://aninest-backend.onrender.com (API)
- **Repo**: https://github.com/MaXiMo000/AniNest. Pushing to `master` auto-deploys both services.
- **Stack**: Vite + vanilla JS SPA with hash routing | Express + `@libsql/client` (Turso in production, a local SQLite file in dev and tests)
- **Hosting**: Render. The backend is on the paid **Starter** plan (always on), the database on Turso.
- **Owner/admin account**: `mxximo`. It is a real account with real data, so be careful with it.

## Layout

```
frontend/src/
  main.js             route table, auth + nav wiring, notification polling
  lib/                API clients, stores, router, shared UI helpers (ui.js), free-watch player
  pages/              one module per route (pages/games/*, pages/admin/*)
backend/src/
  app.js              Express assembly (imported by the tests)
  server.js           listen(), graceful shutdown, background jobs (manga-chapter polling)
  lib/                upstream API clients and domain logic
  routes/             one router per area, each mounted flat under /api/<area>
  middleware/         session (attachUser / requireAuth / requireAdmin), csrf, rateLimits
backend/test/api.test.js   the integration suite
render.yaml         Render Blueprint for both services, including the production CSP header
```

**Frontend routes**: `/`, `/browse`, `/anime/:id`, `/franchise/:slug`, `/anime/:id/submit-watch-link`, `/favorites`, `/schedule`, `/compare`,
`/tier-list`, `/screenshot-search`, `/studio/:name`, `/person/:name`, `/u/:username`, `/account`, `/login`, `/register`,
`/manga`, `/manga/:id`, `/manga-favorites`, `/games` (+ `/daily`, `/manga-daily`, `/higher-lower`, `/guess-the-anime`,
`/quiz`, `/timeline`, `/name-that-opening`, `/emoji-plot`, `/cast-call`, `/studio-match`, `/source-guess`, `/stats`,
`/leaderboard/:game`), `/leaderboard/xp`, `/notifications`, `/admin/watch-sources`.

**API mounts** (`app.js`): `auth`, `favorites`, `anime`, `reviews`, `users`, `client-errors`, `games`, `recommendations`,
`studios`, `people`, `import`, `screenshot-search`, `manga`, `manga-favorites`, `manga-reviews`, `notifications`,
`leaderboard`, `anime-watch-sources`, `admin/watch-sources`, `franchises`, `calendar`, and `GET /api/health`.

**Tables** (`lib/db.js`; `CREATE TABLE IF NOT EXISTS` at boot, new columns added with `ensureColumn`, no migration tool):
`users`, `sessions`, `favorites`, `reviews`, `manga_favorites`, `manga_reviews`, `game_scores`, `game_runs`,
`game_score_log`, `daily_challenges`, `daily_results`, `manga_daily_challenges`, `manga_daily_results`, `anime_watch_sources`, `watch_source_candidates`, `notifications`,
`manga_chapter_state`, `api_cache`, `episode_log`, `franchises`, `franchise_entries`.

## Data sources and caching

| Source | Used for | Notes |
|---|---|---|
| AniList (GraphQL) | primary for anime lists, detail, search, characters | **30 requests/minute**. A 429 carries `Retry-After`. |
| Jikan (MyAnimeList) | fallback for everything above; also fills MAL-only fields (rank, duration, rating, streaming links) when it serves detail | slow and sometimes flaky |
| MangaDex | all manga metadata and covers | metadata only, `safe` rating only, behind Cloudflare (needs a browser User-Agent) |
| AnimeThemes.moe | OP/ED jukebox | third party with occasional full outages; also behind Cloudflare |
| trace.moe | screenshot search | small shared daily quota |
| YouTube Data API v3 | admin channel import and search | import costs about 1 unit per 50 videos, a search costs 100 (10,000/day free) |

Only the backend calls upstreams. Two caches sit in front of them:

1. `lib/cache.js`: in memory, per process, cleared on every deploy.
2. `lib/persistentCache.js`: the `api_cache` table. A fresh copy is served without calling the upstream. If the upstream
   **fails** (network error, 5xx, timeout, 429), the stored copy is served however old it is. A definitive 4xx is never
   hidden, so a manga later re-rated as adult stays rejected. Only bounded key spaces use it: anime detail, characters and
   recommendations (24h), top/season/schedule (6h), OP/ED lists (7d), manga detail (24h). Free-text search never does.
   **If you change the shape of a cached payload, bump its key** (`full:v2:`, `manga:full:v2:`) so old rows are ignored.

## Features: how they work

**Anime.** `lib/animeSource.js` `withFallback()` tries AniList, then Jikan, then the stored copy. Favorites carry a watch
status (watching / plan_to_watch / completed / dropped), capped at 500 per user. Reviews are 1-10 plus text, one per user per
title. Badges (`lib/badges.js`) are computed from counts; nothing is stored.

**Manga** (`routes/manga.js`, `lib/mangadex.js`). Search with a curated tag list, demographic, status and sort; detail; a
reading list with status (`manga_favorites`); reviews (`manga_reviews`). English titles are preferred: MangaDex's main title is
often a romanization, so the English alt title is used when there is one. Reading is a **link-out** to MANGA Plus, VIZ and
Webtoons search pages. There is no embedded reader, and the code must never call MangaDex's `/chapter` or `/at-home` endpoints.
Covers are **proxied** through `GET /api/manga/cover/:id/:file`: MangaDex replaces images requested with another site's
`Referer` with a "read it on mangadex.org" placeholder. localhost is not affected, so this only shows up in production. The route
only accepts a UUID plus a UUID-named file, caps the size, caches, and is exempt from the general rate limiter.

**Free official episodes** (`anime_watch_sources`, status `approved | pending | rejected | removed`). The anime page shows one
player, language tabs and episode ranges (`lib/freeWatch.js`; the grouping logic is the pure `lib/freeWatchGroups.js`). The
curated official channels (Muse Asia, Ani-One Asia, Crunchyroll, with ids verified live) are in `lib/youtube.js`.
- **Invariant**: text becomes a stored video id only through `parseYouTubeVideoId` (`lib/youtubeUrl.js`), and embeds are always
  rebuilt from the bare 11-character id on `youtube-nocookie.com`. Never store or embed a raw URL.
- Any signed-in user can suggest a link (`POST /api/anime-watch-sources`); it lands as `pending`. Links an admin adds are approved directly.
- **Admin page** (`#/admin/watch-sources`): bulk **Import** per channel, the **Needs your review** queue (`watch_source_candidates`,
  grouped by series and season so a whole show is assigned in one click), pending user submissions with a preview, and per-anime
  links with Remove / Remove all. A removed link is set to `removed`, so the next import looks at it again.
- **Import matching** (`lib/watchSourceMatcher.js`): `parseUploadTitle` pulls out series, season, episode and language, and rejects
  PVs, CMs, teasers, previews and vlogs. A series matches an AniList entry only on an **exact** title match (`looseKey` ignores
  "the" and spacing; later seasons accept only season-qualified titles). An earlier substring rule attached *Ascendance of a
  Bookworm* S3 to its side story, which is why matching is exact. Each group is looked up once, paced at 2.2s per call for AniList's
  limit. A 429 ends the pass, and the admin UI waits out `Retry-After` and continues. Unmatched groups go to the review queue.
- **By country** (`lib/watchSourceHealth.js`, `frontend/src/lib/country.js`): a daily job (first run 5 minutes after boot; only
  with `YOUTUBE_API_KEY`, never in tests) asks YouTube `videos.list` about up to 2000 approved or expired links, oldest-checked
  first (1 quota unit per 50). It stores YouTube's `regionRestriction` lists in `allowed_regions` / `blocked_regions` and sets
  status `expired` for deleted, private or non-embeddable videos (`approved` again if they come back). A run where every video
  looks dead is refused as an API glitch. The detail page guesses the viewer's country from the time zone (then the language),
  lets them change it (localStorage), and shows only uploads that play there. Unchecked links count as playable.
- **Admin role**: `users.is_admin`, set from `ADMIN_USERNAMES` on **every boot**. The account must exist first; otherwise register
  and restart. `requireAdmin` answers non-admins with **404**, and the admin page shows the normal not-found page, so neither
  reveals that it exists.

**OP/ED jukebox**: `GET /api/anime/:id/themes` returns `{ data, source }`. It loads *after* the rest of the page, so a dead host
can't block the page. Two layers: AnimeThemes.moe (creditless videos, list persisted 7d), then MyAnimeList's song list via Jikan
(`lib/themeSongs.js` parses strings like `1: "Again" by YUI (eps 1-14)`, persisted 30d) when AnimeThemes fails or has nothing
for the show. After an AnimeThemes failure it is skipped for 5 minutes, so pages don't each wait out its 8s timeout. With only
the song list, the page shows each song with YouTube Music and Spotify **search links** (no key, no embed, official releases).
A cached video list can outlive AnimeThemes' video host, so the `<video>` error event reveals the same links. If both sources
fail, the page says "temporarily unavailable" with a retry, which is worded differently from "this anime has none".
There is no free replacement for the videos themselves: AnimeThemes is the only keyless source of creditless OP/ED video by MAL id.

**XP and levels** (`lib/xp.js` is pure; `lib/xpStats.js` is the one DB loader, shared by the profile and the leaderboard). XP is
derived from existing data and never stored, so it applies retroactively and can't be farmed by toggling favorites.
`level = floor(sqrt(xp / 50)) + 1`. Sources and caps are in `XP_RULES`. Links count only when someone *else* approved them
(`submitted_by != reviewed_by`), so admin imports earn nothing. The leaderboard is `GET /api/leaderboard/xp`, cached for 2 minutes.
Episode progress isn't an XP source yet (it would be trivially farmable).

**Episode progress** (`POST /api/favorites/:malId/progress`). Stored on the favorites row (`episodes_watched`,
with the length in the `episodes` column the profile dashboard also uses), so only titles already in the list have progress; the frontend adds a title as Watching first. Starting a
show marks it Watching, reaching the total marks it Completed, stepping back off the end reopens it. Forward steps of up to 30
episodes are also written to `episode_log`, one row per episode with a timestamp: that is the time series for Wrapped,
drop-point stats and "hours watched". Bigger jumps are catch-ups and are not logged. See ROADMAP.md for what builds on it.

**Franchise watch guides** (`lib/franchise.js` is pure; `lib/franchiseStore.js` stores and builds; `#/franchise/:slug`).
`GET /api/anime/:id/franchise` powers a "Part of the X franchise" banner on detail pages, loaded after the page. The first
request for any member walks AniList's typed relations breadth-first (one batched request per layer, 50 ids each, capped at 12
requests / 80 entries, paced 2.2s, one build at a time). It follows sequel, prequel, parent, side story, spin-off, summary,
alternative and compilation links; it ignores CHARACTER (crossover cameos), OTHER, SOURCE/ADAPTATION, adult entries, music videos
and PV/CM specials. Default tiers: main-format entries (TV, movie, ONA) on a sequel chain are **essential**, a chain reached as a
spin-off or side story is **optional** as a whole (all of Prisma Illya's seasons), recaps and compilation movies are **skip**, and
alternative retellings are flagged. Ordered by release date, undated last. A build over 20s answers `{ pending: true }` and the
page asks again once. Stand-alone shows are remembered for 7 days (`franchise-miss:` rows in `api_cache`) so they aren't re-walked.
Guides older than 7 days are served and rebuilt in the background; the franchise **id and slug stay stable** across rebuilds
because community orders (ROADMAP Phase 7) will reference them. `GET /api/franchises/:slug` never triggers a build.
Mega-franchises (Gundam) hit the cap, and the page says so.

**Airing calendar** (`lib/calendar.js`, `lib/ics.js`; account page). `GET /api/calendar/link` (auth) returns a private
`/api/calendar/<token>.ics` URL; `POST /api/calendar/link/rotate` replaces it. The feed needs no cookie (calendar apps send
none), so the 32-character token in `users.calendar_token` is the credential. It is stored as-is so the link can be shown
again; it only exposes the Watching list, which the public profile shows anyway. Episodes from 7 days back to 14 days ahead
come from AniList `airingSchedules` (MAL ids resolve to AniList ids first; finished shows are skipped), cached 1h per token.
Times are the Japanese broadcast, not a streaming site's release.

**Games** (`pages/games/*`). Every game is listed once in `frontend/src/lib/gameCatalog.js` (hub, leaderboard picker,
stats page) and every ranked slug once in `backend/src/lib/games.js` (`GAME_RULES`: time floor per round, optional score cap).
Adding a game means one entry in each plus its page. Shared frontend pieces:
- `lib/gameKit.js`: server run, local per-game stats (`aninest_game_stats_v1`), game-over screen, challenge links.
- `lib/gameFx.js`: synthesized sounds (Web Audio, no files), haptics, POW popups, confetti, shake, count-up. One sound toggle;
  everything respects `prefers-reduced-motion`. Pure decoration: no game logic may depend on it.
- `lib/rng.js`: seeded shuffles. A `?seed=` challenge link sorts the pool by id and deals the same deck.
- `lib/recentlySeen.js`: per-game memory (localStorage) of recently shown answers. New runs deal unseen items first; the
  memory covers half the pool so small pools still rotate. Challenge runs ignore it. Within a run nothing repeats until
  the pool is used up.
- `lib/choiceGame.js`: the engine behind Studio Match, Source Material, Emoji Plot, Cast Call and Name That Opening. A game
  only supplies `buildRound()`; returning `null` skips a round (e.g. no openings on AnimeThemes).

Streaks feed leaderboards, badges and XP, so score submission is guarded (`routes/games.js`). The player starts a **single-use
run** with `POST /:game/start`. `POST /:game/score` is accepted only for that run and only once; the run is claimed atomically
*before* the checks run. The score has to fit the elapsed time (`minMsPerRound` per game, set just under each client's reveal
delay; hard cap 300, and 80 for the 60-second Blitz). That stops instant fakes and replays. A bot that actually waits would still
get through, because the games run in the browser. Accepted scores are also written to `game_score_log`, which powers
`?period=week` leaderboards and `GET /api/games/me/stats`. Easy mode in Guess the Anime and the Taste Quiz post nothing.

The two dailies record one result per player per date, for today or yesterday only (`POST /api/games/daily/result`,
`POST /api/games/manga-daily/result`). The manga daily stores its 12 wrong answers with the puzzle so everyone sees the same
rounds. Both dailies skip recent answers (`lib/dailyPick.js`): no repeat within ~80% of the pool size in days, capped at a year. Badges (`lib/badges.js`) now include daily wins, games variety and a mastery badge per game (20+); the profile's badges
come out of `computeXp()` so they can't disagree with XP.

**Themes**: dark by default; `data-theme="light"` on `<html>` switches CSS tokens (`style.css` top). `public/theme-init.js`
applies a saved choice before first paint (the CSP forbids inline scripts). Accent colors used as text go through
`--text-yellow`/`--text-blue`/`--text-pink2`/`--text-green` so the light theme can darken them; surfaces over cover art
(`.hero`, `.tv-frame`, `.guess-poster-frame`) stay dark in both themes.

**Profile dashboard**: favorites store `genres` (JSON array) and `episodes`. A save that omits them keeps the stored values
(`COALESCE` in the upsert), so older favorites fill in when re-saved.

**Notifications** (`lib/notifications.js`, `lib/mangaUpdates.js`): a header bell plus `#/notifications`. You follow a title when
it's in your favorites and not marked completed or dropped. For anime, a notification is created whenever free episodes go live
(import, review-queue assignment, approved submission, admin add). For manga, a background job in `server.js` runs every 6h
(first run 2 minutes after boot; off in tests or with `MANGA_POLL=off`) and compares MangaDex's `latestUploadedChapter` id for each
followed manga. The first time a manga is seen only records a baseline. Each user gets one unread notification per title, and its
count grows. Notification failures are logged and never break the action that triggered them.

**Also in the app**: recommendations built from your favorites, studio and voice-actor pages, AniList list import, screenshot
search (trace.moe), a client-side tier-list maker, compare mode, the weekly schedule, PWA install, a recently viewed rail, and an
optional Turnstile check on registration.

## Configuration

Backend (`backend/.env.example` locally; the Render dashboard in production, where `sync: false` values are prompted for):

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV` | basics |
| `FRONTEND_ORIGIN` | the only origin CORS allows (comma-separated for more than one) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | production database. Unset means a local file at `backend/data/aninest.db` (or `DB_PATH`) |
| `ADMIN_USERNAMES` | comma-separated usernames promoted to admin at boot |
| `YOUTUBE_API_KEY` | optional; enables admin import and search. Without it, admins can still paste links and users can still submit them |
| `TURNSTILE_SECRET_KEY` | optional bot check on registration (the frontend needs `VITE_TURNSTILE_SITE_KEY` too) |
| `RATE_LIMIT`, `AUTH_RATE_LIMIT` | limiter ceilings (defaults: 120/min per IP, 10 per 15 min on auth). The tests raise them |
| `MANGA_POLL` | `off` disables the manga-chapter job |
| `LOG_LEVEL` | pino log level |

Frontend (baked in at build time, so changing one needs a rebuild): `VITE_API_URL`, `VITE_TURNSTILE_SITE_KEY`.

Sessions are random 256-bit tokens in an httpOnly cookie, stored only as SHA-256 hashes. No secret is involved, so there is no
`SESSION_SECRET`. To log everyone out, clear the `sessions` table.

## Conventions and invariants

- Every write route validates input with `zod`, and every SQL value is a bound argument. Auth is `attachUser` (global) plus
  `requireAuth` or `requireAdmin` per router. User-scoped queries always include `user_id` in the `WHERE`. Mutating requests need the
  CSRF double-submit header `x-csrf-token`.
- Escape every dynamic value that goes into HTML (`escapeHtml`), attributes included. URLs from users are re-parsed with `new URL()`.
- **The CSP is defined twice** and browsers enforce the stricter of the two: the `<meta>` tag in `frontend/index.html` and the real
  header in `render.yaml`. A new image, media or frame origin must go into **both**. (`img-src` includes the backend origin for the
  cover proxy; `frame-src` includes YouTube.)
- Manga stays `safe`-rated. Never add MangaDex chapter or at-home calls. Never store or embed an unvalidated URL.
- Routers are mounted flat (`/api/favorites`, `/api/manga-favorites`, ...), so each file is one auth boundary. Mount a specific path
  before a `/:param` router that could swallow it; that's why `/api/leaderboard` is not under `/api/users`.
- A new third-party integration gets a small `lib/` client and a route, runs only on the backend, and is cached (`persistentCached`
  for bounded keys).
- Pages set `document.title` while rendering; the router resets it to the default first.
- The frontend `ApiError` carries extra JSON fields from error responses (`err.quotaExceeded`, `err.notConfigured`, ...).

## Gotchas that cost real time

- **Cross-site cookies**: the frontend and backend are different sites (`onrender.com` is a public suffix), so production cookies must be
  `SameSite=None; Secure`. Dev uses Lax. With Lax in production, no cookie ever comes back and every request looks logged out.
- **Blueprint plan drift**: `render.yaml` must say `plan: starter` to match the dashboard. While it said `free`, every sync tried to
  downgrade the service and failed.
- **Render Blueprint schema**: `env: node` / `env: static`, flat `headers` entries, and `routes` as `{type, source, destination}`.
- **MangaDex Referer trap** and the **Cloudflare User-Agent** requirement (MangaDex, AnimeThemes), both described above.
- **AniList allows 30 requests a minute**. Pacing imports for 80/min made every pass stall.
- The dev browser isn't logged in to production, and credentials must never be typed on the owner's behalf. Admin actions in
  production are done by the owner.
- **Shell escaping**: the bash tool collapses doubled backslashes, which silently corrupted regexes written through heredocs or
  `python -c` (a `\b` became a backspace byte). Write source with the Write/Edit tools, and scan for control characters after any scripted edit.
- `main.js` renders a loading state *before* awaiting auth, because pages read `Auth.get().user` synchronously on their first render.
- All tests share one database, so pick an unused `mal_id` range for new tests. Taken: 20000-74999, 82000-82899, 83000-83099, 90000-90899, 91000-91899, 92000-92999.

## Testing

`cd backend && npm test` runs 102 integration tests (`node:test` + `fetch`) against a real, temporary database, with no mocks.
Helpers: `makeAgent()` (cookie jar + CSRF), `uniqueUser()`, `makeAdminAgent()` (sets `is_admin` directly, since the
`ADMIN_USERNAMES` bootstrap runs before any test user exists) and `playScore()` (starts a game run and backdates it).

Live upstreams (AniList, Jikan, MangaDex, trace.moe, AnimeThemes, YouTube) are deliberately **not** called. The tests cover input
validation, auth and gating, and the pure logic around them: title parsing, series matching, XP, episode grouping, the persistent
cache, and the manga poll with an injected fake. `freeWatchGroups.js` is still tested from the backend suite.

Frontend: `npm test` runs Vitest (jsdom) on the pure game logic in `frontend/test/`. `npm run test:e2e` runs Playwright in
`frontend/e2e/`: the real app on the Vite dev server, with every API call answered by `e2e/mockApi.js` (a 60-anime fixture pool,
dailies, themes, characters, a profile). It plays every game to game over and checks the signed-in score post. `screens.spec.js`
only takes screenshots when `SCREENSHOTS=1` (with `SHOTS=/path,/path`), for eyeballing layouts.

## Known limitations and possible next steps

- Ani-One's Chinese-titled shows can't be matched automatically. They land in the review queue and are labelled "Chinese subs".
  Episode numbers follow the channel, not MAL (e.g. *Attack on Titan Final Season* is one 35-episode run, and *Jujutsu Kaisen* S2
  is numbered 25-47).
- Game results come from the browser. They're time-checked but not authoritative. Making them authoritative means the server picks
  each question and checks each answer, and the Daily stops sending its answer to the browser. That's a larger rewrite.
- Not built, because each needs an outside service: email (verification, password reset, notification emails), 2FA, Redis,
  external error tracking.
- Ideas: a warm-up job that pre-fills `api_cache` for popular titles, notification preferences, server-picked game rounds.

## Quick start

```bash
cd backend && npm install && cp .env.example .env && npm run dev    # http://localhost:8787
cd frontend && npm install && npm run dev                            # http://localhost:5173
cd backend && npm test
```

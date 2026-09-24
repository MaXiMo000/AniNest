# AniNest 🪺

A comic-book styled home base for anime **and** manga fans. Discover and track what you watch and read, write reviews,
watch official free episodes from licensed YouTube channels, level up through XP, play anime games, and get notified
when something you follow has new episodes or chapters.

**Live:** https://aninest-frontend.onrender.com

Full stack with no framework on either side: a Vite + vanilla JS single-page app and an Express API on SQLite (Turso).

## Features

**Anime**
- **Home**: spotlight hero, airing-today ticker, trending, this season, all-time top, genre tiles, "Feeling Lucky", recently viewed,
  and personal recommendations built from your favorites.
- **Browse and search** with genre, type, status, minimum score and sort filters, plus a weekly airing **schedule**.
- **Detail pages**: synopsis, stats, trailer, characters and voice actors, studio and voice-actor pages, "where to watch" links
  (official platforms only), similar titles, community reviews, and an **OP/ED jukebox**.
- **Watch free (official)**: episodes uploaded by licensed channels (Muse Asia, Ani-One Asia, Crunchyroll) play in one embedded
  player with language tabs and episode ranges. Anyone signed in can suggest a link, and an admin reviews it.
- **Favorites with watch status** (Watching / Plan to Watch / Completed / Dropped), **compare mode**, a **tier-list maker** with
  PNG export, **screenshot search** (find an anime from a single frame), and **AniList list import**.

**Manga**
- Browse by tag, demographic and status, sorted by popularity, latest update, newest or A-Z.
- Detail pages, a reading list with status, and reviews. "Read" links go to official sources (MANGA Plus, VIZ, Webtoons);
  AniNest never hosts or embeds chapters.

**Community and gamification**
- Accounts, public profiles (`#/u/<username>`) and achievement badges (including daily-win, game-variety and per-game
  mastery badges).
- **XP and levels** earned from your activity (favorites, reviews, completions, game streaks, daily challenges, approved
  links), with a global **XP leaderboard**.
- **Game Zone**: 11 games with 13 leaderboards (all-time and weekly), sound effects, comic animations and "challenge a friend"
  links that replay the same deck:
  - **Daily Challenge** and **Manga Daily**: one shared mystery per day, Wordle-style, with win streaks, a guess distribution
    and a 5-week calendar.
  - **Guess the Anime**: Easy / Normal / Hard, three lives, clues you buy (synopsis, genres, year and studio, a clearer cover),
    multiple choice or typed answers, and a 60-second **Blitz**.
  - **Higher or Lower** by score, popularity, episode count or release year, with a combo multiplier.
  - **Name That Opening** (12-second clips from AnimeThemes), **Timeline** (sort by release year), **Emoji Plot**,
    **Cast Call** (main cast and voice actors), **Studio Match** and **Source Material**.
  - **Taste Quiz**: 8 questions drawn from 33, a taste persona and three picks with reasons.
  - **My Game Stats** (`#/games/stats`): plays, bests, averages, weekly bests, ranks and recent-run sparklines.
- **Profile taste dashboard**: completion rate, estimated time watched, watch status and top genres.
- **Light and dark themes** (toggle in the header).
- **Notifications**: a header bell for new free episodes of anime you follow and new chapters of manga you're reading.

**Admin**: a curation page that bulk-imports a channel's episodes through the YouTube Data API, matches them to the right
anime and season, and puts anything uncertain in a review queue.

Also: installable as a PWA, works on phones, and the site stays up when an upstream API is down (see below).

## Tech stack

| | |
|---|---|
| Frontend | Vite, vanilla JS modules, hash router, hand-written CSS, `vite-plugin-pwa` |
| Backend | Node 22+, Express, `zod`, `helmet`, `express-rate-limit`, `bcryptjs`, `pino` |
| Database | SQLite through `@libsql/client`: a local file in development, [Turso](https://turso.tech) in production |
| Data | [AniList](https://anilist.co), [Jikan](https://jikan.moe), [MangaDex](https://mangadex.org), [AnimeThemes](https://animethemes.moe), [trace.moe](https://trace.moe), YouTube Data API |
| Hosting | [Render](https://render.com) Blueprint (`render.yaml`): a static site plus a web service |

## Project structure

```
AniNest/
  frontend/          Vite SPA (src/main.js, src/lib, src/pages)
  backend/           Express API (src/app.js, src/server.js, src/lib, src/routes, src/middleware)
    test/            integration test suite (node:test)
  render.yaml        Render Blueprint for both services
  HANDOFF.md         architecture, invariants and gotchas for developers
  DEPLOY.md          deployment guide
```

## Running locally

Requires Node 22.13 or newer. Use two terminals:

```bash
# Backend: http://localhost:8787
cd backend
npm install
cp .env.example .env
npm run dev
```

```bash
# Frontend: http://localhost:5173
cd frontend
npm install
npm run dev
```

With no database settings, the backend creates a SQLite file at `backend/data/aninest.db`. The frontend reaches the API through
`VITE_API_URL` (`frontend/.env`, default `http://localhost:8787`). Everything is optional beyond that. To use the admin page, add your
username to `ADMIN_USERNAMES` after registering and restart the backend. Set `YOUTUBE_API_KEY` to enable channel imports.
`backend/.env.example` documents every variable.

## Testing

```bash
cd backend && npm test          # API integration tests
cd frontend && npm test         # frontend unit tests (Vitest)
cd frontend && npm run test:e2e # browser smoke tests (Playwright)
```

The frontend unit tests cover the games' pure logic (answer matching, seeded decks, quiz scoring, streak and stats maths).
The browser tests play every game in Chromium against a mocked API (`frontend/e2e/mockApi.js`), so they need no backend. Run
`npx playwright install chromium` once first.

93 backend integration tests run against a real, temporary database, using only Node's built-in `node:test` and `fetch`. They cover the
auth lifecycle, CSRF, validation, SQL-injection and XSS attempts, rate limits, per-account isolation, favorites, reviews, manga,
free-episode submission and review, the import title parser and matcher, admin gating, XP, game-run checks, notifications and the
persistent cache. Live third-party APIs are deliberately not called, so the suite stays deterministic and doesn't use up shared quotas.

## How the data layer stays reliable

The browser only talks to AniNest's own API, and only the backend calls third-party services:

- **Fallbacks**: anime data comes from AniList first, and Jikan (MyAnimeList) takes over when AniList fails.
- **Two caches**: an in-memory cache absorbs repeat traffic. A database-backed cache keeps the last good copy of detail pages,
  rankings, schedules and theme lists. When an upstream is down, visitors get that copy instead of an error page.
- **Rate-limit aware**: bulk imports are paced to AniList's 30 requests a minute and pause on `429 Retry-After`.
- **Degrades per section**: if the OP/ED service is down, only the jukebox shows "temporarily unavailable" and the rest of the page loads.

## Security

- Passwords are hashed with bcrypt (cost 12) and are never logged or returned.
- Sessions are random 256-bit tokens in an **httpOnly** cookie (`Secure` in production). The database stores only their SHA-256 hash.
- **CSRF**: a double-submit token in the `x-csrf-token` header on every mutating request, compared in constant time.
- Login returns the same error, with the same timing, for an unknown account and a wrong password.
- Rate limits: 120 requests/min per IP, and 10 per 15 minutes on auth routes.
- Every write is validated with `zod`, and every SQL value is a bound parameter.
- CORS allows only the frontend's origin. `helmet` sets security headers, request bodies are size-capped, and errors are generic.
- Every user-owned row is checked against the signed-in user. Admin routes answer non-admins with 404.
- **Untrusted links**: a submitted YouTube link is reduced to its 11-character video id, and embeds are rebuilt from that id on
  `youtube-nocookie.com`. No raw URL is ever stored or embedded.
- Manga is limited to MangaDex's `safe` rating, including lookups by direct id. Covers go through an allowlisted, size-capped proxy.
- The frontend escapes every dynamic value, attributes included. A strict Content-Security-Policy ships as a real HTTP header (with
  `frame-ancestors`) and as a `<meta>` tag.
- Game scores need a single-use run that was started on the server, and must fit the time actually played.
- Structured JSON logs (`pino`), with frontend errors relayed to the backend log.

Not included, because each needs an external service: email verification and password reset, 2FA, and an error-tracking service.

## Deployment

See [DEPLOY.md](DEPLOY.md). In short: create a Turso database, then create a Render Blueprint from this repo and fill in the prompted variables.

## Content and credits

AniNest links to and embeds only official sources: trailers and free episodes from official, licensed YouTube channels,
and "where to watch/read" links to licensed platforms. Anime data comes from AniList and MyAnimeList (via Jikan), manga data from
MangaDex, themes from AnimeThemes and scene search from trace.moe. The games are built from that same data and reproduce no character art.

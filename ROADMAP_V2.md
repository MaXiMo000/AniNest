# AniNest - Roadmap V2 (status)

V1 (see [HANDOFF.md](HANDOFF.md)) was finished first; V2 folded the "otaku-os" idea into AniNest instead of a
separate app. The order the owner chose was **manga -> free anime -> gamification**. All three have shipped.
Implementation detail, gotchas and config live in the "V2" section at the top of `HANDOFF.md`.

## Shipped

| # | Item | Notes |
|---|---|---|
| 3 | **Manga, free and legal** | Browse/search/detail, reading list with status, "Read for free" link-outs to official sources. Metadata from MangaDex (safe content only), covers proxied server-side. No embedded reader by design. |
| 2 | **Watchable anime, free and legal** | Curated official YouTube channels (Muse Asia, Ani-One Asia, Crunchyroll). Admin bulk import + review queue, user-suggested links with approval, strict YouTube-id validation. |
| 4 | **Unified XP profile** | Derived (not stored) XP -> level, XP bar + breakdown on profiles, XP leaderboard, daily challenge now recorded server-side. |
| 1 | V1 carry-over (badges, recommendations, studio/VA pages, list import, screenshot search, OP/ED jukebox, tier lists) | Done before V2 started. |

## Decided against (and why)
- **Embedded manga reader / anything scraped** - would need unlicensed sources; same line the project holds for anime.
- **Tracking "watched an episode" / "read a chapter" for XP** - YouTube iframes and link-outs give no honest signal.
  Marking something *completed* is the signal we do have, and it already earns XP.
- **A different stack (FastAPI/Next.js/Postgres/Redis)** - the existing Express + Turso stack scaled fine for all of the above.
  Redis is still only worth it for cross-restart caching; that needs an external service only the owner can create.

## Candidate next steps (none started; pick with the owner)
- **Season/part grouping in the free-watch episode list** (e.g. Attack on Titan's 35-episode run).
- **Manga reviews** (`manga_reviews`, a near copy of `reviews`) - reserved but not built.
- **Notifications** for new episodes/chapters of favorited titles.
- **Server-side validation of game results** to harden the XP/leaderboard trust model (currently client-reported, capped).
- **Frontend tests** - none exist; the largest untested surface in the app.

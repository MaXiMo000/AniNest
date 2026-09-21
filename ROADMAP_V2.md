# AniNest — Roadmap V2 (future vision, not started)

> **Status: NOT STARTED.** This is a planning document only — no code here yet.
> Do the remaining **V1 roadmap** items in [HANDOFF.md](HANDOFF.md#remaining-roadmap-user-approved-priority-order-from-an-earlier-discussion-of-what-would-make-this-feel-like-a-real-community-not-just-a-catalog) first. Begin work on anything below only after the user explicitly says go.

## Why this document exists

A separate "otaku-os" project was floated in another session — anime *and* manga, real watchable/readable content instead of just trailers, deeper gamification. Rather than fork into a second app, the decision was to fold that vision into AniNest as a V2 phase, planned now and built later. This doc is the consolidated target: everything left on the current roadmap, plus the new scope, in one place.

---

## 1. Carried forward from V1 (finish these first)

Full detail for each lives in [HANDOFF.md](HANDOFF.md) — this is just the checklist, kept in sync here so V2 has one complete picture.

- [ ] **Achievements/badges** — gamification layer once reviews/favorites have enough data to badge against.
- [ ] **Aggregate recommendations** — "Because you favorited X, Y, Z..." across a user's whole favorites list.
- [ ] **Studio/voice-actor browse pages** — browse by studio or seiyuu using character/VA data already fetched.
- [ ] **Import an existing MAL/AniList list** — bulk onboarding from a MAL XML export or AniList username.
- [ ] **Screenshot search via trace.moe** — identify an anime from an uploaded screenshot.
- [ ] **Opening/ending song jukebox** via AnimeThemes.moe.
- [ ] **Tier-list maker** for favorited anime/characters, shareable as an image export.

*(Note: recommendations work may already be in progress in a parallel session — check `backend/src/routes/recommendations.js` / `frontend/src/lib/recommendationsApi.js` before starting item 2 above.)*

---

## 2. New: actually watchable anime, not just trailers

Current stance (from HANDOFF.md): "No streaming of actual episodes/movies (would require piracy-scraper APIs — declined on copyright grounds)." That stance doesn't change — this is about **official, legally-embeddable free content**, not scraping pirate sources.

**Approach**: a curated allowlist of officially-licensed free sources, mapped per-title, embedded via each platform's own official embed/iframe — never scraped.

Candidate sources to evaluate:
- **Muse Asia** (official licensed YouTube channel, SEA region) — full free episodes for a large simulcast catalog, ad-supported.
- **Ani-One Asia** — same model as Muse Asia, different licensor slate (Aniplex titles).
- **Crunchyroll's official YouTube uploads** — some titles have free full episodes posted directly by Crunchyroll, separate from their paid app.
- **Official licensor channels on a per-title basis** (e.g. a studio or Western licensor's own YouTube channel).

Design notes for later:
- Needs a mapping table: `anime_id -> [{ platform, youtube_video_id or playlist_id, region_note }]`, curated manually or via a moderated user-submission queue — not auto-scraped, since matching MAL/AniList IDs to the right official upload reliably needs a human check.
- Region/licensing varies a lot (Muse Asia and Ani-One are geo-restricted in parts of the world) — the UI needs to be honest about "may not be available in your region" rather than promising playback everywhere.
- Detail page gets a clear split: "Trailer" (existing) vs "Watch free (official)" (new) — never blur the two together.
- YouTube embeds only use the official `iframe` embed API respecting each channel's own embed permissions (some official uploads disable embedding — handle that gracefully, link out instead).

## 3. New: readable manga, free and legal

Same allowlist philosophy as above, applied to manga:
- **MANGA Plus by Shueisha** — official, free simulpub chapters (first/last few chapters of many series, ongoing chapters for active simulpubs), has a usable public-ish API already relied on by other legitimate readers.
- **VIZ** — free chapters for select series (mostly Shonen Jump titles), US-focused.
- **Webtoons / Tapas** — free-to-read webtoon-format series, relevant if scope widens beyond traditional manga.
- **Comikey / INKR** — smaller free-chapter catalogs, lower priority, evaluate later.

Design notes for later:
- Same per-title mapping-table approach as anime, same "may not have your title / may be region-locked" honesty requirement.
- Reader UI is new surface area (page-by-page or webtoon-scroll viewer) — bigger lift than embedding a video, worth its own spike before committing to a design.

## 4. New: unified gamification — XP profile

Pulled from the otaku-os plan. Right now AniNest's gamification is scattered: three games with local/leaderboard streaks, a daily challenge, and a not-yet-built achievements system. V2 unifies these into one account-level progression system:
- A single **XP** total per account, earned from: game streaks, daily challenge results, reviews written, favorites curated, badges unlocked.
- **Levels** derived from XP (simple curve, e.g. level = f(XP)), shown on the public profile page next to existing stats.
- **Achievements/badges** (item 1 above) become XP-granting events instead of a standalone system, so the two features reinforce each other instead of shipping in parallel.
- Leaderboards gain an optional "by XP/level" view alongside the existing per-game streak boards.

## 5. Other improvements (bucket — needs refinement before scoping)

Flagged as "other, better ones" without specifics yet. Placeholder list to revisit and sharpen with the user before this phase starts — not a commitment to any of these as stated:
- Better search/filtering across the growing content surface (anime + manga + games in one search).
- Notification/reminder system (new episode/chapter alerts for favorited titles with a free source mapped).
- Further PWA/mobile polish once the app's surface area roughly doubles.

## 6. Stack — open question, decide when this phase actually starts

The otaku-os plan assumed a bigger stack (FastAPI/Next.js/PostgreSQL/Redis/WebSockets) vs. AniNest's current one (Express + vanilla JS/Vite + Turso). Folding the plan into AniNest means that assumption needs revisiting, not inheriting by default. Options to weigh later, not now:
- Keep the current stack and scale it incrementally (fastest path, most consistent with what's already shipped and tested).
- Migrate pieces only where the new scope genuinely needs them (e.g. Redis for episode/chapter-release caching, WebSockets for live notifications) rather than a full framework rewrite.

No decision needed until this phase is actually greenlit.

---

**Next step**: none, until the user gives explicit go-ahead after the V1 roadmap items in section 1 are done.

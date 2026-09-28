# AniNest Roadmap: the features big sites don't do well

Each phase ships on its own, is useful the day it lands, and leaves the next phase easier. Tick a box when it's merged.
The detailed reasoning for each idea lives in the original proposal. This file records the **order**, the **decisions**
that differ from that proposal, and the **checklist** for each phase.

## Ground truth that shaped the order

- **There is no episode-progress tracking yet.** Favorites store a status (watching / completed / ...), not "episode 7".
  Ideas 1 (the "4/11 through Fate" checkbox), 3, 7, 8 and 10 all depend on it, so it is **Phase 0**.
- **There is no local catalog.** Every anime query is proxied to AniList, with Jikan as the fallback. Anything that
  "searches the catalog" (vibe search, group picks) is an AniList GraphQL query with filters, not a local SQL scan.
  AniList supports `tag_in`, `tag_not_in`, `genre_not_in`, `episodes_lesser`, `startDate_greater`, `format_in`,
  and `isAdult`, which is enough for vibe search v1.
- **AniList allows 30 requests/minute.** Anything that walks a graph (franchises) or batch-loads metadata (taste vectors)
  must be cached in `api_cache` or its own table, and must batch (`Page { media(idMal_in: [...]) }` takes 50 ids per call).
- **Community features need users before they show anything.** Thresholds ("5 ratings before a bar is coloured") are
  right, but on a young site they hide most data. So each community feature ships with a **zero-user fallback**:
  MAL filler flags, AniList relations, AniList tags. The community layer takes over as it grows.
- **Start collecting data early.** An `episode_log` from Phase 0 is what makes Wrapped, drop-point stats and "hours
  watched" possible months later. Data not logged now can't be recovered.
- CORS allows only GET/POST/DELETE, so writes are POST. New tests use `mal_id` range **92000-92999**.

## Order

| # | Phase | Why here | Size |
|---|---|---|---|
| 0 | Episode progress | Foundation for 1, 3, 7, 8, 10 | 1-2 days |
| 1 | Franchise watch order: automatic release order | Useful with zero users, strong search traffic | ~3 days |
| 2 | Airing calendar (.ics) | Small, brings users back weekly | 1 day |
| 3 | Free and legal, by country | Extends the existing free-watch pipeline | ~1 week |
| 4 | Episode guide: MAL filler/recap skip guide, then per-episode ratings and "when does it get good" | Skip guide works day one; ratings layer on top | 1-1.5 weeks |
| 5 | Vibe search v1 (rule parser to AniList tags), then v2 (Claude Haiku parser) | Headline feature, no users needed | ~1 week + 2 days |
| 6 | Taste compatibility, then Watch-together rooms | Uses favorites, reviews, quiz | 3 days + 1 week |
| ~~7~~ | ~~Franchise community orders~~ | Dropped (owner decision, 2026-09-27) | - |
| ~~8~~ | ~~Drop-point stats + spoiler protection~~ | Dropped for now (owner decision, 2026-09-27) | - |
| 10 | Season OP/ED tournament | Reuses the jukebox; done before 9 (owner decision, 2026-09-27) | 3-4 days |
| 9 | AniNest Wrapped (PNG share card) | Needs `episode_log`; ship before December | 3-4 days |
| 11 | Anime-to-manga continuation guide | Community-submitted | ~1 week |
| 12 | Season prediction league | Most moving parts; best started at a season boundary | 1-1.5 weeks |
| 13 | Light novels: browse, detail, reading list, reviews, free legal reading links; header redesign | Asked for 2026-09-28 | ~1 week |

---

## Next up (planned 2026-09-28, in this order)

**Done:** Phase 13, light novels and the header redesign (see below). Next is the security list.

**Then, security**
- [x] Email verification on sign-up; an email when the password changes or a new device logs in (alerts only to confirmed addresses; the digest needs one too)
- [x] Optional two-factor login (authenticator app, recovery codes, secrets encrypted with `TOTP_KEY`); recommended on admin accounts
- [x] Server-picked rounds for Higher or Lower (4 leaderboards): the server deals, hides the challenger's number and records the streak itself
- [x] The same for the other 9 ranked games (Guess the Anime x3, Name That Opening, Timeline, Studio Match, Emoji Plot, Source Material, Cast Call): the round engine `lib/roundGames.js`; the old score route is gone
- [x] Dev and tests can't reach production: Turso is used only with `NODE_ENV=production`, and the tests blank every service key. Owner to do: rotate the production Turso token (it sat in a local `.env`)
- [x] Update vitest to 5 (0 advisories)

**Then, UI**
- [x] Mobile and accessibility pass over every page: keyboard access, focus states, contrast, tap targets (sweep at 375px: sideways scroll on game pages, unlabeled inputs, focus rings, drawer focus)
- [x] Inline `style="..."` into CSS classes on the Account (25) and Profile (11) pages. What's left is one-off spacing (2-5 per page) and the admin-only curation page
- [x] Layout-shaped loading placeholders (detail pages, feeds, notifications, leaderboards, home) announced to screen readers; empty states already share `emptyHTML`. Games keep their playful loaders

**Then, features**
- [x] Custom lists: drag-and-drop reorder (pointer events, works on touch; ▲▼ kept for keyboards), follow other people's lists
- [ ] Prediction league: reminders before picks lock and when results are final
- [ ] Weekly digest on a fixed day (e.g. Sunday)
- [ ] Warm-up job that pre-fills `api_cache` for popular titles
- [ ] Visual novels via VNDB (free, keyless), after light novels settle

## Phase 0: Episode progress

- [x] `favorites.episodes_watched INTEGER NOT NULL DEFAULT 0` and `favorites.progress_at TEXT`; the length is the existing `favorites.episodes`
- [x] `episode_log(user_id, mal_id, episode, watched_at, UNIQUE(user_id, mal_id, episode))`. It is only written for
      small forward steps (up to 30 episodes at once). A jump from 0 to 1000 is a catch-up, not a binge, and would poison
      Wrapped and drop stats. Stepping back deletes log rows above the new value.
- [x] `POST /api/favorites/:malId/progress { episodes_watched, episodes? }` (anime must already be tracked)
  - clamps to `episodes` when known (null keeps the saved length); the hard cap is 5000
  - progress > 0 on an untracked / plan_to_watch entry becomes `watching`; reaching the total becomes `completed`
- [x] Detail page: `Episode 4 / 12  [-] [+1]` next to the status pills; tracking it implicitly marks it Watching
- [x] Library page: progress bar + `+1` on every Watching card
- [x] Tests: auth, validation, clamping, auto-status, log written/trimmed, big jump not logged

## Phase 1: Franchise watch order (automatic)

- [x] `lib/franchise.js`: BFS over AniList `relations` (ANIME nodes only), following SEQUEL, PREQUEL, SIDE_STORY,
      PARENT, SPIN_OFF, SUMMARY, ALTERNATIVE; ignores CHARACTER, OTHER, ADAPTATION and SOURCE. Two relation levels
      per query, **cap 80 nodes and 12 requests** (8 cut Fate off at 43), paced for the rate limit. Entries without a MAL id are shown without a link.
- [x] Tables `franchises(id, slug, name, root_mal_id, built_at)` and
      `franchise_entries(franchise_id, mal_id, anilist_id, title, image, format, episodes, start_date, relation, tier)`.
      Built lazily on first request, rebuilt after 7 days; any member's MAL id resolves to its franchise.
- [x] Default tiers: SUMMARY is `skip` ("recap"), SPIN_OFF/SIDE_STORY/specials are `optional`, TV/movies on the main
      line are `essential`. ALTERNATIVE entries are shown as a separate path (FMA vs Brotherhood).
- [x] `GET /api/anime/:id/franchise` (banner on detail pages: "Part of the Fate franchise, 23 entries") and
      `GET /api/franchises/:slug`
- [x] Page `#/franchise/:slug`: release-order list with cover, format, episodes, year, tier chip, and your status /
      progress from Phase 0 ("You're 4/11 through Fate")
- [x] Tests: graph walk and ordering as a pure function over fixture data (no live AniList)

Shipped notes: spin-off *chains* are optional as a whole; PV/CM specials are dropped; the jukebox also gained a MAL song-list
fallback while AnimeThemes was down (see HANDOFF.md). Checked live against FMA, Fate, Monogatari and Gundam.

## Phase 2: Airing calendar

- [x] `users.calendar_token` (random; rotating it revokes the old link). Stored as-is, not hashed: the feed only
      reveals a Watching list, which the public profile already shows, and this way the link can be shown again.
- [x] `GET /api/calendar/:token.ics`: no cookie (calendar apps don't send one). Last 7 days + next 14 days of
      `airingSchedules` for your Watching list (two AniList requests per 50 shows, max 150 shows), cached 1h per token
- [x] Account page: Google Calendar / Apple-Outlook (webcal) buttons + copy link + reset link

## Phase 3: Free and legal, by country

- [x] Columns on `anime_watch_sources`: `allowed_regions`, `blocked_regions` (JSON), `checked_at`. No `health`
      column: a dead link just gets status `expired`
- [x] A daily job (not the import) calls `videos.list?part=contentDetails,status` (1 unit per 50 ids) to store
      `regionRestriction`, expire deleted/private/non-embeddable videos, and restore ones that come back.
      Refuses to apply a run where every video looks dead (API glitch guard)
- [x] Country picker: guessed from the `Intl` time zone, then the language; kept in localStorage (not on the account)
- [x] Detail page: "📍 Free in [country]" picker, only uploads that play there, "N more are licensed only outside X",
      "checked with YouTube 2 days ago", and a clear message when nothing is licensed in your country
- [x] `#/free` page (More menu): every show with an approved upload that plays in your country, best rated first
      (`GET /api/free?country=`). Titles and covers come from an `anime_titles` table filled in the background
- [ ] Skipped: "Did this play for you?" reports. YouTube's own region lists are authoritative and checked daily, so
      add these only if people report links that YouTube says should play

## Phase 4: Episode guide

- [x] `episode_ratings` (1-5, emoji scale, only up to your own progress), `it_clicked`; stats computed on read (GROUP BY),
      no stats table. Ratings and the "clicked" mark can be taken back
- [x] Chart: one bar per episode, grey until 5 ratings, a table view, the "clicks at" episode highlighted; "Most people say
      it clicks at episode N" uses the **median** and needs 5 votes
- [x] Skip guide: `GET /api/episode-guide/:id/flags` pages Jikan's `/anime/:id/episodes` (max 12 pages,
      persistent-cached 7d, `lib/episodeFlags.js`) for MAL `filler`/`recap` flags; filler bars are faded and the guide
      says "You can safely skip 4 filler episodes: 26, 54, 97–108". Loaded separately, so while Jikan is down
      (504s since 2026-09-24) the guide simply shows without it. No other free source has filler flags

## Phase 5: Vibe search

- [x] v1 `lib/vibeParser.js` (pure, tested): "under N episodes", "short", "movie", "90s", "from 2019", "finished",
      "no X", "like <title>", plus 142 words mapped to ONE AniList genre or tag each, in code (no `vibe_terms` table
      until someone needs to edit it without a deploy). One tag per word because AniList's `genre_in`/`tag_in` are AND
      (checked live): "cozy fantasy" is Iyashikei AND Fantasy
- [x] Query AniList with the filters (tag rank ≥ 55, popularity > 3000, best score first); "like X" filters X's
      community recommendations locally; every result lists why it matched; unrecognised words are shown back
- [x] Page `#/vibe?q=...` (shareable), in More and on Browse; nothing understood offers a title search instead
- [x] v2 (`lib/vibeAi.js`): with `ANTHROPIC_API_KEY` set, a request with words the rules don't know goes to Claude
      Haiku, which returns the same filter JSON (structured output, validated with zod, names limited to the
      vocabulary, a "like" title only if the person wrote it). Cached a day in memory, capped by
      `VIBE_AI_DAILY_LIMIT` (500), and any failure falls back to v1. The page says when the AI read it
- Also fixed on the way: the router gives every page a fresh container, so a slow page can no longer overwrite the
  page the user moved on to

## Phase 6: Taste match and Watch together

- [x] Taste vector: genres of favorites weighted by review score, else status (dropped counts against). Favorites saved
      before genres were stored get them from AniList once (`lib/favoriteGenres.js`) and keep them. Taste Quiz results
      live only in the browser, so they aren't used
- [x] Match % = cosine of vectors blended with rating agreement on shared shows (full weight at 10 shared); needs 5+
      favorites on both sides
- [x] Profile banner: "82% taste match · you both lean Fantasy · You both love... · You disagree on..."
- [x] Rooms: `watch_rooms`, `watch_room_members` (guests pick 1-5 genres instead of the quiz), `watch_room_votes`;
      24h expiry, 8 people (enforced inside the INSERT, so a rush can't overfill a room); opening one needs an account,
      joining doesn't. Score = 60% least-happy member + 40% mean, 👍 nudges, one 👎 vetoes; anything a member completed,
      is watching or dropped is excluded. Candidate pool: AniList top-rated overall + the group's top 4 genres, cached 6h
- [x] Pages `#/together` and `#/together/:code` (share link, members, swipe card, top 3 picks, 8s polling)

## Phase 10: Season OP/ED tournament

- [x] `theme_tournaments(season, year, kind, size, starts_at, round_days)`, `theme_tournament_entries` (a snapshot of each
      song), `theme_tournament_votes(tournament_id, user_id, round, match, seed)`; winners are computed, not stored
- [x] Best Opening and Best Ending per season: 16 songs, one per show, seeded by AniList popularity (8 if the season has
      fewer), songs from the jukebox lookup so the MAL song-list fallback works too
- [x] Opens 6 weeks into a season; until then the previous season's bracket is the headline
- [x] 3-day rounds on a fixed clock; more votes wins, ties (and 0-0 on a quiet site) go to the better seed, so every bracket finishes
- [x] One vote per account per match, changeable while the round is open; counts hidden until you vote in that match
- [x] Page `#/tournament` (More menu): current round as head-to-heads with a shared player, bracket view, champion banner
- [x] The detail page's jukebox links to each bracket the show's songs are in (`GET /api/tournaments/for-anime/:malId`), and
      the page has a past-seasons picker (`GET /api/tournaments/seasons`, `#/tournament?kind=&season=&year=`)

## Phase 9: AniNest Wrapped

- [x] `GET /api/wrapped?year=&tz=` (your own only): episodes, estimated hours (24 min an episode, 100 a movie), shows,
      finished, days watched, longest streak, per-month counts, busiest month, biggest binge (2+ episodes of one show in a
      day), top 5 shows, top 3 genres (weighted by episodes), highest-rated show watched this year, and a persona from the top genre
- [x] Days and months use the viewer's time zone (`tz` = `Date#getTimezoneOffset`)
- [x] Page `#/wrapped` (Library menu), "so far" until December
- [x] PNG share card (1080x1350) drawn in a canvas: download, or the system share sheet where supported. Text only,
      since other hosts' cover images would block the export
- [x] A December nudge: a home banner for signed-in people through December and Jan 1-14, hideable per year

## Phase 13: Light novels and the new header

- [x] Catalog from AniList (type MANGA, format NOVEL, AniList ids): `#/novels` search with genre, status and sort;
      `#/novel/:id` with synopsis, authors, anime adaptations and AniList's official links (publishers, stores, the
      author's own web novel). Adult titles 404, and that answer is never cached
- [x] `novel_favorites` (reading list with volume progress: progress starts Reading, the last volume completes it) and
      `novel_reviews` (like manga reviews, reportable, hidden reviews and private profiles respected); both in the data
      export, deleted with the account, and counted in XP with manga
- [x] Reading is link-out only: official pages, J-Novel Club and BOOK☆WALKER search, and for the Japanese original the
      author-run Syosetu and Kakuyomu. `#/novels/free` lists legal free sites and searches public-domain classics
      (Project Gutenberg through Gutendex). No fan-translation sites
- [x] The anime page's continuation guide links to the novel page when the source is a light novel; `/api/share/novel/:id`
      link previews
- [x] Header: pill links on laptops (1024px+, avatar-only account chip under 1280px); under 1024px a slide-in drawer
      with the account card, section tiles and grouped lists (scrim, Escape, focus returns to the menu button);
      under 640px a one-row bar with the search behind a button

## Phase 11: Anime-to-manga continuation guide

- [x] Zero-user fallback: the anime's SOURCE relation on AniList names the manga or light novel (cached a day), with a
      link to search it in Manga. Anime originals with no answers show nothing
- [x] `manga_continuations(mal_id, user_id, last_chapter, volume)`: one answer per person, changeable or removable
- [x] The page shows the most common answer ("ends at chapter 87 (volume 10), so start at 88"), ties going to the later
      chapter, with how many people agree
- [x] In the data export and deleted with the account

## Phase 12: Season prediction league

- [x] `prediction_leagues(season, year, scores_at, final)`, `prediction_shows` (a snapshot of the season's 20 most popular
      shows, with the live AniList score), `predictions(league_id, user_id, mal_id, score)`
- [x] Opens 14 days before a season starts, picks lock 14 days in, final 14 days after the season ends
- [x] Guess each show's final AniList score (1.0-10.0): 10 points for spot on, one less per 0.1 off
- [x] After the lock, scores refresh on read at most every 6 hours; standings, the crowd's average guess and your points
      follow them live until the last refresh makes the league final. Scores stay hidden while picks are open
- [x] Page `#/predictions` (More menu) with a past-seasons picker; picks are in the data export and deleted with the account

## Phase 7 onward

Filled in when each phase starts, using the proposal's table designs: drop-point stats
and spoiler guard (8), Wrapped (9), OP/ED tournament (10), manga continuation (11), prediction league (12).

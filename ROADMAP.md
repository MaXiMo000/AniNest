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
| 7 | Franchise community orders (chronological, recommended, votes) | Needs some users to be worth it | ~1 week |
| 8 | Drop-point stats + spoiler protection | Needs weeks of Phase 0 data first | 3-4 days |
| 9 | AniNest Wrapped (PNG share card) | Needs `episode_log`; ship before December | 3-4 days |
| 10 | Season OP/ED tournament | Reuses the jukebox | 3-4 days |
| 11 | Anime-to-manga continuation guide | Community-submitted | ~1 week |
| 12 | Season prediction league | Most moving parts; best started at a season boundary | 1-1.5 weeks |

---

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

- [ ] Columns on `anime_watch_sources`: `allowed_regions`, `blocked_regions` (JSON), `last_checked_at`, `health`
- [ ] Import and a nightly job call `videos.list?part=contentDetails,status` (1 unit per 50 ids) to store
      `regionRestriction` and mark deleted/private videos `expired`
- [ ] Country picker: guess from `Intl` time zone first (`Asia/Kolkata` gives IN; browser language is often en-US),
      then language; stored in localStorage and on the account
- [ ] Detail page line: "Free and legal in India: Muse Asia, eps 1-24 (checked 2 days ago)"; Browse "Free in my
      country" filter; `#/free` page grouped by channel
- [ ] "Did this play for you?" feedback in `link_reports`; 3 downvotes from one country hides the link there and queues it for review

## Phase 4: Episode guide

- [ ] Jikan `/anime/:id/episodes` (paged, persistent-cached 7d) gives titles and MAL `filler`/`recap` flags
- [ ] "Skip guide" on the detail page: "You can safely skip 26, 54, 97-108" (works with zero users)
- [ ] `episode_ratings` (1-5, emoji scale, only up to your own progress), `it_clicked`, stats computed on write
- [ ] Chart: one bar per episode, grey until 5 ratings, filler dimmed; "Most people say it clicks at episode N" uses the **median**

## Phase 5: Vibe search

- [ ] v1 `lib/vibeParser.js` (pure, heavily tested): "under N episodes", "short", "movie", "90s", "finished",
      "no X", "like <title>", plus ~60 mood words mapped to AniList tags/genres (cozy gives Iyashikei and Slice of Life,
      and so on) in `vibe_terms`
- [ ] Query AniList with the filters; "like X" uses X's recommendations; results show why they matched
- [ ] v2: optional `ANTHROPIC_API_KEY`, Haiku returns the same filter JSON (validated with zod, falls back to v1)

## Phase 6: Taste match and Watch together

- [ ] Taste vector: genres/tags of favorites (weighted by status and review score) batch-loaded from AniList and cached
- [ ] Match % = cosine of vectors blended with rating agreement on shared shows (full weight at 10 shared)
- [ ] Profile banner: "You and alex: 82% match. You both love... You disagree on..."
- [ ] Rooms: `rooms`, `room_members` (guest allowed), `room_votes`; 24h expiry; 10-card swipe; score = min member
      prediction blended with the mean; exclude anything anyone has seen or vetoed

## Phase 7 onward

Filled in when each phase starts, using the proposal's table designs: community orders and votes (7), drop-point stats
and spoiler guard (8), Wrapped (9), OP/ED tournament (10), manga continuation (11), prediction league (12).

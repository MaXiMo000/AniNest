import { Api, imageOf } from '../lib/api.js';
import { cardRail, loadingHTML, errorHTML, escapeHtml, wireRetry, showToast, WATCH_STATUSES } from '../lib/ui.js';
import { Favorites } from '../lib/store.js';
import { Reviews } from '../lib/reviewsApi.js';
import { createReviewsUi } from '../lib/reviewsUi.js';
import { navigate } from '../lib/router.js';
import { RecentlyViewed } from '../lib/recentlyViewed.js';
import { WatchSources } from '../lib/watchSourcesApi.js';
import { freeWatchSectionHTML, wireFreeWatch } from '../lib/freeWatch.js';

function fmtDate(x) {
  return x?.string || '?';
}

function statPills(a) {
  const pills = [
    a.rank ? `🏅 Rank #${a.rank}` : null,
    a.popularity ? `📈 Popularity #${a.popularity}` : null,
    a.status ? `📡 ${a.status}` : null,
    a.duration ? `⏱ ${a.duration}` : null,
    a.rating ? `🔞 ${a.rating.replace(/\s*-.*$/, '')}` : null,
  ].filter(Boolean);
  return pills.map((p) => `<span class="stat-pill">${escapeHtml(p)}</span>`).join('');
}

function trailerHTML(a) {
  const raw = a.trailer?.embed_url;
  if (!raw) return '';
  // Jikan's embed_url defaults to autoplay=1 — don't blast video+sound at
  // someone who just opened a details page.
  const embed = escapeHtml(raw.includes('autoplay=') ? raw.replace(/autoplay=1/, 'autoplay=0') : raw);
  return `
    <div class="tv-frame">
      <div class="tv-screen"><iframe src="${embed}" title="Trailer" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
      <div class="tv-label">📼 OFFICIAL TRAILER</div>
    </div>`;
}

function watchBoxHTML(a) {
  const streaming = a.streaming || [];
  const links = streaming.length
    ? streaming.map((s) => `<a class="btn-pow btn-pow--blue" target="_blank" rel="noopener" href="${escapeHtml(s.url)}">▶ ${escapeHtml(s.name)}</a>`).join('')
    : `<a class="btn-pow btn-pow--blue" target="_blank" rel="noopener" href="https://www.crunchyroll.com/search?q=${encodeURIComponent(a.title)}">▶ Search on Crunchyroll</a>`;
  return `
    <div class="watch-box">
      <h3>📺 Where to Watch</h3>
      <p style="color:var(--muted);font-weight:600;margin:0">We link to official platforms only — no sketchy streams here, gotta support the studios!</p>
      <div class="watch-links">${links}</div>
    </div>`;
}

function watchStatusHTML(malId) {
  const current = Favorites.getStatus(malId);
  return `
    <div class="watch-status-row">
      <span class="watch-status-label">📺 Track:</span>
      ${WATCH_STATUSES.map((s) => `
        <button class="status-pill ${current === s.value ? 'is-active' : ''}" data-status="${s.value}">${s.emoji} ${escapeHtml(s.label)}</button>
      `).join('')}
    </div>`;
}

function progressLabel(malId, total) {
  const { watched } = Favorites.getProgress(malId);
  return `Ep ${watched} / ${total ?? '?'}`;
}

// Episode counter under the status pills. `total` is null while a show is
// airing, which leaves +1 unbounded; the server clamps to it otherwise.
function progressHTML(a) {
  const total = a.episodes || null;
  return `
    <div class="watch-status-row progress-row">
      <span class="watch-status-label">🎞️ Progress:</span>
      <button class="status-pill" data-step="-1" aria-label="One episode back">−</button>
      <span class="progress-count" id="progress-count" aria-live="polite">${escapeHtml(progressLabel(a.mal_id, total))}</span>
      <button class="status-pill" data-step="1">+1 episode</button>
    </div>`;
}

function charCardHTML(c) {
  const va = c.voiceActors?.[0];
  const roleLabel = c.role ? c.role.charAt(0) + c.role.slice(1).toLowerCase() : '';
  return `
    <div class="char-card">
      <div class="char-photos">
        ${c.character.image ? `<img class="char-photo" src="${escapeHtml(c.character.image)}" alt="${escapeHtml(c.character.name)}" loading="lazy" />` : ''}
        ${va?.image ? `<img class="va-photo" src="${escapeHtml(va.image)}" alt="${escapeHtml(va.name)}" loading="lazy" />` : ''}
      </div>
      <div class="char-name">${escapeHtml(c.character.name)}</div>
      ${roleLabel ? `<div class="char-role">${escapeHtml(roleLabel)}</div>` : ''}
      ${va ? `<a class="va-name" href="#/person/${encodeURIComponent(va.name)}">🎙️ ${escapeHtml(va.name)}</a>` : ''}
    </div>`;
}

function charactersSectionHTML(characters) {
  if (!characters.length) return '';
  return `
    <section class="section">
      <div class="section-head"><h2 class="section-title">🎭 Characters &amp; Voice Actors</h2></div>
      <div class="rail char-rail">${characters.map(charCardHTML).join('')}</div>
    </section>`;
}

// Reuses .tv-frame (from the trailer embed above) for the player shell and
// .guess-choice (from the games) for the track-list buttons.
const trackLabel = (t) => `${t.slug}${t.title ? ` — ${t.title}` : ''}`;

// Openings first (OP1, OP2, ...) then endings, so the first track is always
// the opening - it is preselected below, no click needed to get started.
function sortThemes(themes) {
  const rank = (t) => (t.type === 'OP' ? 0 : 1);
  const num = (t) => Number(/(\d+)/.exec(t.slug || '')?.[1]) || 1;
  return [...themes].sort((a, b) => rank(a) - rank(b) || num(a) - num(b));
}

// Search links, not embeds: they need no key, never share an outage with
// AnimeThemes, and send people to the official releases.
function listenQuery(t, animeTitle) {
  return [t.title, t.artist || animeTitle].filter(Boolean).join(' ');
}
function listenLinksHTML(query) {
  const q = encodeURIComponent(query);
  return `
    <a class="chip" target="_blank" rel="noopener" href="https://music.youtube.com/search?q=${q}">▶ YouTube Music</a>
    <a class="chip" target="_blank" rel="noopener" href="https://open.spotify.com/search/${q}">🎧 Spotify</a>`;
}

// `unavailable` = the request itself FAILED (both AnimeThemes and the MAL
// song list), as opposed to an anime that has no themes at all. Those must
// look different: the second shows nothing, the first offers a retry.
function themesSectionHTML(themes, animeTitle, { unavailable = false } = {}) {
  const head = '<div class="section-head"><h2 class="section-title">🎵 OP/ED Jukebox</h2></div>';
  if (unavailable) {
    return `
    <section class="section">
      ${head}
      <p class="muted-note">The openings/endings services are temporarily unavailable — a third-party outage, not this anime.</p>
      <button class="chip" id="themes-retry">🔄 Try again</button>
    </section>`;
  }
  if (!themes.length) return '';
  const sorted = sortThemes(themes);

  // Song list only (AnimeThemes is down or has nothing for this show).
  if (!sorted.some((t) => t.videoUrl)) {
    return `
    <section class="section">
      ${head}
      <p class="muted-note">Creditless videos aren't available for this one right now, so here's the song list.</p>
      <ul class="song-list">
        ${sorted.map((t) => `
          <li class="song-row">
            <div class="song-info">
              <strong>${escapeHtml(trackLabel(t))}</strong>
              <span>${escapeHtml([t.artist, t.episodes].filter(Boolean).join(' · '))}</span>
            </div>
            <div class="song-links">${listenLinksHTML(listenQuery(t, animeTitle))}</div>
          </li>`).join('')}
      </ul>
    </section>`;
  }

  const playable = sorted.filter((t) => t.videoUrl);
  const first = playable[0];
  return `
    <section class="section">
      ${head}
      <div class="tv-frame">
        <div class="tv-screen"><video id="theme-player" style="width:100%;height:100%" controls preload="none" src="${escapeHtml(first.videoUrl)}"></video></div>
        <div class="tv-label" id="theme-now-playing">▶ ${escapeHtml(trackLabel(first))} — press play</div>
      </div>
      <p class="muted-note" id="theme-video-down" hidden>The video host isn't responding right now. You can still listen:</p>
      <div class="song-links" id="theme-listen">${listenLinksHTML(listenQuery(first, animeTitle))}</div>
      <div class="guess-choices" id="theme-track-list" style="margin-top:14px">
        ${playable.map((t, i) => `<button class="guess-choice${i === 0 ? ' is-correct' : ''}" data-video="${escapeHtml(t.videoUrl)}" data-label="${escapeHtml(trackLabel(t))}" data-query="${escapeHtml(listenQuery(t, animeTitle))}">${escapeHtml(trackLabel(t))}</button>`).join('')}
      </div>
    </section>`;
}

function wireThemes(root) {
  const player = root.querySelector('#theme-player');
  if (!player) return;
  // A cached list can outlive AnimeThemes' video host; say so instead of a dead player.
  player.addEventListener('error', () => { root.querySelector('#theme-video-down')?.removeAttribute('hidden'); });
  root.querySelectorAll('#theme-track-list .guess-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      player.src = btn.dataset.video;
      player.play().catch(() => {}); // browsers can reject autoplay-after-src-swap; controls still let the user hit play themselves
      root.querySelectorAll('#theme-track-list .guess-choice').forEach((b) => b.classList.remove('is-correct'));
      btn.classList.add('is-correct');
      const label = root.querySelector('#theme-now-playing');
      if (label) label.textContent = `▶ ${btn.dataset.label}`;
      const listen = root.querySelector('#theme-listen');
      if (listen) listen.innerHTML = listenLinksHTML(btn.dataset.query);
    });
  });
}

// Loaded AFTER the page renders instead of inside the page's Promise.all: a
// dead third-party host takes seconds to fail, and the whole anime page used
// to wait on it. Now the page shows immediately and the jukebox fills in.
async function loadThemes(root, id, animeTitle) {
  const slot = root.querySelector('#themes-slot');
  if (!slot) return;
  try {
    const res = await Api.themes(id);
    if (!slot.isConnected) return; // navigated to another anime meanwhile
    slot.innerHTML = themesSectionHTML(res.data || [], animeTitle);
    wireThemes(root);
  } catch {
    if (!slot.isConnected) return;
    slot.innerHTML = themesSectionHTML([], animeTitle, { unavailable: true });
    slot.querySelector('#themes-retry')?.addEventListener('click', () => {
      slot.innerHTML = '<p class="muted-note">Checking again…</p>';
      loadThemes(root, id, animeTitle);
    });
  }
}

// "Part of the X franchise" banner, loaded after the page like the jukebox:
// the first visit to a franchise walks AniList, which can take a while. A
// build still running answers `pending`, so it's asked once more later.
async function loadFranchise(root, id, retried = false) {
  const slot = root.querySelector('#franchise-slot');
  if (!slot) return;
  let res;
  try {
    res = await Api.franchiseOf(id);
  } catch {
    return; // no banner is the right fallback
  }
  if (!slot.isConnected) return;
  if (res.pending && !retried) {
    setTimeout(() => { if (slot.isConnected) loadFranchise(root, id, true); }, 15000);
    return;
  }
  const f = res.data;
  if (!f) return;
  slot.innerHTML = `
    <a class="franchise-banner" href="#/franchise/${encodeURIComponent(f.slug)}">
      <span class="franchise-banner-icon" aria-hidden="true">📚</span>
      <span>Part of the <strong>${escapeHtml(f.name)}</strong> franchise · ${Number(f.entries)} entries, ${Number(f.essential)} essential</span>
      <span class="franchise-banner-cta">Watch order →</span>
    </a>`;
}

const animeReviews = createReviewsUi(Reviews);

export async function renderDetails(root, id) {
  root.innerHTML = loadingHTML('LOADING EPISODE DATA');
  try {
    const [{ data: a }, recRes, reviewsData, charRes, watchSourcesRes] = await Promise.all([
      Api.fullById(id),
      Api.recommendations(id).catch(() => ({ data: [] })),
      animeReviews.load(id),
      Api.characters(id).catch(() => ({ data: [] })),
      WatchSources.forAnime(id).catch(() => ({ data: [] })),
    ]);

    const img = escapeHtml(imageOf(a));
    const score = a.score ? a.score.toFixed(1) : '—';
    const recs = (recRes.data || []).slice(0, 12).map((r) => r.entry);
    const characters = charRes.data || [];
    const watchSources = watchSourcesRes.data || [];

    document.title = `${a.title} — AniNest`;
    RecentlyViewed.record(a);

    root.innerHTML = `
      <div class="detail-hero" style="background:linear-gradient(160deg, rgba(123,47,247,0.25), rgba(18,12,34,0.9)), var(--panel)">
        <img class="detail-poster" src="${img}" alt="${escapeHtml(a.title)}" fetchpriority="high" />
        <div class="detail-main">
          <h1 class="detail-title">${escapeHtml(a.title)}</h1>
          ${a.title_english && a.title_english !== a.title ? `<p class="detail-title-en">${escapeHtml(a.title_english)}</p>` : ''}
          <div class="detail-badges">
            <span class="badge-score">${score}</span>
            ${statPills(a)}
          </div>
          <div class="genre-chips">
            ${(a.genres || []).concat(a.themes || []).map((g) => `<a class="chip" href="#/browse?genre=${Number(g.mal_id) || 0}">${escapeHtml(g.name)}</a>`).join('')}
          </div>
          <div class="hero-actions">
            <button class="btn-pow btn-pow--pink" id="fav-toggle">${Favorites.has(a.mal_id) ? '💖 FAVORITED' : '🤍 ADD TO FAVORITES'}</button>
            ${a.url ? `<a class="btn-pow btn-pow--outline" target="_blank" rel="noopener" href="${escapeHtml(a.url)}">🔗 MyAnimeList</a>` : ''}
          </div>
          ${watchStatusHTML(a.mal_id)}
          ${progressHTML(a)}
        </div>
      </div>

      <div id="franchise-slot"></div>

      <div class="speech-bubble">${escapeHtml(a.synopsis || 'No synopsis available for this one — pure mystery box.')}</div>

      ${trailerHTML(a)}
      ${freeWatchSectionHTML(watchSources, a.mal_id)}
      ${watchBoxHTML(a)}

      <div class="info-grid">
        <div class="info-box"><div class="k">Episodes</div><div class="v">${a.episodes ?? '?'}</div></div>
        <div class="info-box"><div class="k">Aired</div><div class="v">${escapeHtml(fmtDate(a.aired))}</div></div>
        <div class="info-box"><div class="k">Studios</div><div class="v">${(a.studios || []).length ? (a.studios || []).map((s) => `<a class="studio-link" href="#/studio/${encodeURIComponent(s.name)}">${escapeHtml(s.name)}</a>`).join(', ') : '—'}</div></div>
        <div class="info-box"><div class="k">Source</div><div class="v">${escapeHtml(a.source || '—')}</div></div>
        <div class="info-box"><div class="k">Season</div><div class="v">${escapeHtml([a.season, a.year].filter(Boolean).join(' ') || '—')}</div></div>
        <div class="info-box"><div class="k">Members</div><div class="v">${a.members ? a.members.toLocaleString() : '—'}</div></div>
      </div>

      ${charactersSectionHTML(characters)}

      <div id="themes-slot"></div>

      ${animeReviews.sectionHTML(reviewsData)}

      ${recs.length ? `
      <section class="section">
        <div class="section-head"><h2 class="section-title">🔀 If You Like This</h2></div>
        ${cardRail(recs)}
      </section>` : ''}
    `;

    root.querySelector('#fav-toggle')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      const result = await Favorites.toggle(a);
      btn.disabled = false;
      if (result.needsLogin) {
        showToast('Log in to save favorites!');
        navigate('#/login');
        return;
      }
      btn.textContent = result.isFav ? '💖 FAVORITED' : '🤍 ADD TO FAVORITES';
      showToast(result.ok
        ? (result.isFav ? `Added "${a.title}" to favorites!` : 'Removed from favorites.')
        : 'Something went wrong — try again.');
    });

    const total = a.episodes || null;
    const statusPills = () => root.querySelectorAll('.status-pill[data-status]');
    const syncTracker = () => {
      const current = Favorites.getStatus(a.mal_id);
      statusPills().forEach((b) => b.classList.toggle('is-active', b.dataset.status === current));
      const count = root.querySelector('#progress-count');
      if (count) count.textContent = progressLabel(a.mal_id, total);
      const favBtn = root.querySelector('#fav-toggle');
      if (favBtn && Favorites.has(a.mal_id)) favBtn.textContent = '💖 FAVORITED';
    };

    root.querySelectorAll('.status-pill[data-step]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { watched } = Favorites.getProgress(a.mal_id);
        const next = Math.max(0, Math.min(watched + Number(btn.dataset.step), total ?? Infinity));
        if (next === watched) return;
        root.querySelectorAll('.status-pill[data-step]').forEach((b) => { b.disabled = true; });
        const result = await Favorites.setProgress(a, next, total);
        root.querySelectorAll('.status-pill[data-step]').forEach((b) => { b.disabled = false; });
        if (result.needsLogin) {
          showToast('Log in to track your progress!');
          navigate('#/login');
          return;
        }
        if (!result.ok) { showToast('Something went wrong — try again.'); return; }
        syncTracker();
        if (result.status === 'completed' && next > watched) showToast(`Finished "${a.title}"! 🎉`);
      });
    });

    statusPills().forEach((btn) => {
      btn.addEventListener('click', async () => {
        const clicked = btn.dataset.status;
        const wasActive = btn.classList.contains('is-active');
        const nextStatus = wasActive ? null : clicked; // clicking the active status again clears it
        statusPills().forEach((b) => { b.disabled = true; });
        const result = await Favorites.setStatus(a, nextStatus);
        // Marking a show with a known length Completed also fills its progress.
        if (result.ok && nextStatus === 'completed' && total) await Favorites.setProgress(a, total, total);
        statusPills().forEach((b) => { b.disabled = false; });
        if (result.needsLogin) {
          showToast('Log in to track anime!');
          navigate('#/login');
          return;
        }
        if (!result.ok) { showToast('Something went wrong — try again.'); return; }
        syncTracker();
        const label = WATCH_STATUSES.find((s) => s.value === nextStatus)?.label;
        showToast(label ? `Marked as ${label}.` : 'Status cleared.');
      });
    });

    wireFreeWatch(root, watchSources);

    loadThemes(root, id, a.title);
    loadFranchise(root, id);

    animeReviews.wire(root, a.mal_id);
  } catch (err) {
    console.error(err);
    root.innerHTML = errorHTML('Couldn’t load this anime — it might not exist, or the API is rate-limited. Try again shortly!');
    wireRetry(root, () => renderDetails(root, id));
  }
}

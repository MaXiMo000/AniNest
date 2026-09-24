import { Api, imageOf } from '../lib/api.js';
import { cardRail, loadingHTML, errorHTML, escapeHtml, wireRetry, showToast, WATCH_STATUSES } from '../lib/ui.js';
import { Favorites } from '../lib/store.js';
import { Reviews } from '../lib/reviewsApi.js';
import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';
import { RecentlyViewed } from '../lib/recentlyViewed.js';
import { powSelectHTML } from '../lib/powSelect.js';
import { WatchSources } from '../lib/watchSourcesApi.js';

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

// Curated official YouTube uploads (Muse Asia, Ani-One Asia, Crunchyroll's
// own channel, etc.) - deliberately separate from watchBoxHTML above
// (licensed-platform links, not embeddable) rather than merged into it, so
// "actually watchable here for free" never gets visually confused with
// "here's a link to a paid platform". Always rebuilt from the bare video id
// the backend returns - never trusts/embeds a raw URL (see
// backend/src/lib/youtubeUrl.js).
//
// One player + an episode list rather than one iframe per source: bulk
// import can attach 100+ episodes to a long-running show, and a hundred
// YouTube iframes loading at once would be unusable. Nothing loads until an
// episode is picked.
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function sourceSortKey(s) {
  const label = s.label || '';
  if (/^Complete/i.test(label)) return -1; // whole-series compilations first
  const m = /(\d+)/.exec(label);
  return m ? Number(m[1]) : 9999;
}

function freeWatchSectionHTML(sources, malId) {
  const head = `
      <div class="section-head">
        <h2 class="section-title">🆓 Watch Free (Official)</h2>
        <a href="#/anime/${malId}/submit-watch-link" class="chip">➕ Suggest a link</a>
      </div>`;
  const valid = sources.filter((s) => YT_ID_RE.test(s.youtube_video_id));
  if (!valid.length) {
    return `
    <section class="section">
      ${head}
      <p style="color:var(--muted);font-weight:600">No free official episodes added yet — know one? Suggest a link above!</p>
    </section>`;
  }
  const sorted = [...valid].sort((a, b) => sourceSortKey(a) - sourceSortKey(b) || (a.label || '').localeCompare(b.label || ''));
  const buttons = sorted.map((s) => {
    const text = `${s.label || 'Watch'} — ${s.channel_name || 'Official upload'}`;
    return `<button class="guess-choice" data-video="${escapeHtml(s.youtube_video_id)}" data-label="${escapeHtml(text)}">${escapeHtml(text)}</button>`;
  }).join('');
  return `
    <section class="section" id="free-watch">
      ${head}
      <div class="tv-frame">
        <div class="tv-screen" id="free-player-screen" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-weight:800">▶ Pick an episode below</div>
        <div class="tv-label" id="free-now-playing">${sorted.length} free ${sorted.length === 1 ? 'upload' : 'uploads'} available</div>
      </div>
      <div class="guess-choices" id="free-episode-list" style="margin-top:14px;max-height:300px;overflow-y:auto">${buttons}</div>
    </section>`;
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
// .guess-choice (from the games) for the track-list buttons - both already
// styled, no new CSS needed for a one-off jukebox.
function themesSectionHTML(themes) {
  if (!themes.length) return '';
  const trackLabel = (t) => `${t.slug}${t.title ? ` — ${t.title}` : ''}`;
  return `
    <section class="section">
      <div class="section-head"><h2 class="section-title">🎵 OP/ED Jukebox</h2></div>
      <div class="tv-frame">
        <div class="tv-screen"><video id="theme-player" style="width:100%;height:100%" controls preload="none"></video></div>
        <div class="tv-label" id="theme-now-playing">▶ Pick a track below</div>
      </div>
      <div class="guess-choices" id="theme-track-list" style="margin-top:14px">
        ${themes.map((t) => `<button class="guess-choice" data-video="${escapeHtml(t.videoUrl)}" data-label="${escapeHtml(trackLabel(t))}">${escapeHtml(trackLabel(t))}</button>`).join('')}
      </div>
    </section>`;
}

function reviewCardHTML(r, isMine) {
  const date = new Date(r.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `
    <div class="review-card ${isMine ? 'review-mine' : ''}">
      <div class="review-head">
        <span class="badge-score small">${r.rating}</span>
        <a href="#/u/${encodeURIComponent(r.username)}"><strong>${escapeHtml(r.username)}</strong></a>
        <span class="review-date">${escapeHtml(date)}${isMine ? ' · you' : ''}</span>
      </div>
      ${r.body ? `<p class="review-body">${escapeHtml(r.body)}</p>` : ''}
    </div>`;
}

function reviewFormHTML(myReview) {
  const options = Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => ({ value: n, label: `${n} / 10` }));
  return `
    <div class="watch-box">
      <h3>${myReview ? '✏️ Edit Your Review' : '✍️ Write a Review'}</h3>
      <form id="review-form">
        <div class="form-field">
          <label>Your Rating</label>
          ${powSelectHTML({ id: 'review-rating', options, value: myReview?.rating ?? 10 })}
        </div>
        <div class="form-field">
          <label for="review-body">Your Thoughts (optional)</label>
          <textarea id="review-body" rows="3" maxlength="2000" style="width:100%;padding:12px 14px;border:2.5px solid var(--ink);border-radius:10px;background:var(--bg2);color:var(--text);font-family:var(--font-body);font-weight:600;resize:vertical">${escapeHtml(myReview?.body || '')}</textarea>
        </div>
        <div class="hero-actions">
          <button type="submit" class="btn-pow btn-pow--pink">${myReview ? 'UPDATE REVIEW' : 'POST REVIEW'}</button>
          ${myReview ? '<button type="button" id="review-delete" class="btn-pow btn-pow--outline">DELETE</button>' : ''}
        </div>
      </form>
    </div>`;
}

function reviewLoginPromptHTML() {
  return `
    <div class="watch-box">
      <h3>💬 Got thoughts on this one?</h3>
      <p style="color:var(--muted);font-weight:600;margin:0 0 12px">Log in to leave a rating and review.</p>
      <div class="hero-actions">
        <a href="#/login" class="btn-pow btn-pow--pink">LOG IN</a>
        <a href="#/register" class="btn-pow btn-pow--outline">SIGN UP</a>
      </div>
    </div>`;
}

function reviewsSectionHTML(reviewsData) {
  const { reviews, average, count } = reviewsData;
  return `
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">💬 Community Reviews</h2>
        <span class="section-sub">${count ? `★ ${average} average from ${count} review${count === 1 ? '' : 's'}` : 'No reviews yet — be the first!'}</span>
      </div>
      <div id="review-form-area">${Auth.get().user ? reviewFormHTML(reviewsData.myReview) : reviewLoginPromptHTML()}</div>
      <div id="review-list">${reviews.length ? reviews.map((r) => reviewCardHTML(r, r.username === Auth.get().user?.username)).join('') : ''}</div>
    </section>`;
}

async function reloadReviews(root, malId, animeTitle) {
  const reviewsData = await Reviews.list(malId).catch(() => ({ reviews: [], average: null, count: 0, myReview: null }));
  const section = root.querySelector('#reviews-section');
  if (!section) return;
  section.outerHTML = reviewsSectionHTML(reviewsData).replace('<section class="section">', '<section class="section" id="reviews-section">');
  wireReviewForm(root, malId, animeTitle);
}

function wireReviewForm(root, malId, animeTitle) {
  const form = root.querySelector('#review-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rating = Number(root.querySelector('#review-rating').value);
    const body = root.querySelector('#review-body').value.trim();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await Reviews.submit(malId, rating, body);
      showToast('Review saved!');
      await reloadReviews(root, malId, animeTitle);
    } catch (err) {
      if (err.status === 401) {
        showToast('Log in to save your review!');
        navigate('#/login');
        return;
      }
      showToast(err.message || 'Something went wrong — try again.');
      submitBtn.disabled = false;
    }
  });

  root.querySelector('#review-delete')?.addEventListener('click', async () => {
    try {
      await Reviews.remove(malId);
      showToast('Review deleted.');
      await reloadReviews(root, malId, animeTitle);
    } catch {
      showToast('Something went wrong — try again.');
    }
  });
}

export async function renderDetails(root, id) {
  root.innerHTML = loadingHTML('LOADING EPISODE DATA');
  try {
    const [{ data: a }, recRes, reviewsData, charRes, themesRes, watchSourcesRes] = await Promise.all([
      Api.fullById(id),
      Api.recommendations(id).catch(() => ({ data: [] })),
      Reviews.list(id).catch(() => ({ reviews: [], average: null, count: 0, myReview: null })),
      Api.characters(id).catch(() => ({ data: [] })),
      Api.themes(id).catch(() => ({ data: [] })),
      WatchSources.forAnime(id).catch(() => ({ data: [] })),
    ]);

    const img = escapeHtml(imageOf(a));
    const score = a.score ? a.score.toFixed(1) : '—';
    const recs = (recRes.data || []).slice(0, 12).map((r) => r.entry);
    const characters = charRes.data || [];
    const themes = themesRes.data || [];
    const watchSources = watchSourcesRes.data || [];

    document.title = `${a.title} — AniNest`;
    RecentlyViewed.record(a);

    root.innerHTML = `
      <div class="detail-hero" style="background:linear-gradient(160deg, rgba(123,47,247,0.25), rgba(18,12,34,0.9)), var(--panel)">
        <img class="detail-poster" src="${img}" alt="${escapeHtml(a.title)}" />
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
        </div>
      </div>

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

      ${themesSectionHTML(themes)}

      ${reviewsSectionHTML(reviewsData).replace('<section class="section">', '<section class="section" id="reviews-section">')}

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

    root.querySelectorAll('.status-pill').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const clicked = btn.dataset.status;
        const wasActive = btn.classList.contains('is-active');
        const nextStatus = wasActive ? null : clicked; // clicking the active status again clears it
        root.querySelectorAll('.status-pill').forEach((b) => { b.disabled = true; });
        const result = await Favorites.setStatus(a, nextStatus);
        root.querySelectorAll('.status-pill').forEach((b) => { b.disabled = false; });
        if (result.needsLogin) {
          showToast('Log in to track anime!');
          navigate('#/login');
          return;
        }
        if (!result.ok) { showToast('Something went wrong — try again.'); return; }
        root.querySelectorAll('.status-pill').forEach((b) => b.classList.toggle('is-active', b.dataset.status === nextStatus));
        const favBtn = root.querySelector('#fav-toggle');
        if (favBtn) favBtn.textContent = '💖 FAVORITED';
        const label = WATCH_STATUSES.find((s) => s.value === nextStatus)?.label;
        showToast(label ? `Marked as ${label}.` : 'Status cleared.');
      });
    });

    root.querySelectorAll('#free-episode-list .guess-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        const videoId = btn.dataset.video;
        if (!YT_ID_RE.test(videoId)) return;
        const screen = root.querySelector('#free-player-screen');
        // Built from the validated bare id against our own template, never from stored text.
        screen.style.display = '';
        screen.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" title="Free episode" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
        root.querySelectorAll('#free-episode-list .guess-choice').forEach((b) => b.classList.remove('is-correct'));
        btn.classList.add('is-correct');
        root.querySelector('#free-now-playing').textContent = `▶ ${btn.dataset.label}`;
      });
    });

    root.querySelectorAll('#theme-track-list .guess-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        const player = root.querySelector('#theme-player');
        if (!player) return;
        player.src = btn.dataset.video;
        player.play().catch(() => {}); // browsers can reject autoplay-after-src-swap; controls still let the user hit play themselves
        root.querySelectorAll('#theme-track-list .guess-choice').forEach((b) => b.classList.remove('is-correct'));
        btn.classList.add('is-correct');
        const label = root.querySelector('#theme-now-playing');
        if (label) label.textContent = `▶ ${btn.dataset.label}`;
      });
    });

    wireReviewForm(root, a.mal_id, a.title);
  } catch (err) {
    console.error(err);
    root.innerHTML = errorHTML('Couldn’t load this anime — it might not exist, or the API is rate-limited. Try again shortly!');
    wireRetry(root, () => renderDetails(root, id));
  }
}

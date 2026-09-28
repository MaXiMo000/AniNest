import { Users } from '../lib/usersApi.js';
import { Api, imageOf } from '../lib/api.js';
import { MangaApi } from '../lib/mangaApi.js';
import { mangaImg } from '../lib/mangaImage.js';
import { escapeHtml, errorHTML, emptyHTML, wireRetry, badgesRowHTML, xpCardHTML, showToast, skeletonDetail } from '../lib/ui.js';
import { profileStats, STATUS_ORDER } from '../lib/profileStats.js';
import { Auth } from '../lib/authStore.js';
import { shareButtonHTML, wireShare } from '../lib/share.js';
import { loadProfileLists } from './lists.js';

// "You and alex: 82% taste match" for a signed-in visitor on someone else's
// profile (backend/src/lib/taste.js). Loaded after the page; any failure just
// leaves the slot empty.
async function loadTasteMatch(root, username) {
  const slot = root.querySelector('#taste-match');
  const me = Auth.get().user;
  if (!slot || !me || me.username.toLowerCase() === username.toLowerCase()) return;
  let res;
  try {
    res = await Users.tasteMatch(username);
  } catch {
    return;
  }
  if (!slot.isConnected) return;
  const m = res.match;
  const name = escapeHtml(username);
  if (res.private) return;
  if (!m) {
    slot.innerHTML = `<div class="taste-match"><p class="muted-note">Add at least ${Number(res.minList)} anime to both your lists to see how your tastes compare.</p></div>`;
    return;
  }
  const titles = (list) => list.map((a) => `<a href="#/anime/${Number(a.mal_id)}">${escapeHtml(a.title)}</a>`).join(', ');
  slot.innerHTML = `
    <div class="taste-match">
      <div class="taste-match-score"><strong>${Number(m.percent)}%</strong> taste match 🎯</div>
      <p>You and ${name}${m.sharedGenres.length ? ` both lean ${m.sharedGenres.map(escapeHtml).join(', ')}` : ''}${m.shared ? ` · ${Number(m.shared)} shared ${m.shared === 1 ? 'show' : 'shows'}` : ''}.</p>
      ${m.bothLove.length ? `<p>💞 You both love: ${titles(m.bothLove)}</p>` : ''}
      ${m.disagree.length ? `<p>⚔️ You disagree on: ${titles(m.disagree)}</p>` : ''}
    </div>`;
}

// "👥 12 followers · 3 following" plus a Follow button for a signed-in
// visitor on someone else's profile.
function followHTML(follows, username) {
  if (!follows) return '';
  const me = Auth.get().user;
  const own = me && me.username.toLowerCase() === username.toLowerCase();
  const counts = `<span class="stat-pill" id="follow-counts">👥 ${Number(follows.followers)} follower${follows.followers === 1 ? '' : 's'} · ${Number(follows.following)} following</span>`;
  const button = me && !own
    ? `<button class="chip follow-btn${follows.isFollowing ? ' is-following' : ''}" id="follow-btn" aria-pressed="${follows.isFollowing}">${follows.isFollowing ? '✓ Following' : '➕ Follow'}</button>`
    : '';
  return `<div class="hero-actions profile-actions profile-actions--12">${counts}${button}${own ? '<a href="#/feed" class="chip">👥 Friends’ Activity</a>' : ''}</div>`;
}

function wireFollow(root, username, follows) {
  const btn = root.querySelector('#follow-btn');
  if (!btn || !follows) return;
  let state = follows;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      state = state.isFollowing ? await Users.unfollow(username) : await Users.follow(username);
      btn.textContent = state.isFollowing ? '✓ Following' : '➕ Follow';
      btn.classList.toggle('is-following', state.isFollowing);
      btn.setAttribute('aria-pressed', String(state.isFollowing));
      const counts = root.querySelector('#follow-counts');
      if (counts) counts.textContent = `👥 ${Number(state.followers)} follower${state.followers === 1 ? '' : 's'} · ${Number(state.following)} following`;
      showToast(state.isFollowing ? `Following ${username}. Their activity shows in Friends’ Activity.` : `Unfollowed ${username}.`);
    } catch (err) {
      showToast(err.message || 'Something went wrong — try again.');
    } finally {
      btn.disabled = false;
    }
  });
}

// Public profiles show up to this many reviews, each enriched with the
// anime's title/poster via our own cached anime proxy (fine at this size —
// the reviews table only stores mal_id + rating + body, not a title/image).
const MAX_REVIEWS_SHOWN = 12;

function favCard(f) {
  const id = Number(f.mal_id) || 0;
  return `
    <article class="anime-card" data-id="${id}">
      <div class="poster-wrap">
        ${f.image ? `<img src="${escapeHtml(f.image)}" alt="${escapeHtml(f.title)}" loading="lazy" />` : ''}
        <span class="card-type">${escapeHtml(f.type || '?')}</span>
        <span class="card-score">★ ${f.score ? Number(f.score).toFixed(1) : '—'}</span>
      </div>
      <div class="card-body"><div class="card-title">${escapeHtml(f.title)}</div></div>
    </article>`;
}

// Taste dashboard: stat tiles, a watch-status bar (legend with counts, so it
// never relies on color alone) and top genres as labeled bars.
function dashboardHTML(favorites) {
  const st = profileStats(favorites);
  if (!st.total) return '';
  const tiles = [
    ['💖', st.total, 'Favorites'],
    ['✅', st.completionRate == null ? '—' : `${st.completionRate}%`, 'Completion rate'],
    ['⏱️', st.hoursWatched ? `${st.hoursWatched.toLocaleString()}h` : '—', `≈ time watched (${st.episodesWatched.toLocaleString()} eps)`],
    ['★', st.averageScore ?? '—', 'Avg score of favorites'],
  ];
  const segments = STATUS_ORDER.filter((s) => st.byStatus[s.value] > 0);
  const maxGenre = Math.max(1, ...st.topGenres.map(([, n]) => n));
  return `
    <section class="section">
      <div class="section-head"><h2 class="section-title">📊 Taste Dashboard</h2></div>
      <div class="stats-tiles">
        ${tiles.map(([emoji, value, label]) => `<div class="stats-tile"><strong>${emoji} ${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`).join('')}
      </div>
      <div class="dash-grid">
        ${st.tracked ? `
        <div class="dash-card">
          <h3 class="dash-heading">Watch status</h3>
          <div class="status-bar" role="img" aria-label="${segments.map((s) => `${s.label}: ${st.byStatus[s.value]}`).join(', ')}">
            ${segments.map((s) => `<span class="status-seg status-${s.value}" style="flex:${st.byStatus[s.value]}" title="${s.label}: ${st.byStatus[s.value]}"></span>`).join('')}
          </div>
          <ul class="status-legend">
            ${segments.map((s) => `<li><span class="status-swatch status-${s.value}"></span>${s.emoji} ${s.label} <strong>${st.byStatus[s.value]}</strong></li>`).join('')}
          </ul>
        </div>` : ''}
        ${st.topGenres.length ? `
        <div class="dash-card">
          <h3 class="dash-heading">Top genres</h3>
          <div class="genre-bars">
            ${st.topGenres.map(([g, n]) => `
              <div class="genre-bar" title="${escapeHtml(g)}: ${n}">
                <span class="genre-bar-label">${escapeHtml(g)}</span>
                <span class="genre-bar-track"><span class="genre-bar-fill" style="width:${Math.round((n / maxGenre) * 100)}%"></span></span>
                <span class="genre-bar-value">${n}</span>
              </div>`).join('')}
          </div>
          <p class="dash-note">From ${st.withGenres} of ${st.total} favorites (older saves fill in when re-saved).</p>
        </div>` : ''}
      </div>
    </section>`;
}

function reviewRowHTML(r, anime) {
  const date = new Date(r.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const title = anime?.title || `Anime #${r.mal_id}`;
  const img = anime ? imageOf(anime) : '';
  return `
    <a class="review-card review-row-link" href="#/anime/${r.mal_id}">
      ${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" class="review-row-cover" />` : ''}
      <div class="review-row-body">
        <div class="review-head">
          <span class="badge-score small">${r.rating}</span>
          <strong>${escapeHtml(title)}</strong>
          <span class="review-date">${escapeHtml(date)}</span>
        </div>
        ${r.body ? `<p class="review-body">${escapeHtml(r.body)}</p>` : ''}
      </div>
    </a>`;
}

function mangaReviewRowHTML(r, manga) {
  const date = new Date(r.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const img = mangaImg(manga?.coverImage);
  return `
    <a class="review-card review-row-link" href="#/manga/${encodeURIComponent(r.manga_id)}">
      ${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" class="review-row-cover" />` : ''}
      <div class="review-row-body">
        <div class="review-head">
          <span class="badge-score small">${r.rating}</span>
          <strong>${escapeHtml(manga?.title || 'A manga')}</strong>
          <span class="review-date">${escapeHtml(date)}</span>
        </div>
        ${r.body ? `<p class="review-body">${escapeHtml(r.body)}</p>` : ''}
      </div>
    </a>`;
}

export async function renderProfile(root, username) {
  root.innerHTML = skeletonDetail('Loading profile');
  let data;
  try {
    data = await Users.profile(username);
  } catch (err) {
    if (err.status === 404) {
      root.innerHTML = emptyHTML(`No user named "${username}" around here.`, '🔍');
      return;
    }
    root.innerHTML = errorHTML('Couldn’t load this profile — try again shortly!');
    wireRetry(root, () => renderProfile(root, username));
    return;
  }

  const { user, favorites, reviews, badges, xp } = data;
  const mangaReviews = data.mangaReviews || [];
  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : null;
  document.title = `${user.username} — AniNest`;

  if (data.private) {
    root.innerHTML = `
      <div class="account-page">
        <div class="account-avatar">${escapeHtml(user.username[0]?.toUpperCase() || '?')}</div>
        <h1 class="detail-title profile-name">${escapeHtml(user.username)}</h1>
        ${joined ? `<p class="section-sub">Member since ${escapeHtml(joined)}</p>` : ''}
        ${followHTML(data.follows, user.username)}
        ${xpCardHTML(xp)}
        ${badgesRowHTML(badges)}
      </div>
      ${emptyHTML(`${user.username} keeps their lists and reviews private.`, '🔒')}`;
    wireFollow(root, user.username, data.follows);
    return;
  }

  const shownReviews = reviews.slice(0, MAX_REVIEWS_SHOWN);
  const animeByMalId = new Map();
  await Promise.all(shownReviews.map(async (r) => {
    try {
      const { data: a } = await Api.fullById(r.mal_id);
      animeByMalId.set(r.mal_id, a);
    } catch { /* row falls back to "Anime #<id>" below */ }
  }));

  const shownMangaReviews = mangaReviews.slice(0, MAX_REVIEWS_SHOWN);
  const mangaById = new Map();
  await Promise.all(shownMangaReviews.map(async (r) => {
    try {
      const { data: m } = await MangaApi.byId(r.manga_id);
      mangaById.set(r.manga_id, m);
    } catch { /* row falls back to a generic title below */ }
  }));

  root.innerHTML = `
    <div class="account-page">
      <div class="account-avatar">${escapeHtml(user.username[0]?.toUpperCase() || '?')}</div>
      <h1 class="detail-title profile-name">${escapeHtml(user.username)}</h1>
      ${joined ? `<p class="section-sub">Member since ${escapeHtml(joined)}</p>` : ''}
      <div class="hero-actions profile-actions profile-actions--16">
        <span class="stat-pill">💖 ${favorites.length} favorite${favorites.length === 1 ? '' : 's'}</span>
        <span class="stat-pill">💬 ${reviews.length + mangaReviews.length} review${reviews.length + mangaReviews.length === 1 ? '' : 's'}</span>
      </div>
      ${followHTML(data.follows, user.username)}
      ${xpCardHTML(xp)}
      ${badgesRowHTML(badges)}
      <div class="hero-actions profile-actions"><a href="#/leaderboard/xp" class="chip">🏆 XP Leaderboard</a>${shareButtonHTML('📤 Share profile').replace('btn-pow btn-pow--outline', 'chip')}</div>
    </div>

    <div id="taste-match"></div>

    ${dashboardHTML(favorites)}

    <section class="section">
      <div class="section-head"><h2 class="section-title">💖 Favorites</h2></div>
      ${favorites.length ? `<div class="card-grid">${favorites.map(favCard).join('')}</div>` : emptyHTML('No favorites yet.', '💔')}
    </section>

    <div id="profile-lists"></div>

    <section class="section">
      <div class="section-head"><h2 class="section-title">💬 Reviews</h2></div>
      ${shownReviews.length
        ? shownReviews.map((r) => reviewRowHTML(r, animeByMalId.get(r.mal_id))).join('')
        : emptyHTML('No reviews yet.', '📝')}
    </section>

    ${shownMangaReviews.length ? `
    <section class="section">
      <div class="section-head"><h2 class="section-title">📖 Manga Reviews</h2></div>
      ${shownMangaReviews.map((r) => mangaReviewRowHTML(r, mangaById.get(r.manga_id))).join('')}
    </section>` : ''}
  `;
  wireShare(root, { kind: 'u', id: user.username, title: `${user.username} on AniNest` });
  wireFollow(root, user.username, data.follows);
  loadTasteMatch(root, user.username);
  loadProfileLists(root, user.username);
}

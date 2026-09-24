import { Users } from '../lib/usersApi.js';
import { Api, imageOf } from '../lib/api.js';
import { MangaApi } from '../lib/mangaApi.js';
import { mangaImg } from '../lib/mangaImage.js';
import { escapeHtml, loadingHTML, errorHTML, emptyHTML, wireRetry, badgesRowHTML, xpCardHTML } from '../lib/ui.js';

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

function reviewRowHTML(r, anime) {
  const date = new Date(r.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const title = anime?.title || `Anime #${r.mal_id}`;
  const img = anime ? imageOf(anime) : '';
  return `
    <a class="review-card" href="#/anime/${r.mal_id}" style="display:flex;gap:14px;text-decoration:none;color:inherit">
      ${img ? `<img src="${escapeHtml(img)}" alt="" style="width:56px;height:78px;object-fit:cover;border-radius:8px;border:2px solid var(--ink);flex-shrink:0" />` : ''}
      <div style="flex:1;min-width:0">
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
    <a class="review-card" href="#/manga/${encodeURIComponent(r.manga_id)}" style="display:flex;gap:14px;text-decoration:none;color:inherit">
      ${img ? `<img src="${escapeHtml(img)}" alt="" style="width:56px;height:78px;object-fit:cover;border-radius:8px;border:2px solid var(--ink);flex-shrink:0" />` : ''}
      <div style="flex:1;min-width:0">
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
  root.innerHTML = loadingHTML('LOADING PROFILE');
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
      <h1 class="detail-title" style="-webkit-text-stroke:0.5px var(--ink)">${escapeHtml(user.username)}</h1>
      ${joined ? `<p class="section-sub">Member since ${escapeHtml(joined)}</p>` : ''}
      <div class="hero-actions" style="justify-content:center;margin-top:16px">
        <span class="stat-pill">💖 ${favorites.length} favorite${favorites.length === 1 ? '' : 's'}</span>
        <span class="stat-pill">💬 ${reviews.length + mangaReviews.length} review${reviews.length + mangaReviews.length === 1 ? '' : 's'}</span>
      </div>
      ${xpCardHTML(xp)}
      ${badgesRowHTML(badges)}
      <div class="hero-actions" style="justify-content:center;margin-top:14px"><a href="#/leaderboard/xp" class="chip">🏆 XP Leaderboard</a></div>
    </div>

    <section class="section">
      <div class="section-head"><h2 class="section-title">💖 Favorites</h2></div>
      ${favorites.length ? `<div class="card-grid">${favorites.map(favCard).join('')}</div>` : emptyHTML('No favorites yet.', '💔')}
    </section>

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
}

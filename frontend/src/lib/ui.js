import { imageOf } from './api.js';
import { Favorites } from './store.js';
import { MangaFavorites } from './mangaStore.js';
import { mangaImg } from './mangaImage.js';
import { navigate } from './router.js';

// Shared between the detail page (setting a status) and the library page
// (filtering/displaying by it) so both use identical labels/emoji.
export const WATCH_STATUSES = [
  { value: 'watching', emoji: '👀', label: 'Watching' },
  { value: 'plan_to_watch', emoji: '📌', label: 'Plan to Watch' },
  { value: 'completed', emoji: '✅', label: 'Completed' },
  { value: 'dropped', emoji: '❌', label: 'Dropped' },
];

// Manga equivalent of WATCH_STATUSES, shared between mangaDetail.js and
// mangaFavorites.js.
export const READ_STATUSES = [
  { value: 'reading', emoji: '📖', label: 'Reading' },
  { value: 'plan_to_read', emoji: '📌', label: 'Plan to Read' },
  { value: 'completed', emoji: '✅', label: 'Completed' },
  { value: 'dropped', emoji: '❌', label: 'Dropped' },
];

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared between the public profile and the account page - both display
// the same server-computed badge list (see backend/src/lib/badges.js) the
// same way.
export function badgesRowHTML(badges) {
  if (!badges?.length) return '';
  return `<div class="badges-row">${badges.map((b) => `<span class="badge-pill badge-${b.tier}" title="${escapeHtml(b.desc)}">${b.emoji} ${escapeHtml(b.label)}</span>`).join('')}</div>`;
}

export function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 1800);
}

export function loadingHTML(label = 'LOADING...') {
  return `<div class="loading-wrap"><div class="pow-spinner">✦ ${escapeHtml(label)} ✦</div></div>`;
}

export function skeletonGrid(count = 12) {
  return `<div class="card-grid">${Array.from({ length: count }, () => `
    <div class="anime-card skeleton-card">
      <div class="poster-wrap skeleton-shimmer"></div>
      <div class="card-body">
        <div class="skeleton-line skeleton-shimmer"></div>
        <div class="skeleton-line skeleton-shimmer" style="width:60%"></div>
      </div>
    </div>`).join('')}</div>`;
}

export function skeletonRail(count = 8) {
  return `<div class="rail">${Array.from({ length: count }, () => `
    <div class="anime-card skeleton-card" style="flex:0 0 190px">
      <div class="poster-wrap skeleton-shimmer"></div>
      <div class="card-body">
        <div class="skeleton-line skeleton-shimmer"></div>
        <div class="skeleton-line skeleton-shimmer" style="width:60%"></div>
      </div>
    </div>`).join('')}</div>`;
}

export function errorHTML(msg = 'Something broke like a filler arc. Try again!') {
  return `<div class="error-box">💥 ${escapeHtml(msg)}<br/><button class="btn-pow btn-pow--sm" id="retry-btn" style="margin-top:14px">🔄 RETRY</button></div>`;
}

export function wireRetry(root, retryFn) {
  root.querySelector('#retry-btn')?.addEventListener('click', retryFn);
}

export function emptyHTML(msg = 'Nothing here yet.', emoji = '🍥') {
  return `<div class="empty-state"><span class="big-emoji">${emoji}</span>${escapeHtml(msg)}</div>`;
}

const GENRE_GRADIENTS = [
  'linear-gradient(135deg, #ff2d78, #7b2ff7)',
  'linear-gradient(135deg, #00d9ff, #7b2ff7)',
  'linear-gradient(135deg, #ffd23f, #ff7a1a)',
  'linear-gradient(135deg, #17e8a0, #00d9ff)',
  'linear-gradient(135deg, #ff7a1a, #ff2d78)',
  'linear-gradient(135deg, #7b2ff7, #ff6ec7)',
];
export function genreGradient(id) {
  return GENRE_GRADIENTS[id % GENRE_GRADIENTS.length];
}

export function animeCard(anime) {
  const img = imageOf(anime);
  const isFav = Favorites.has(anime.mal_id);
  const score = anime.score ? anime.score.toFixed(1) : '—';
  const meta = [anime.type, anime.episodes ? `${anime.episodes} ep` : null, anime.year || anime.aired?.prop?.from?.year]
    .filter(Boolean).join(' · ');
  const id = Number(anime.mal_id) || 0;
  return `
    <article class="anime-card" data-id="${id}" tabindex="0" role="link" aria-label="${escapeHtml(anime.title)}">
      <div class="poster-wrap">
        ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(anime.title)}" loading="lazy" />` : ''}
        <span class="card-type">${escapeHtml(anime.type || '?')}</span>
        <span class="card-score">★ ${score}</span>
        <button class="fav-btn ${isFav ? 'is-fav' : ''}" data-fav-id="${id}" aria-label="Toggle favorite" title="Favorite">${isFav ? '💖' : '🤍'}</button>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(anime.title)}</div>
        <div class="card-meta">${escapeHtml(meta || '')}</div>
      </div>
    </article>`;
}

// `renderer` defaults to animeCard so every existing call site is
// untouched; mangaBrowse.js/mangaDetail.js pass mangaCard instead. Pure
// CSS-wrapper layout with zero anime-specific logic, so this is extended
// rather than forked into a separate mangaCardGrid/mangaCardRail (avoids
// two near-identical layout helpers drifting apart over time).
export function cardGrid(list, renderer = animeCard) {
  if (!list || !list.length) return emptyHTML('No anime found. Try a different search!', '🔍');
  return `<div class="card-grid">${list.map(renderer).join('')}</div>`;
}

export function cardRail(list, renderer = animeCard) {
  if (!list || !list.length) return emptyHTML();
  return `<div class="rail">${list.map(renderer).join('')}</div>`;
}

export function mangaCard(manga) {
  const img = mangaImg(manga.image !== undefined ? manga.image : (manga.coverImage || ''));
  const isFav = MangaFavorites.has(manga.id);
  const meta = [manga.format, manga.status, manga.year].filter(Boolean).join(' · ');
  const id = manga.id || '';
  return `
    <article class="manga-card" data-manga-id="${escapeHtml(id)}" tabindex="0" role="link" aria-label="${escapeHtml(manga.title)}">
      <div class="poster-wrap">
        ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(manga.title)}" loading="lazy" />` : ''}
        <span class="card-type">${escapeHtml(manga.demographic || 'Manga')}</span>
        <button class="fav-btn ${isFav ? 'is-fav' : ''}" data-manga-fav-id="${escapeHtml(id)}" aria-label="Toggle favorite" title="Favorite">${isFav ? '💖' : '🤍'}</button>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(manga.title)}</div>
        <div class="card-meta">${escapeHtml(meta || '')}</div>
      </div>
    </article>`;
}

// Event delegation: click a card -> navigate; click fav button -> toggle (and stop propagation).
export function wireCardEvents(container, { onOpen } = {}) {
  container.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav-id]');
    if (favBtn) {
      e.stopPropagation();
      const card = favBtn.closest('.anime-card');
      const id = Number(favBtn.dataset.favId);
      const title = card?.querySelector('.card-title')?.textContent || '';
      const img = card?.querySelector('img')?.getAttribute('src') || '';
      const scoreText = card?.querySelector('.card-score')?.textContent.replace('★', '').trim();
      const anime = {
        mal_id: id,
        title,
        images: { jpg: { image_url: img }, webp: { image_url: img } },
        score: scoreText && scoreText !== '—' ? Number(scoreText) : undefined,
        type: card?.querySelector('.card-type')?.textContent,
      };

      // Optimistic flip so the heart feels instant; reconciled below once the
      // store confirms (or rejects) the change.
      const wasFav = favBtn.classList.contains('is-fav');
      favBtn.textContent = wasFav ? '🤍' : '💖';
      favBtn.classList.toggle('is-fav', !wasFav);

      Favorites.toggle(anime).then((result) => {
        if (result.needsLogin) {
          favBtn.textContent = wasFav ? '💖' : '🤍';
          favBtn.classList.toggle('is-fav', wasFav);
          showToast('Log in to save favorites!');
          navigate('#/login');
          return;
        }
        favBtn.textContent = result.isFav ? '💖' : '🤍';
        favBtn.classList.toggle('is-fav', result.isFav);
        if (result.ok) {
          showToast(result.isFav ? `Added "${title}" to favorites!` : `Removed "${title}" from favorites.`);
        } else {
          showToast('Something went wrong — try again.');
        }
      });
      return;
    }
    const card = e.target.closest('.anime-card');
    if (card) {
      if (onOpen) onOpen(Number(card.dataset.id));
      else window.location.hash = `#/anime/${card.dataset.id}`;
    }
  });
}

// Manga equivalent of wireCardEvents - kept as its own separate function
// rather than a generalization of it, since wireCardEvents is hard-wired
// to Favorites/mal_id/#/anime/:id and forcing it to branch on content type
// would tangle two unrelated stores into one function.
export function wireMangaCardEvents(container, { onOpen } = {}) {
  container.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-manga-fav-id]');
    if (favBtn) {
      e.stopPropagation();
      const card = favBtn.closest('.manga-card');
      const id = favBtn.dataset.mangaFavId;
      const title = card?.querySelector('.card-title')?.textContent || '';
      const img = card?.querySelector('img')?.getAttribute('src') || '';
      const manga = { id, title, coverImage: img };

      const wasFav = favBtn.classList.contains('is-fav');
      favBtn.textContent = wasFav ? '🤍' : '💖';
      favBtn.classList.toggle('is-fav', !wasFav);

      MangaFavorites.toggle(manga).then((result) => {
        if (result.needsLogin) {
          favBtn.textContent = wasFav ? '💖' : '🤍';
          favBtn.classList.toggle('is-fav', wasFav);
          showToast('Log in to save favorites!');
          navigate('#/login');
          return;
        }
        favBtn.textContent = result.isFav ? '💖' : '🤍';
        favBtn.classList.toggle('is-fav', result.isFav);
        if (result.ok) {
          showToast(result.isFav ? `Added "${title}" to favorites!` : `Removed "${title}" from favorites.`);
        } else {
          showToast('Something went wrong — try again.');
        }
      });
      return;
    }
    const card = e.target.closest('.manga-card');
    if (card) {
      if (onOpen) onOpen(card.dataset.mangaId);
      else window.location.hash = `#/manga/${card.dataset.mangaId}`;
    }
  });
}

export function updateFavCount() {
  const el = document.getElementById('fav-count');
  if (el) el.textContent = Favorites.count();
}

export function updateMangaFavCount() {
  const el = document.getElementById('manga-fav-count');
  if (el) el.textContent = MangaFavorites.count();
}

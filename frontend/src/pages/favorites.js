import { Favorites } from '../lib/store.js';
import { Auth } from '../lib/authStore.js';
import { emptyHTML, escapeHtml, skeletonGrid } from '../lib/ui.js';

function favCard(f) {
  const id = Number(f.mal_id) || 0;
  return `
    <article class="anime-card" data-id="${id}">
      <div class="poster-wrap">
        ${f.image ? `<img src="${escapeHtml(f.image)}" alt="${escapeHtml(f.title)}" loading="lazy" />` : ''}
        <span class="card-type">${escapeHtml(f.type || '?')}</span>
        <span class="card-score">★ ${f.score ? f.score.toFixed(1) : '—'}</span>
        <button class="fav-btn is-fav" data-fav-id="${id}" title="Remove favorite">💖</button>
      </div>
      <div class="card-body"><div class="card-title">${escapeHtml(f.title)}</div></div>
    </article>`;
}

export async function renderFavorites(root) {
  if (!Auth.get().user) {
    root.innerHTML = `
      <div class="empty-state">
        <span class="big-emoji">🔒</span>
        Log in to save and sync your favorites.
        <div class="hero-actions" style="justify-content:center;margin-top:16px">
          <a href="#/login" class="btn-pow btn-pow--pink">LOG IN</a>
          <a href="#/register" class="btn-pow btn-pow--outline">CREATE ACCOUNT</a>
        </div>
      </div>`;
    return;
  }

  if (!Favorites.isLoaded()) {
    root.innerHTML = `<div class="section-head"><h2 class="section-title">💖 Your Favorites</h2></div>${skeletonGrid(6)}`;
    await Favorites.loadFromServer();
  }

  const all = Object.values(Favorites.all());
  root.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">💖 Your Favorites</h2>
      <span class="section-sub">${all.length} saved</span>
    </div>
    ${all.length ? `<div class="card-grid">${all.map(favCard).join('')}</div>` : emptyHTML('No favorites yet — go heart some anime!', '💔')}
  `;
}

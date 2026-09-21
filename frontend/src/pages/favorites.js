import { Favorites } from '../lib/store.js';
import { Auth } from '../lib/authStore.js';
import { emptyHTML, escapeHtml, skeletonGrid, WATCH_STATUSES } from '../lib/ui.js';

const FILTERS = [
  { value: 'all', emoji: '📚', label: 'All' },
  ...WATCH_STATUSES,
  { value: 'none', emoji: '🤍', label: 'No Status' },
];

// Persisted at module scope (not reset per render) so re-renders triggered
// by Favorites.subscribe() - e.g. after toggling a heart elsewhere - don't
// silently snap the filter back to "All".
let activeFilter = 'all';

function statusBadge(status) {
  const meta = WATCH_STATUSES.find((s) => s.value === status);
  return meta ? `<span class="card-status">${meta.emoji} ${escapeHtml(meta.label)}</span>` : '';
}

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
      <div class="card-body">
        <div class="card-title">${escapeHtml(f.title)}</div>
        ${statusBadge(f.status)}
      </div>
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
  const counts = { all: all.length, none: 0 };
  WATCH_STATUSES.forEach((s) => { counts[s.value] = 0; });
  all.forEach((f) => {
    if (f.status) counts[f.status] = (counts[f.status] || 0) + 1;
    else counts.none += 1;
  });

  const filtered = activeFilter === 'all'
    ? all
    : activeFilter === 'none'
      ? all.filter((f) => !f.status)
      : all.filter((f) => f.status === activeFilter);

  root.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">💖 Your Favorites</h2>
      <span class="section-sub">${all.length} saved</span>
      ${all.length ? '<a href="#/tier-list" class="chip">🏆 Make a Tier List</a>' : ''}
    </div>
    <div class="library-tabs">
      ${FILTERS.map((f) => `<button class="library-tab ${activeFilter === f.value ? 'is-active' : ''}" data-filter="${f.value}">${f.emoji} ${escapeHtml(f.label)} (${counts[f.value] || 0})</button>`).join('')}
    </div>
    ${filtered.length ? `<div class="card-grid">${filtered.map(favCard).join('')}` + '</div>' : emptyHTML(activeFilter === 'all' ? 'No favorites yet — go heart some anime!' : 'Nothing in this list yet.', '💔')}
  `;

  root.querySelectorAll('.library-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderFavorites(root);
    });
  });
}

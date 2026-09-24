import { MangaFavorites } from '../lib/mangaStore.js';
import { Auth } from '../lib/authStore.js';
import { mangaImg } from '../lib/mangaImage.js';
import { emptyHTML, escapeHtml, skeletonGrid, READ_STATUSES } from '../lib/ui.js';

const FILTERS = [
  { value: 'all', emoji: '📚', label: 'All' },
  ...READ_STATUSES,
  { value: 'none', emoji: '🤍', label: 'No Status' },
];

// Persisted at module scope (not reset per render) so re-renders triggered
// by MangaFavorites.subscribe() don't silently snap the filter back to "All".
let activeFilter = 'all';

function statusBadge(status) {
  const meta = READ_STATUSES.find((s) => s.value === status);
  return meta ? `<span class="card-status">${meta.emoji} ${escapeHtml(meta.label)}</span>` : '';
}

function favCard(f) {
  const id = f.manga_id;
  return `
    <article class="manga-card" data-manga-id="${escapeHtml(id)}">
      <div class="poster-wrap">
        ${f.image ? `<img src="${escapeHtml(mangaImg(f.image))}" alt="${escapeHtml(f.title)}" loading="lazy" />` : ''}
        <span class="card-type">${escapeHtml(f.format || 'Manga')}</span>
        <button class="fav-btn is-fav" data-manga-fav-id="${escapeHtml(id)}" title="Remove favorite">💖</button>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(f.title)}</div>
        ${statusBadge(f.status)}
      </div>
    </article>`;
}

export async function renderMangaFavorites(root) {
  if (!Auth.get().user) {
    root.innerHTML = `
      <div class="empty-state">
        <span class="big-emoji">🔒</span>
        Log in to save and sync your reading list.
        <div class="hero-actions" style="justify-content:center;margin-top:16px">
          <a href="#/login" class="btn-pow btn-pow--pink">LOG IN</a>
          <a href="#/register" class="btn-pow btn-pow--outline">CREATE ACCOUNT</a>
        </div>
      </div>`;
    return;
  }

  if (!MangaFavorites.isLoaded()) {
    root.innerHTML = `<div class="section-head"><h2 class="section-title">📖 Your Manga</h2></div>${skeletonGrid(6)}`;
    await MangaFavorites.loadFromServer();
  }

  const all = Object.values(MangaFavorites.all());
  const counts = { all: all.length, none: 0 };
  READ_STATUSES.forEach((s) => { counts[s.value] = 0; });
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
      <h2 class="section-title">📖 Your Manga</h2>
      <span class="section-sub">${all.length} saved</span>
    </div>
    <div class="library-tabs">
      ${FILTERS.map((f) => `<button class="library-tab ${activeFilter === f.value ? 'is-active' : ''}" data-filter="${f.value}">${f.emoji} ${escapeHtml(f.label)} (${counts[f.value] || 0})</button>`).join('')}
    </div>
    ${filtered.length ? `<div class="card-grid">${filtered.map(favCard).join('')}` + '</div>' : emptyHTML(activeFilter === 'all' ? 'No manga yet — go heart some titles!' : 'Nothing in this list yet.', '💔')}
  `;

  root.querySelectorAll('.library-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderMangaFavorites(root);
    });
  });
}

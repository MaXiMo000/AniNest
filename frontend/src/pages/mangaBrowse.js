import { MangaApi } from '../lib/mangaApi.js';
import { cardGrid, mangaCard, skeletonGrid, errorHTML, escapeHtml, wireRetry } from '../lib/ui.js';
import { navigate } from '../lib/router.js';

let tagsCache = null;
async function getTags() {
  if (tagsCache) return tagsCache;
  const { data } = await MangaApi.tags();
  tagsCache = data;
  return tagsCache;
}

function buildQueryString(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.tags.length) p.set('tags', state.tags.join(','));
  if (state.demographic) p.set('demographic', state.demographic);
  if (state.status) p.set('status', state.status);
  if (state.sort && state.sort !== 'popular') p.set('sort', state.sort);
  if (state.page && state.page !== 1) p.set('page', state.page);
  return p.toString();
}

function parseState(params) {
  return {
    q: params.get('q') || '',
    tags: (params.get('tags') || '').split(',').filter(Boolean),
    demographic: params.get('demographic') || '',
    status: params.get('status') || '',
    sort: params.get('sort') || 'popular',
    page: Number(params.get('page') || 1),
  };
}

function toolbarHTML(state, tagsList) {
  const sortOptions = [
    ['popular', '🔥 Most Followed'],
    ['latest', '🆕 Recently Updated'],
    ['newest', '✨ Newest Added'],
    ['title', '🔤 A–Z'],
  ];
  const demographicOptions = [
    ['', 'Any Demographic'], ['shounen', 'Shounen'], ['shoujo', 'Shoujo'], ['seinen', 'Seinen'], ['josei', 'Josei'],
  ];
  const statusOptions = [
    ['', 'Any Status'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus'], ['cancelled', 'Cancelled'],
  ];

  return `
    <div class="toolbar">
      <label class="toolbar-label" for="f-sort">Sort</label>
      <select id="f-sort">
        ${sortOptions.map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>

      <label class="toolbar-label" for="f-demographic">Demographic</label>
      <select id="f-demographic">
        ${demographicOptions.map(([v, l]) => `<option value="${v}" ${state.demographic === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>

      <label class="toolbar-label" for="f-status">Status</label>
      <select id="f-status">
        ${statusOptions.map(([v, l]) => `<option value="${v}" ${state.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>

      ${state.q ? `<span class="chip active">🔍 "${escapeHtml(state.q)}" <span id="clear-q" style="cursor:pointer">✕</span></span>` : ''}
      ${state.tags.length || state.demographic || state.status || state.q || state.sort !== 'popular'
        ? `<button class="chip" id="clear-filters">✕ Clear All</button>` : ''}
    </div>
    <div class="genre-filter-list" id="tag-filter-list">
      ${tagsList.map((t) => `
        <button class="chip ${state.tags.includes(t.id) ? 'active' : ''}" data-tag="${escapeHtml(t.id)}">${escapeHtml(t.name)}</button>
      `).join('')}
    </div>
  `;
}

function paginationHTML(state, hasNext) {
  return `
    <div class="pagination">
      <button class="btn-pow btn-pow--sm" id="prev-page" ${state.page <= 1 ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>◀ PREV</button>
      <span>PAGE ${state.page}</span>
      <button class="btn-pow btn-pow--sm" id="next-page" ${hasNext ? '' : 'disabled style="opacity:.4;cursor:not-allowed"'}>NEXT ▶</button>
    </div>`;
}

export async function renderMangaBrowse(root, params) {
  document.title = 'Browse Manga — AniNest';
  const state = parseState(params);
  root.innerHTML = `<div class="section-head"><h2 class="section-title">📖 Browse Manga</h2></div>${skeletonGrid(18)}`;

  try {
    const tagsList = await getTags();
    const res = await MangaApi.search({
      q: state.q || undefined,
      tags: state.tags.join(',') || undefined,
      demographic: state.demographic || undefined,
      status: state.status || undefined,
      sort: state.sort !== 'popular' ? state.sort : undefined,
      page: state.page,
    });
    const list = res.data || [];
    const hasNext = (state.page * 20) < (res.total || 0);

    root.innerHTML = `
      <div class="section-head">
        <h2 class="section-title">📖 Browse Manga</h2>
        <span class="section-sub">${list.length ? `Showing ${list.length} results` : ''}</span>
      </div>
      ${toolbarHTML(state, tagsList)}
      ${cardGrid(list, mangaCard)}
      ${list.length ? paginationHTML(state, hasNext) : ''}
    `;

    const goto = (patch) => navigate('#/manga?' + buildQueryString({ ...state, page: 1, ...patch }));

    root.querySelector('#f-sort')?.addEventListener('change', (e) => goto({ sort: e.target.value }));
    root.querySelector('#f-demographic')?.addEventListener('change', (e) => goto({ demographic: e.target.value }));
    root.querySelector('#f-status')?.addEventListener('change', (e) => goto({ status: e.target.value }));
    root.querySelector('#clear-q')?.addEventListener('click', () => goto({ q: '' }));
    root.querySelector('#clear-filters')?.addEventListener('click', () => navigate('#/manga'));
    root.querySelectorAll('[data-tag]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.tag;
        const has = state.tags.includes(id);
        const nextTags = has ? state.tags.filter((t) => t !== id) : [...state.tags, id];
        navigate('#/manga?' + buildQueryString({ ...state, page: 1, tags: nextTags }));
      });
    });
    root.querySelector('#prev-page')?.addEventListener('click', () => {
      if (state.page > 1) navigate('#/manga?' + buildQueryString({ ...state, page: state.page - 1 }));
    });
    root.querySelector('#next-page')?.addEventListener('click', () => {
      if (hasNext) navigate('#/manga?' + buildQueryString({ ...state, page: state.page + 1 }));
    });
  } catch (err) {
    console.error(err);
    root.innerHTML = errorHTML('The search jutsu failed. The API might be busy — try again in a moment!');
    wireRetry(root, () => renderMangaBrowse(root, params));
  }
}

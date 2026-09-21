import { Api } from '../lib/api.js';
import { cardGrid, skeletonGrid, errorHTML, escapeHtml, wireRetry } from '../lib/ui.js';
import { navigate } from '../lib/router.js';

const EXCLUDED_GENRE_IDS = new Set([12, 9, 49]); // Hentai, Ecchi, Erotica — keep the site SFW

let genreCache = null;
async function getGenres() {
  if (genreCache) return genreCache;
  const { data } = await Api.genres();
  genreCache = data.filter((g) => !EXCLUDED_GENRE_IDS.has(g.mal_id));
  return genreCache;
}

function buildQueryString(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.genres.length) p.set('genre', state.genres.join(','));
  if (state.type) p.set('type', state.type);
  if (state.status) p.set('status', state.status);
  if (state.sort && state.sort !== 'popular') p.set('sort', state.sort);
  if (state.minScore) p.set('min', state.minScore);
  if (state.page && state.page !== 1) p.set('page', state.page);
  return p.toString();
}

function parseState(params) {
  return {
    q: params.get('q') || '',
    genres: (params.get('genre') || '').split(',').filter(Boolean).map(Number),
    type: params.get('type') || '',
    status: params.get('status') || '',
    sort: params.get('sort') || 'popular',
    minScore: Number(params.get('min')) || 0,
    page: Number(params.get('page') || 1),
  };
}

function toolbarHTML(state, genresList) {
  const sortOptions = [
    ['popular', '🔥 Most Popular'],
    ['top', '🏆 Highest Rated'],
    ['season', '📅 This Season'],
    ['newest', '🆕 Newest'],
    ['title', '🔤 A–Z'],
  ];
  const typeOptions = ['', 'tv', 'movie', 'ova', 'special', 'ona', 'music'];
  const statusOptions = [
    ['', 'Any Status'], ['airing', 'Airing'], ['complete', 'Completed'], ['upcoming', 'Upcoming'],
  ];

  return `
    <div class="toolbar">
      <span class="toolbar-label">Sort</span>
      <select id="f-sort">
        ${sortOptions.map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>

      <span class="toolbar-label">Type</span>
      <select id="f-type">
        ${typeOptions.map((v) => `<option value="${v}" ${state.type === v ? 'selected' : ''}>${v ? v.toUpperCase() : 'Any Type'}</option>`).join('')}
      </select>

      <span class="toolbar-label">Status</span>
      <select id="f-status">
        ${statusOptions.map(([v, l]) => `<option value="${v}" ${state.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>

      <span class="toolbar-label">Min Score</span>
      <div class="minscore-slider">
        <input type="range" id="f-minscore" min="0" max="9" step="0.5" value="${state.minScore || 0}" />
        <span id="minscore-value">${state.minScore ? `★ ${state.minScore.toFixed(1)}+` : 'Any'}</span>
      </div>

      ${state.q ? `<span class="chip active">🔍 "${escapeHtml(state.q)}" <span id="clear-q" style="cursor:pointer">✕</span></span>` : ''}
      ${state.genres.length || state.type || state.status || state.sort !== 'popular' || state.q || state.minScore
        ? `<button class="chip" id="clear-filters">✕ Clear All</button>` : ''}
    </div>
    <div class="genre-filter-list" id="genre-filter-list">
      ${genresList.slice(0, 22).map((g) => `
        <button class="chip ${state.genres.includes(g.mal_id) ? 'active' : ''}" data-genre="${Number(g.mal_id) || 0}">${escapeHtml(g.name)}</button>
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

export async function renderBrowse(root, params) {
  const state = parseState(params);
  root.innerHTML = `<div class="section-head"><h2 class="section-title">🧭 Browse Anime</h2></div>${skeletonGrid(18)}`;

  try {
    const genresList = await getGenres();
    let list = [];
    let hasNext = false;
    let titleLabel = 'Browse Anime';

    if (state.sort === 'season') {
      const res = await Api.seasonNow(state.page);
      // seasonNow has no server-side min-score support (unlike search) -
      // filtering client-side here is simpler than adding a param to a
      // second endpoint just for this one Browse tab.
      list = state.minScore ? (res.data || []).filter((a) => (a.score || 0) >= state.minScore) : (res.data || []);
      hasNext = Boolean(res.pagination?.has_next_page);
      titleLabel = 'This Season';
    } else {
      const orderMap = {
        popular: { order_by: 'popularity', sort: 'asc' },
        top: { order_by: 'score', sort: 'desc' },
        newest: { order_by: 'start_date', sort: 'desc' },
        title: { order_by: 'title', sort: 'asc' },
      };
      const order = orderMap[state.sort] || orderMap.popular;
      const res = await Api.search({
        q: state.q || undefined,
        genres: state.genres.join(',') || undefined,
        type: state.type || undefined,
        status: state.status || undefined,
        order_by: order.order_by,
        sort: order.sort,
        min_score: state.minScore || undefined,
        page: state.page,
        sfw: true,
      });
      list = res.data || [];
      hasNext = Boolean(res.pagination?.has_next_page);
    }

    root.innerHTML = `
      <div class="section-head">
        <h2 class="section-title">🧭 ${escapeHtml(titleLabel)}</h2>
        <span class="section-sub">${list.length ? `Showing ${list.length} results` : ''}</span>
        <a href="#/screenshot-search" class="chip">📸 Search by screenshot</a>
      </div>
      ${toolbarHTML(state, genresList)}
      ${cardGrid(list)}
      ${list.length ? paginationHTML(state, hasNext) : ''}
    `;

    const goto = (patch) => navigate('#/browse?' + buildQueryString({ ...state, page: 1, ...patch }));

    root.querySelector('#f-sort')?.addEventListener('change', (e) => goto({ sort: e.target.value }));
    root.querySelector('#f-type')?.addEventListener('change', (e) => goto({ type: e.target.value }));
    root.querySelector('#f-status')?.addEventListener('change', (e) => goto({ status: e.target.value }));
    const minScoreSlider = root.querySelector('#f-minscore');
    const minScoreValue = root.querySelector('#minscore-value');
    minScoreSlider?.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      minScoreValue.textContent = v ? `★ ${v.toFixed(1)}+` : 'Any';
    });
    minScoreSlider?.addEventListener('change', (e) => goto({ minScore: Number(e.target.value) }));
    root.querySelector('#clear-q')?.addEventListener('click', () => goto({ q: '' }));
    root.querySelector('#clear-filters')?.addEventListener('click', () => navigate('#/browse'));
    root.querySelectorAll('[data-genre]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = Number(chip.dataset.genre);
        const has = state.genres.includes(id);
        const nextGenres = has ? state.genres.filter((g) => g !== id) : [...state.genres, id];
        navigate('#/browse?' + buildQueryString({ ...state, page: 1, genres: nextGenres }));
      });
    });
    root.querySelector('#prev-page')?.addEventListener('click', () => {
      if (state.page > 1) navigate('#/browse?' + buildQueryString({ ...state, page: state.page - 1 }));
    });
    root.querySelector('#next-page')?.addEventListener('click', () => {
      if (hasNext) navigate('#/browse?' + buildQueryString({ ...state, page: state.page + 1 }));
    });
  } catch (err) {
    console.error(err);
    root.innerHTML = errorHTML('The search jutsu failed. The API might be busy — try again in a moment!');
    wireRetry(root, () => renderBrowse(root, params));
  }
}

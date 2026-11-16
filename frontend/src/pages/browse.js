import { Api } from '../lib/api.js';
import { cardGrid, skeletonGrid, errorHTML, escapeHtml, wireRetry } from '../lib/ui.js';
import { navigate } from '../lib/router.js';
import { filterPanelHTML, selectHTML, setResultCount, wireFilterPanel, yearOptions } from '../lib/filters.js';

const EXCLUDED_GENRE_IDS = new Set([12, 9, 49]); // Hentai, Ecchi, Erotica — keep the site SFW

let genreCache = null;
async function getGenres() {
  if (genreCache) return genreCache;
  const { data } = await Api.genres();
  genreCache = data.filter((g) => !EXCLUDED_GENRE_IDS.has(g.mal_id));
  return genreCache;
}

const SORTS = [['popular', '🔥 Most Popular'], ['top', '🏆 Highest Rated'], ['season', '📅 This Season'], ['newest', '🆕 Newest'], ['title', '🔤 A–Z']];
const TYPES = [['', 'Any Type'], ['tv', 'TV'], ['movie', 'Movie'], ['ova', 'OVA'], ['special', 'Special'], ['ona', 'ONA'], ['music', 'Music']];
const STATUSES = [['', 'Any Status'], ['airing', 'Airing'], ['complete', 'Completed'], ['upcoming', 'Upcoming']];
const SEASONS = [['', 'Any Season'], ['winter', '❄️ Winter'], ['spring', '🌸 Spring'], ['summer', '☀️ Summer'], ['fall', '🍂 Fall']];
const YEARS = yearOptions(1960);

function buildQueryString(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.genres.length) p.set('genre', state.genres.join(','));
  for (const k of ['type', 'status', 'year', 'season']) if (state[k]) p.set(k, state[k]);
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
    year: params.get('year') || '',
    season: params.get('year') ? params.get('season') || '' : '',
    sort: params.get('sort') || 'popular',
    minScore: Number(params.get('min')) || 0,
    page: Number(params.get('page') || 1),
  };
}

const labelOf = (opts, v) => opts.find(([k]) => String(k) === String(v))?.[1] || v;

function panelHTML(state, genresList) {
  const href = (patch) => `#/browse?${buildQueryString({ ...state, page: 1, ...patch })}`;
  const thisSeason = state.sort === 'season';
  const active = [
    state.q && { label: `🔍 “${state.q}”`, href: href({ q: '' }) },
    state.sort !== 'popular' && { label: labelOf(SORTS, state.sort), href: href({ sort: 'popular' }) },
    state.type && { label: labelOf(TYPES, state.type), href: href({ type: '' }) },
    state.status && { label: labelOf(STATUSES, state.status), href: href({ status: '' }) },
    state.year && { label: state.season ? `${labelOf(SEASONS, state.season)} ${state.year}` : String(state.year), href: href({ year: '', season: '' }) },
    state.minScore && { label: `★ ${state.minScore.toFixed(1)}+`, href: href({ minScore: 0 }) },
    ...state.genres.map((id) => ({ label: genresList.find((g) => g.mal_id === id)?.name || 'Genre', href: href({ genres: state.genres.filter((g) => g !== id) }) })),
  ].filter(Boolean);
  // "This Season" is its own list: only the score filter applies to it.
  const controls = [
    selectHTML('f-sort', 'Sort', SORTS, state.sort),
    thisSeason ? '' : selectHTML('f-type', 'Type', TYPES, state.type),
    thisSeason ? '' : selectHTML('f-status', 'Status', STATUSES, state.status),
    thisSeason ? '' : selectHTML('f-year', 'Year', YEARS, state.year),
    thisSeason ? '' : selectHTML('f-season', 'Season', SEASONS, state.season),
    `<label class="toolbar-label" for="f-minscore">Min Score</label>
     <div class="minscore-slider">
       <input type="range" id="f-minscore" min="0" max="9" step="0.5" value="${state.minScore || 0}" />
       <span id="minscore-value">${state.minScore ? `★ ${state.minScore.toFixed(1)}+` : 'Any'}</span>
     </div>`,
  ].join('');
  const genres = thisSeason ? '' : `
    <div class="genre-filter-list" id="genre-filter-list" aria-label="Genres (pick several to narrow down)">
      ${genresList.slice(0, 22).map((g) => `<button class="chip ${state.genres.includes(g.mal_id) ? 'active' : ''}" data-genre="${Number(g.mal_id) || 0}" aria-pressed="${state.genres.includes(g.mal_id)}">${escapeHtml(g.name)}</button>`).join('')}
    </div>`;
  return filterPanelHTML(controls, active, '#/browse', genres);
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
  document.title = 'Browse Anime — AniNest';
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
        year: state.year || undefined,
        season: state.season || undefined,
        page: state.page,
        sfw: true,
      });
      list = res.data || [];
      hasNext = Boolean(res.pagination?.has_next_page);
    }

    root.innerHTML = `
      <div class="section-head">
        <h2 class="section-title">🧭 ${escapeHtml(titleLabel)}</h2>
        <a href="#/vibe" class="chip">✨ Search by vibe</a>
        <a href="#/screenshot-search" class="chip">📸 Search by screenshot</a>
      </div>
      ${panelHTML(state, genresList)}
      ${cardGrid(list)}
      ${list.length ? paginationHTML(state, hasNext) : ''}
    `;
    wireFilterPanel(root);
    setResultCount(root, list.length ? `Page ${state.page} · ${list.length} shown${hasNext ? ', more on the next page' : ''}` : 'Nothing matches all of these. Try removing one.');

    const goto = (patch) => navigate('#/browse?' + buildQueryString({ ...state, page: 1, ...patch }));

    root.querySelector('#f-sort')?.addEventListener('change', (e) => goto({ sort: e.target.value }));
    root.querySelector('#f-type')?.addEventListener('change', (e) => goto({ type: e.target.value }));
    root.querySelector('#f-status')?.addEventListener('change', (e) => goto({ status: e.target.value }));
    root.querySelector('#f-year')?.addEventListener('change', (e) => goto({ year: e.target.value, season: e.target.value ? state.season : '' }));
    // A season needs a year: picking one on its own uses this year.
    root.querySelector('#f-season')?.addEventListener('change', (e) => goto({ season: e.target.value, year: state.year || (e.target.value ? new Date().getFullYear() : '') }));
    const minScoreSlider = root.querySelector('#f-minscore');
    const minScoreValue = root.querySelector('#minscore-value');
    minScoreSlider?.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      minScoreValue.textContent = v ? `★ ${v.toFixed(1)}+` : 'Any';
    });
    minScoreSlider?.addEventListener('change', (e) => goto({ minScore: Number(e.target.value) }));
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

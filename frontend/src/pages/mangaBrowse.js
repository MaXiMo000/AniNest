import { MangaApi } from '../lib/mangaApi.js';
import { cardGrid, mangaCard, skeletonGrid, errorHTML, escapeHtml, wireRetry } from '../lib/ui.js';
import { navigate } from '../lib/router.js';
import { filterPanelHTML, selectHTML, setResultCount, wireFilterPanel, yearOptions } from '../lib/filters.js';

let tagsCache = null;
async function getTags() {
  if (tagsCache) return tagsCache;
  const { data } = await MangaApi.tags();
  tagsCache = data;
  return tagsCache;
}

const SORTS = [['popular', '🔥 Most Followed'], ['latest', '🆕 Recently Updated'], ['newest', '✨ Newest Added'], ['title', '🔤 A–Z']];
const DEMOGRAPHICS = [['', 'Any Demographic'], ['shounen', 'Shounen'], ['shoujo', 'Shoujo'], ['seinen', 'Seinen'], ['josei', 'Josei']];
const STATUSES = [['', 'Any Status'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus'], ['cancelled', 'Cancelled']];
const ORIGINS = [['', 'Any Origin'], ['ja', 'Manga (Japan)'], ['ko', 'Manhwa (Korea)'], ['zh', 'Manhua (China)']];
const YEARS = yearOptions(1950);

function buildQueryString(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.tags.length) p.set('tags', state.tags.join(','));
  for (const k of ['demographic', 'status', 'origin', 'year']) if (state[k]) p.set(k, state[k]);
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
    origin: params.get('origin') || '',
    year: params.get('year') || '',
    sort: params.get('sort') || 'popular',
    page: Number(params.get('page') || 1),
  };
}

const labelOf = (opts, v) => opts.find(([k]) => String(k) === String(v))?.[1] || v;

function panelHTML(state, tagsList) {
  const href = (patch) => `#/manga?${buildQueryString({ ...state, page: 1, ...patch })}`;
  const active = [
    state.q && { label: `🔍 “${state.q}”`, href: href({ q: '' }) },
    state.sort !== 'popular' && { label: labelOf(SORTS, state.sort), href: href({ sort: 'popular' }) },
    state.origin && { label: labelOf(ORIGINS, state.origin), href: href({ origin: '' }) },
    state.demographic && { label: labelOf(DEMOGRAPHICS, state.demographic), href: href({ demographic: '' }) },
    state.status && { label: labelOf(STATUSES, state.status), href: href({ status: '' }) },
    state.year && { label: String(state.year), href: href({ year: '' }) },
    ...state.tags.map((id) => ({ label: tagsList.find((t) => t.id === id)?.name || 'Tag', href: href({ tags: state.tags.filter((t) => t !== id) }) })),
  ].filter(Boolean);
  const controls = [
    selectHTML('f-sort', 'Sort', SORTS, state.sort),
    selectHTML('f-origin', 'Origin', ORIGINS, state.origin),
    selectHTML('f-demographic', 'Demographic', DEMOGRAPHICS, state.demographic),
    selectHTML('f-status', 'Status', STATUSES, state.status),
    selectHTML('f-year', 'Year', YEARS, state.year),
  ].join('');
  const tags = `
    <div class="genre-filter-list" id="tag-filter-list" aria-label="Tags (pick several to narrow down)">
      ${tagsList.map((t) => `<button class="chip ${state.tags.includes(t.id) ? 'active' : ''}" data-tag="${escapeHtml(t.id)}" aria-pressed="${state.tags.includes(t.id)}">${escapeHtml(t.name)}</button>`).join('')}
    </div>`;
  return filterPanelHTML(controls, active, '#/manga', tags);
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
      origin: state.origin || undefined,
      year: state.year || undefined,
      sort: state.sort !== 'popular' ? state.sort : undefined,
      page: state.page,
    });
    const list = res.data || [];
    const total = res.total || 0;
    const hasNext = (state.page * 20) < total;

    root.innerHTML = `
      <div class="section-head"><h2 class="section-title">📖 Browse Manga</h2></div>
      ${panelHTML(state, tagsList)}
      ${cardGrid(list, mangaCard)}
      ${list.length ? paginationHTML(state, hasNext) : ''}
    `;
    wireFilterPanel(root);
    setResultCount(root, total ? `${total.toLocaleString()} found · page ${state.page} of ${Math.max(1, Math.ceil(Math.min(total, 10000) / 20))}` : 'Nothing found');

    const goto = (patch) => navigate('#/manga?' + buildQueryString({ ...state, page: 1, ...patch }));
    for (const key of ['sort', 'origin', 'demographic', 'status', 'year']) {
      root.querySelector(`#f-${key}`)?.addEventListener('change', (e) => goto({ [key]: e.target.value }));
    }
    root.querySelectorAll('[data-tag]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.tag;
        goto({ tags: state.tags.includes(id) ? state.tags.filter((t) => t !== id) : [...state.tags, id] });
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

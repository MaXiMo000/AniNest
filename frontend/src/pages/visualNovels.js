import { apiGet } from '../lib/http.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, emptyHTML, errorHTML, skeletonGrid, skeletonDetail, wireRetry } from '../lib/ui.js';

// Visual novels from VNDB (backend/src/routes/visualNovels.js): browse
// (#/vn, with "free only") and one VN (#/vn/:id). Only all-ages VNs without
// sexual content reach the page; buying and playing links go to official
// stores.

const SORTS = [['popular', '🔥 Popular'], ['rating', '⭐ Top Rated'], ['newest', '🆕 Newest']];

const tabsHTML = (active) => `
  <div class="vibe-examples" role="tablist" style="margin-bottom:12px">
    <a class="chip" href="#/novels">📚 Light Novels</a>
    <a class="chip${active === 'all' ? ' active' : ''}" href="#/vn">🎮 Visual Novels</a>
    <a class="chip${active === 'free' ? ' active' : ''}" href="#/vn?free=1">🆓 Free to Play</a>
  </div>`;

function vnCardHTML(v) {
  const meta = [v.released?.slice(0, 4), v.hours ? `~${v.hours}h` : null].filter(Boolean).join(' · ');
  return `
    <a class="manga-card" href="#/vn/${escapeHtml(v.id)}">
      <div class="poster-wrap">
        ${v.image ? `<img src="${escapeHtml(v.image)}" alt="${escapeHtml(v.title)}" loading="lazy" />` : '<div class="vn-no-cover" aria-hidden="true">🎮</div>'}
        <span class="card-type">Visual Novel</span>
        ${v.rating ? `<span class="badge-score small card-score">${v.rating.toFixed(1)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(v.title)}</div>
        <div class="card-meta">${escapeHtml(meta)}</div>
      </div>
    </a>`;
}

export async function renderVnBrowse(root, params) {
  const state = {
    q: params.get('q') || '', sort: params.get('sort') || 'popular', free: params.get('free') === '1',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  document.title = `${state.free ? 'Free Visual Novels' : 'Visual Novels'} — AniNest`;
  const href = (patch) => {
    const next = { ...state, page: 1, ...patch };
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.sort !== 'popular') p.set('sort', next.sort);
    if (next.free) p.set('free', '1');
    if (next.page > 1) p.set('page', next.page);
    return `#/vn${p.toString() ? `?${p}` : ''}`;
  };
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🎮 ${state.free ? 'Free Visual Novels' : 'Visual Novels'}</h1>
      <span class="section-sub">${state.free
    ? 'Complete, official visual novels you can play for free, legally.'
    : 'Story-driven games from the people behind your favorite anime. All-ages titles only.'}</span>
    </div>
    ${tabsHTML(state.free ? 'free' : 'all')}
    <form id="vn-search" class="hero-actions" style="margin-bottom:10px">
      <input name="q" class="list-input" maxlength="100" placeholder="Search visual novels…" value="${escapeHtml(state.q)}" aria-label="Search visual novels" />
      <button class="btn-pow btn-pow--pink" type="submit">SEARCH</button>
    </form>
    ${state.q ? '' : `<div class="vibe-examples">${SORTS.map(([v, l]) => `<a class="chip${state.sort === v ? ' active' : ''}" href="${href({ sort: v })}">${l}</a>`).join('')}</div>`}
    <div id="vn-results">${skeletonGrid(12)}</div>
    <p class="section-sub vn-credit">Data from <a href="https://vndb.org" target="_blank" rel="noopener">VNDB</a>.</p>`;
  root.querySelector('#vn-search').addEventListener('submit', (e) => {
    e.preventDefault();
    navigate(href({ q: e.target.q.value.trim() }));
  });
  const slot = root.querySelector('#vn-results');
  try {
    const res = await apiGet(`/api/vn/search?${new URLSearchParams({ q: state.q, sort: state.sort, page: state.page, ...(state.free ? { free: '1' } : {}) })}`);
    if (!slot.isConnected) return;
    slot.innerHTML = res.data.length
      ? `<div class="card-grid">${res.data.map(vnCardHTML).join('')}</div>
         <div class="pagination">
           ${state.page > 1 ? `<a class="btn-pow btn-pow--sm" href="${href({ page: state.page - 1 })}">◀ PREV</a>` : ''}
           <span>PAGE ${state.page}</span>
           ${res.hasNext ? `<a class="btn-pow btn-pow--sm" href="${href({ page: state.page + 1 })}">NEXT ▶</a>` : ''}
         </div>`
      : emptyHTML('No visual novels match that.', '🔍');
  } catch {
    if (!slot.isConnected) return;
    slot.innerHTML = errorHTML('Couldn’t reach VNDB — try again in a moment.');
    wireRetry(slot, () => renderVnBrowse(root, params));
  }
}

const PLATFORMS = { win: 'Windows', mac: 'Mac', lin: 'Linux', ios: 'iOS', and: 'Android', swi: 'Switch', ps4: 'PS4', ps5: 'PS5', psv: 'Vita', psp: 'PSP', xb1: 'Xbox One', xbs: 'Xbox Series', web: 'Browser' };

export async function renderVnDetail(root, id) {
  root.innerHTML = skeletonDetail('Loading visual novel');
  let v;
  try {
    ({ data: v } = await apiGet(`/api/vn/${encodeURIComponent(id)}`));
  } catch (err) {
    if (!root.isConnected) return;
    if (err.status === 404 || err.status === 400) { root.innerHTML = emptyHTML('We couldn’t find that visual novel.', '🎮'); return; }
    root.innerHTML = errorHTML('Couldn’t reach VNDB — try again in a moment.');
    wireRetry(root, () => renderVnDetail(root, id));
    return;
  }
  if (!root.isConnected) return;
  document.title = `${v.title} — AniNest`;
  const pills = [v.released && `📅 ${v.released.slice(0, 4)}`, v.hours && `⏱️ ~${v.hours} hours`, v.rating && `⭐ ${v.rating.toFixed(1)}`, v.free && '🆓 Free to play'].filter(Boolean);
  const platforms = [...new Set(v.platforms.map((p) => PLATFORMS[p]).filter(Boolean))];
  root.innerHTML = `
    <div class="detail-hero vn-hero">
      ${v.image ? `<img class="detail-poster" src="${escapeHtml(v.image)}" alt="${escapeHtml(v.title)}" fetchpriority="high" />` : '<div class="detail-poster vn-no-cover" aria-hidden="true">🎮</div>'}
      <div class="detail-main">
        <h1 class="detail-title">${escapeHtml(v.title)}</h1>
        ${v.alttitle ? `<p class="detail-title-en">${escapeHtml(v.alttitle)}</p>` : ''}
        <div class="detail-badges">${pills.map((p) => `<span class="stat-pill">${escapeHtml(p)}</span>`).join('')}</div>
        <div class="genre-chips">${v.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="hero-actions"><a class="btn-pow btn-pow--outline" target="_blank" rel="noopener" href="${escapeHtml(v.vndbUrl)}">🔗 VNDB</a></div>
      </div>
    </div>
    <div class="speech-bubble vn-description">${escapeHtml(v.description || 'No description yet.')}</div>
    <div class="watch-box">
      <h3>🎮 ${v.free ? 'Play It Free' : 'Get It'}</h3>
      <p class="muted-note" style="margin:0">Official stores only.${platforms.length ? ` On ${escapeHtml(platforms.join(', '))}.` : ''}</p>
      ${v.stores.length
    ? `<div class="watch-links">${v.stores.map((s) => `<a class="btn-pow btn-pow--blue" target="_blank" rel="noopener" href="${escapeHtml(s.url)}">▶ ${escapeHtml(s.label)}</a>`).join('')}</div>`
    : '<p class="section-sub">No official store links are listed for this one yet.</p>'}
    </div>
    <div class="info-grid">
      <div class="info-box"><div class="k">Developer</div><div class="v">${escapeHtml(v.developers.join(', ') || '—')}</div></div>
      <div class="info-box"><div class="k">Released</div><div class="v">${escapeHtml(v.released || '—')}</div></div>
      <div class="info-box"><div class="k">Length</div><div class="v">${v.hours ? `~${v.hours} hours` : '—'}</div></div>
      <div class="info-box"><div class="k">Votes</div><div class="v">${Number(v.votes).toLocaleString()}</div></div>
    </div>
    <p class="section-sub vn-credit">Data from <a href="https://vndb.org" target="_blank" rel="noopener">VNDB</a>.</p>`;
}

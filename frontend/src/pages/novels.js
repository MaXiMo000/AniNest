import { apiDelete, apiGet, apiPost } from '../lib/http.js';
import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, emptyHTML, errorHTML, skeletonGrid, showToast, wireRetry, READ_STATUSES, skeletonDetail } from '../lib/ui.js';
import { createReviewsUi } from '../lib/reviewsUi.js';
import { shareButtonHTML, wireShare } from '../lib/share.js';

// Light novels (backend/src/routes/novels.js): browse (#/novels), one novel
// (#/novel/:id), your reading list (#/novel-list) and free legal reading
// (#/novels/free). Reading always links out to official or public-domain
// sources; no fan-translation sites, same line as the manga section.

const NovelReviews = {
  kind: 'novel',
  list: (id) => apiGet(`/api/novels/${id}/reviews`),
  submit: (id, rating, body) => apiPost(`/api/novels/${id}/reviews`, { rating, body }),
  remove: (id) => apiDelete(`/api/novels/${id}/reviews`),
};
const novelReviews = createReviewsUi(NovelReviews);

const tabsHTML = (active) => `
  <div class="vibe-examples" role="tablist" style="margin-bottom:12px">
    <a class="chip${active === 'browse' ? ' active' : ''}" href="#/novels">📚 Browse</a>
    <a class="chip${active === 'free' ? ' active' : ''}" href="#/novels/free">🆓 Read Free</a>
    ${Auth.get().user ? `<a class="chip${active === 'list' ? ' active' : ''}" href="#/novel-list">📌 My Novels</a>` : ''}
  </div>`;

function novelCardHTML(n, extra = '') {
  const meta = [n.status, n.year, n.volumes ? `${n.volumes} vol` : null].filter(Boolean).join(' · ');
  return `
    <a class="manga-card" href="#/novel/${Number(n.id ?? n.novel_id)}">
      <div class="poster-wrap">
        ${n.image ? `<img src="${escapeHtml(n.image)}" alt="${escapeHtml(n.title)}" loading="lazy" />` : ''}
        <span class="card-type">Light Novel</span>
        ${n.score ? `<span class="badge-score small" style="position:absolute;right:8px;bottom:8px">${n.score.toFixed(1)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(n.title)}</div>
        <div class="card-meta">${escapeHtml(meta)}</div>
        ${extra}
      </div>
    </a>`;
}

// ---- Browse ----

const SORTS = [['popular', '🔥 Popular'], ['trending', '📈 Trending'], ['score', '⭐ Top Rated'], ['newest', '🆕 Newest']];
const STATUSES = [['', 'Any Status'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus']];
let genresCache = null;

export async function renderNovelBrowse(root, params) {
  document.title = 'Light Novels — AniNest';
  const state = {
    q: params.get('q') || '', genre: params.get('genre') || '', status: params.get('status') || '',
    sort: params.get('sort') || 'popular', page: Math.max(1, Number(params.get('page')) || 1),
  };
  const href = (patch) => {
    const next = { ...state, page: 1, ...patch };
    const p = new URLSearchParams(Object.entries(next).filter(([k, v]) => v && !(k === 'sort' && v === 'popular') && !(k === 'page' && v === 1)));
    return `#/novels${p.toString() ? `?${p}` : ''}`;
  };
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">📚 Light Novels</h1>
      <span class="section-sub">The stories behind your favorite anime, and plenty that haven't been adapted yet.</span>
    </div>
    ${tabsHTML('browse')}
    <form id="novel-search" class="hero-actions" style="margin-bottom:10px">
      <input name="q" class="list-input" maxlength="100" placeholder="Search light novels…" value="${escapeHtml(state.q)}" aria-label="Search light novels" />
      <button class="btn-pow btn-pow--pink" type="submit">SEARCH</button>
    </form>
    <div class="toolbar" id="novel-toolbar"></div>
    <div id="novel-results">${skeletonGrid(12)}</div>`;
  root.querySelector('#novel-search').addEventListener('submit', (e) => {
    e.preventDefault();
    navigate(href({ q: e.target.q.value.trim() }));
  });

  try {
    const [genres, res] = await Promise.all([
      genresCache || apiGet('/api/novels/genres').then((r) => { genresCache = r; return r; }),
      apiGet(`/api/novels/search?${new URLSearchParams({ q: state.q, genre: state.genre, status: state.status, sort: state.sort, page: state.page })}`),
    ]);
    if (!root.isConnected) return;
    const select = (id, label, options, value) => `
      <label class="toolbar-label" for="${id}">${label}</label>
      <select id="${id}">${options.map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === value ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
    root.querySelector('#novel-toolbar').innerHTML = `
      ${state.q ? '' : select('n-sort', 'Sort', SORTS, state.sort)}
      ${select('n-genre', 'Genre', [['', 'Any Genre'], ...genres.data.map((g) => [g, g])], state.genre)}
      ${select('n-status', 'Status', STATUSES, state.status)}
      ${state.q || state.genre || state.status || state.sort !== 'popular' ? '<a class="chip" href="#/novels">✕ Clear All</a>' : ''}`;
    root.querySelector('#n-sort')?.addEventListener('change', (e) => navigate(href({ sort: e.target.value })));
    root.querySelector('#n-genre').addEventListener('change', (e) => navigate(href({ genre: e.target.value })));
    root.querySelector('#n-status').addEventListener('change', (e) => navigate(href({ status: e.target.value })));
    root.querySelector('#novel-results').innerHTML = res.data.length
      ? `<div class="card-grid">${res.data.map((n) => novelCardHTML(n)).join('')}</div>
         <div class="pagination">
           ${state.page > 1 ? `<a class="btn-pow btn-pow--sm" href="${href({ page: state.page - 1 })}">◀ PREV</a>` : ''}
           <span>PAGE ${state.page}</span>
           ${res.hasNext ? `<a class="btn-pow btn-pow--sm" href="${href({ page: state.page + 1 })}">NEXT ▶</a>` : ''}
         </div>`
      : emptyHTML('No light novels match that. Try another search or filter.', '🔍');
  } catch {
    if (!root.isConnected) return;
    root.querySelector('#novel-results').innerHTML = errorHTML('Couldn’t load light novels — try again in a moment.');
    wireRetry(root.querySelector('#novel-results'), () => renderNovelBrowse(root, params));
  }
}

// ---- One novel ----

// Search links on official stores and, for the Japanese original, the web
// novel sites where many light novels started out free from their own authors.
function readLinks(n) {
  const q = encodeURIComponent(n.title);
  const official = [
    { name: 'J-Novel Club', note: 'free previews of the newest parts', url: `https://j-novel.club/search?q=${q}` },
    { name: 'BOOK☆WALKER', note: 'free samples', url: `https://global.bookwalker.jp/search/?word=${q}` },
  ];
  const native = n.title_native ? encodeURIComponent(n.title_native) : null;
  const japanese = native ? [
    { name: 'Syosetu (小説家になろう)', note: 'author-posted web novel, Japanese', url: `https://yomou.syosetu.com/search.php?word=${native}` },
    { name: 'Kakuyomu', note: 'author-posted web novel, Japanese', url: `https://kakuyomu.jp/search?q=${native}` },
  ] : [];
  return { official, japanese };
}

function readBoxHTML(n) {
  const { official, japanese } = readLinks(n);
  const link = (l) => `<a class="btn-pow btn-pow--blue" target="_blank" rel="noopener" href="${escapeHtml(l.url)}" title="${escapeHtml(l.note || '')}">▶ ${escapeHtml(l.name)}</a>`;
  return `
    <div class="watch-box">
      <h3>📖 Read It</h3>
      <p class="muted-note" style="margin:0">Official and author-run sources only. What's free varies by title and region.</p>
      ${n.links.length ? `<h4 class="read-group">Official pages for this novel</h4><div class="watch-links">${n.links.map((l) => link({ name: l.site + (l.language ? ` (${l.language})` : ''), url: l.url })).join('')}</div>` : ''}
      <h4 class="read-group">Search official stores</h4>
      <div class="watch-links">${official.map(link).join('')}</div>
      ${japanese.length ? `<h4 class="read-group">Japanese original, free from the author (if it started online)</h4><div class="watch-links">${japanese.map(link).join('')}</div>` : ''}
    </div>`;
}

function trackerHTML(n, mine) {
  if (!Auth.get().user) return '<p class="section-sub" style="margin-top:12px"><a href="#/login">Log in</a> to track this novel.</p>';
  const total = mine?.volumes ?? n.volumes;
  return `
    <div class="watch-status-row">
      <span class="watch-status-label">📖 Track:</span>
      ${READ_STATUSES.map((s) => `<button class="status-pill ${mine?.status === s.value ? 'is-active' : ''}" data-status="${s.value}">${s.emoji} ${escapeHtml(s.label)}</button>`).join('')}
    </div>
    <div class="watch-status-row" id="novel-progress">
      <span class="watch-status-label">Volume ${mine?.volumes_read || 0}${total ? ` / ${total}` : ''}</span>
      <button class="chip" data-vol="-1" ${!mine?.volumes_read ? 'disabled' : ''} aria-label="One volume back">−</button>
      <button class="chip" data-vol="1" ${total && (mine?.volumes_read || 0) >= total ? 'disabled' : ''}>+1 volume</button>
      ${mine ? '<button class="chip" data-untrack>Remove from my novels</button>' : ''}
    </div>`;
}

export async function renderNovelDetail(root, id) {
  root.innerHTML = skeletonDetail('Loading light novel');
  let res;
  let reviewsData;
  try {
    [res, reviewsData] = await Promise.all([apiGet(`/api/novels/${encodeURIComponent(id)}`), novelReviews.load(id)]);
  } catch (err) {
    if (err.status === 404 || err.status === 400) { root.innerHTML = emptyHTML('We couldn’t find that light novel.', '📚'); return; }
    root.innerHTML = errorHTML('Couldn’t load this novel — try again shortly.');
    wireRetry(root, () => renderNovelDetail(root, id));
    return;
  }
  const n = res.data;
  const state = { mine: res.mine };
  document.title = `${n.title} — AniNest`;
  const pills = [n.status && `📡 ${n.status}`, n.year && `📅 ${n.year}`, n.volumes && `📚 ${n.volumes} volumes`, n.score && `⭐ ${n.score.toFixed(1)}`].filter(Boolean);
  root.innerHTML = `
    <div class="detail-hero" style="background:linear-gradient(160deg, rgba(0,217,255,0.18), rgba(18,12,34,0.9)), var(--panel)">
      ${n.image ? `<img class="detail-poster" src="${escapeHtml(n.image)}" alt="${escapeHtml(n.title)}" fetchpriority="high" />` : ''}
      <div class="detail-main">
        <h1 class="detail-title">${escapeHtml(n.title)}</h1>
        ${n.title_native ? `<p class="detail-title-en">${escapeHtml(n.title_native)}</p>` : ''}
        <div class="detail-badges">${pills.map((p) => `<span class="stat-pill">${escapeHtml(p)}</span>`).join('')}</div>
        <div class="genre-chips">${n.genres.map((g) => `<a class="chip" href="#/novels?genre=${encodeURIComponent(g)}">${escapeHtml(g)}</a>`).join('')}</div>
        <div class="hero-actions">${shareButtonHTML()}${n.anilistUrl ? `<a class="btn-pow btn-pow--outline" target="_blank" rel="noopener" href="${escapeHtml(n.anilistUrl)}">🔗 AniList</a>` : ''}</div>
        <div id="novel-tracker">${trackerHTML(n, state.mine)}</div>
      </div>
    </div>
    <div class="speech-bubble">${escapeHtml(n.synopsis || 'No synopsis available for this one yet.')}</div>
    ${readBoxHTML(n)}
    ${n.adaptations.length ? `
      <section class="section">
        <div class="section-head"><h2 class="section-title">📺 Anime Adaptations</h2></div>
        <div class="card-grid">${n.adaptations.map((a) => `
          <a class="manga-card" href="#/anime/${Number(a.mal_id)}">
            <div class="poster-wrap">${a.image ? `<img src="${escapeHtml(a.image)}" alt="${escapeHtml(a.title)}" loading="lazy" />` : ''}<span class="card-type">Anime</span></div>
            <div class="card-body"><div class="card-title">${escapeHtml(a.title)}</div></div>
          </a>`).join('')}</div>
      </section>` : ''}
    <div class="info-grid">
      <div class="info-box"><div class="k">Author</div><div class="v">${escapeHtml(n.authors.join(', ') || '—')}</div></div>
      <div class="info-box"><div class="k">Volumes</div><div class="v">${escapeHtml(String(n.volumes ?? '?'))}</div></div>
      <div class="info-box"><div class="k">Status</div><div class="v">${escapeHtml(n.status || '—')}</div></div>
      <div class="info-box"><div class="k">Started</div><div class="v">${escapeHtml(String(n.year || '—'))}</div></div>
    </div>
    ${novelReviews.sectionHTML(reviewsData)}`;
  novelReviews.wire(root, n.id);
  wireShare(root, { kind: 'novel', id: n.id, title: `${n.title} — AniNest` });

  const tracker = root.querySelector('#novel-tracker');
  const save = async (body) => {
    try {
      const out = await apiPost('/api/novels/list', { novel_id: n.id, title: n.title, image: n.image || '', volumes: state.mine?.volumes ?? n.volumes ?? null, ...body });
      state.mine = out.mine;
    } catch (err) {
      showToast(err.message || 'Couldn’t save — try again.');
    }
    tracker.innerHTML = trackerHTML(n, state.mine);
  };
  tracker.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    btn.disabled = true;
    if (btn.dataset.status) {
      await save({ status: state.mine?.status === btn.dataset.status ? null : btn.dataset.status });
    } else if (btn.dataset.vol) {
      await save({ volumes_read: Math.max(0, (state.mine?.volumes_read || 0) + Number(btn.dataset.vol)) });
    } else if (btn.hasAttribute('data-untrack')) {
      try {
        await apiDelete(`/api/novels/list/${n.id}`);
        state.mine = null;
        showToast('Removed from your novels.');
      } catch (err) {
        showToast(err.message || 'Couldn’t remove it.');
      }
      tracker.innerHTML = trackerHTML(n, state.mine);
    }
  });
}

// ---- Your reading list ----

let listFilter = 'all';

export async function renderNovelList(root) {
  document.title = 'My Novels — AniNest';
  if (!Auth.get().user) { navigate('#/login'); return; }
  root.innerHTML = `<div class="section-head"><h1 class="section-title">📌 My Novels</h1></div>${tabsHTML('list')}${skeletonGrid(6)}`;
  let list;
  try {
    ({ list } = await apiGet('/api/novels/list'));
  } catch {
    root.innerHTML = errorHTML('Couldn’t load your novels.');
    wireRetry(root, () => renderNovelList(root));
    return;
  }
  const draw = () => {
    const shown = listFilter === 'all' ? list : list.filter((n) => (n.status || 'none') === listFilter);
    const filters = [{ value: 'all', emoji: '📚', label: 'All' }, ...READ_STATUSES];
    root.innerHTML = `
      <div class="section-head"><h1 class="section-title">📌 My Novels</h1><span class="section-sub">${list.length} saved</span></div>
      ${tabsHTML('list')}
      <div class="vibe-examples">${filters.map((f) => `<button class="chip${listFilter === f.value ? ' active' : ''}" data-filter="${f.value}">${f.emoji} ${escapeHtml(f.label)}</button>`).join('')}</div>
      ${shown.length
    ? `<div class="card-grid">${shown.map((n) => novelCardHTML({ ...n, id: n.novel_id }, `<div class="card-meta">${n.status ? escapeHtml(READ_STATUSES.find((s) => s.value === n.status)?.label || '') : 'Saved'} · vol ${n.volumes_read}${n.volumes ? `/${n.volumes}` : ''}</div>`)).join('')}</div>`
    : emptyHTML(list.length ? 'Nothing with that status.' : 'No novels yet. Find one in Browse and track it.', '📚')}`;
    root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { listFilter = b.dataset.filter; draw(); }));
  };
  draw();
}

// ---- Read free ----

const FREE_SITES = [
  {
    group: 'Official free previews (English)',
    sites: [
      { name: 'J-Novel Club', url: 'https://j-novel.club/', about: 'The newest parts of every ongoing series they publish are free to read for a while.' },
      { name: 'BOOK☆WALKER', url: 'https://global.bookwalker.jp/', about: 'Free samples of most light novels, and some free volumes.' },
    ],
  },
  {
    group: 'Japanese web novels, free from the authors',
    sites: [
      { name: 'Syosetu (小説家になろう)', url: 'https://syosetu.com/', about: 'Where Re:Zero, Mushoku Tensei and many isekai started. Japanese.' },
      { name: 'Kakuyomu', url: 'https://kakuyomu.jp/', about: 'Kadokawa’s web novel site. Japanese.' },
    ],
  },
  {
    group: 'Original English web novels',
    sites: [
      { name: 'Royal Road', url: 'https://www.royalroad.com/', about: 'LitRPG, progression fantasy and isekai, written in English and free.' },
      { name: 'Scribble Hub', url: 'https://www.scribblehub.com/', about: 'Original English web novels in the light novel style.' },
      { name: 'Wattpad', url: 'https://www.wattpad.com/', about: 'Millions of free stories across every genre.' },
      { name: 'Tapas', url: 'https://tapas.io/novels', about: 'Novels and comics, many chapters free.' },
    ],
  },
];

export async function renderNovelFree(root, params) {
  document.title = 'Read Novels Free — AniNest';
  const q = params.get('q') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🆓 Read Novels Free</h1>
      <span class="section-sub">Legal places to read for free. We link out; the text stays with the people who made it.</span>
    </div>
    ${tabsHTML('free')}
    ${FREE_SITES.map((g) => `
      <section class="section">
        <div class="section-head"><h2 class="section-title">${escapeHtml(g.group)}</h2></div>
        <div class="free-site-grid">${g.sites.map((s) => `
          <a class="free-site" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
            <strong>${escapeHtml(s.name)} ↗</strong>
            <span>${escapeHtml(s.about)}</span>
          </a>`).join('')}</div>
      </section>`).join('')}
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">Classic novels (public domain)</h2>
        <span class="section-sub">Full books from Project Gutenberg, free for everyone.</span>
      </div>
      <form id="classics-search" class="hero-actions" style="margin-bottom:12px">
        <input name="q" class="list-input" maxlength="100" placeholder="Search classics (e.g. Austen, Frankenstein)…" value="${escapeHtml(q)}" aria-label="Search classic novels" />
        <button class="btn-pow btn-pow--pink" type="submit">SEARCH</button>
      </form>
      <div id="classics">${skeletonGrid(6)}</div>
    </section>`;
  root.querySelector('#classics-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.q.value.trim();
    navigate(v ? `#/novels/free?q=${encodeURIComponent(v)}` : '#/novels/free');
  });
  const slot = root.querySelector('#classics');
  try {
    const res = await apiGet(`/api/novels/classics?${new URLSearchParams({ q, page })}`);
    if (!slot.isConnected) return;
    const pageHref = (p) => `#/novels/free?${new URLSearchParams({ ...(q ? { q } : {}), page: p })}`;
    slot.innerHTML = res.data.length ? `
      <div class="card-grid">${res.data.map((b) => `
        <a class="manga-card" href="${escapeHtml(b.readUrl)}" target="_blank" rel="noopener">
          <div class="poster-wrap">${b.image ? `<img src="${escapeHtml(b.image)}" alt="${escapeHtml(b.title)}" loading="lazy" />` : ''}<span class="card-type">Read free ↗</span></div>
          <div class="card-body"><div class="card-title">${escapeHtml(b.title)}</div><div class="card-meta">${escapeHtml(b.authors.join(', '))}</div></div>
        </a>`).join('')}</div>
      <div class="pagination">
        ${page > 1 ? `<a class="btn-pow btn-pow--sm" href="${pageHref(page - 1)}">◀ PREV</a>` : ''}
        <span>PAGE ${page}</span>
        ${res.hasNext ? `<a class="btn-pow btn-pow--sm" href="${pageHref(page + 1)}">NEXT ▶</a>` : ''}
      </div>` : emptyHTML('No classics match that search.', '📜');
  } catch {
    if (slot.isConnected) slot.innerHTML = errorHTML('Project Gutenberg’s catalog didn’t answer. Try again in a moment.');
  }
}

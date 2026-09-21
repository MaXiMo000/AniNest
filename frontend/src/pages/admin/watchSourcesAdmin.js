import { Api, imageOf } from '../../lib/api.js';
import { AdminWatchSources } from '../../lib/adminWatchSourcesApi.js';
import { escapeHtml, loadingHTML, showToast } from '../../lib/ui.js';
import { Auth } from '../../lib/authStore.js';

// Always rebuilt from a bare video id, never from a stored/typed URL -
// mirrors backend/src/lib/youtubeUrl.js's embedUrlFor(), same reasoning:
// only our own template ever becomes an iframe src.
const embedUrlFor = (id) => `https://www.youtube-nocookie.com/embed/${id}`;
const watchUrlFor = (id) => `https://www.youtube.com/watch?v=${id}`;

// Module state, not per-render - a single "currently curating this anime"
// slot that survives re-renders triggered by search/add/approve actions,
// reset only on a fresh navigation to this page (mirrors compare.js's
// module-scoped `picks`).
let pickedAnime = null;
let searchResults = null;
let searchNotice = null; // { kind: 'quotaExceeded' | 'notConfigured' | 'error', message }
let channels = null;

function bulkImportSectionHTML(channelsList) {
  return `
    <div class="watch-box">
      <h3>📥 Import from a channel</h3>
      <p style="color:var(--muted);font-weight:600;margin:0 0 10px">
        Scans everything a channel has actually uploaded (cheap - a few quota units total, not per-title), keeps only
        uploads that look like a real numbered episode, and adds it only when the guessed series title confidently
        matches an AniNest search result. Anything ambiguous is reported below, never guessed in.
      </p>
      <form id="bulk-import-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select id="bulk-import-channel">
          ${channelsList.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <button type="submit" class="btn-pow btn-pow--sm">📥 Import</button>
      </form>
      <div id="bulk-import-result"></div>
    </div>`;
}

function bulkImportReportHTML(report) {
  const addedList = report.added.length
    ? `<details open><summary>✅ Added ${report.added.length}</summary><ul class="bulk-report-list">
        ${report.added.map((a) => `<li><a href="#/anime/${a.malId}" target="_blank" rel="noopener">${escapeHtml(a.animeTitle)}</a> — ${escapeHtml(a.episodeLabel || '')}</li>`).join('')}
      </ul></details>` : '';
  const unmatchedList = report.skippedNoMatch.length
    ? `<details><summary>❓ Couldn't confidently match ${report.skippedNoMatch.length} (not added — review manually)</summary><ul class="bulk-report-list">
        ${report.skippedNoMatch.slice(0, 40).map((s) => `<li>${escapeHtml(s.title)} <span style="color:var(--muted)">(guessed "${escapeHtml(s.guess)}")</span></li>`).join('')}
        ${report.skippedNoMatch.length > 40 ? `<li style="color:var(--muted)">…and ${report.skippedNoMatch.length - 40} more</li>` : ''}
      </ul></details>` : '';
  return `
    <div class="watch-box" style="margin-top:14px">
      <p style="font-weight:700">
        Scanned ${report.totalUploadsScanned} uploads — ${report.added.length} added,
        ${report.duplicates} already there, ${report.skippedNoEpisode} not episode-shaped, ${report.skippedNoMatch.length} unmatched.
      </p>
      ${addedList}
      ${unmatchedList}
    </div>`;
}

function pickerHTML() {
  return `
    <div class="watch-box">
      <h3>1. Pick an anime</h3>
      <form class="compare-search-form" id="anime-search-form">
        <input type="text" class="compare-search-input" id="anime-search-input" placeholder="Search an anime..." autocomplete="off" />
        <button type="submit" class="btn-pow btn-pow--sm">🔍</button>
      </form>
      <div class="compare-results" id="anime-search-results"></div>
    </div>`;
}

function pickedAnimeHTML(anime) {
  return `
    <div class="watch-box">
      <div style="display:flex;gap:14px;align-items:center">
        ${imageOf(anime) ? `<img src="${escapeHtml(imageOf(anime))}" alt="" style="width:56px;height:80px;object-fit:cover;border:2px solid var(--ink);border-radius:8px" />` : ''}
        <div>
          <h3 style="margin:0">${escapeHtml(anime.title)}</h3>
          <span style="color:var(--muted);font-weight:600">MAL #${anime.mal_id}</span>
        </div>
        <button class="chip" id="change-anime" style="margin-left:auto">🔄 Change</button>
      </div>
    </div>`;
}

function searchFormHTML(channelsList) {
  return `
    <div class="watch-box">
      <h3>2. Search official channels</h3>
      <form id="yt-search-form" style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="yt-channel" style="flex:0 0 auto">
          ${channelsList.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <input type="text" id="yt-query" placeholder="Search terms (e.g. anime title)" autocomplete="off" style="flex:1;min-width:180px" />
        <button type="submit" class="btn-pow btn-pow--sm">🔍 Search</button>
      </form>
      <div id="yt-search-notice"></div>
      <div id="yt-search-results" class="admin-yt-results"></div>
    </div>
    <div class="watch-box">
      <h3>Or add a link directly</h3>
      <p style="color:var(--muted);font-weight:600;margin:0 0 10px">Use this once search quota runs out for the day, or when you already have the link.</p>
      <form id="yt-manual-form" style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="yt-manual-url" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off" style="flex:1;min-width:220px" />
        <input type="text" id="yt-manual-channel" placeholder="Channel (optional)" autocomplete="off" style="flex:0 0 160px" />
        <button type="submit" class="btn-pow btn-pow--sm">➕ Add (approved)</button>
      </form>
    </div>`;
}

function noticeHTML(notice) {
  if (!notice) return '';
  if (notice.kind === 'quotaExceeded') {
    return `<div class="error-box" style="margin-top:10px">⏳ Search quota's out for today — use "Add a link directly" below instead.</div>`;
  }
  if (notice.kind === 'notConfigured') {
    return `<div class="error-box" style="margin-top:10px">⚙️ YouTube search isn't configured on this deployment (set YOUTUBE_API_KEY) — use "Add a link directly" below.</div>`;
  }
  return `<div class="error-box" style="margin-top:10px">💥 ${escapeHtml(notice.message || 'Search failed.')}</div>`;
}

function ytResultsHTML(results) {
  if (!results) return '';
  if (!results.length) return '<div class="compare-results-empty">No results on that channel for this search.</div>';
  return results.map((r) => `
    <div class="admin-yt-result">
      ${r.thumbnail ? `<img src="${escapeHtml(r.thumbnail)}" alt="" />` : ''}
      <div class="admin-yt-result-title">${escapeHtml(r.title)}</div>
      <button class="btn-pow btn-pow--sm" data-use-video="${escapeHtml(r.videoId)}" data-use-channel="${escapeHtml(r.channelName)}" data-use-title="${escapeHtml(r.title)}">✅ Use this</button>
    </div>`).join('');
}

function pendingRowHTML(row) {
  return `
    <div class="admin-pending-row">
      <div class="tv-frame" style="max-width:280px">
        <div class="tv-screen"><iframe src="${embedUrlFor(row.youtube_video_id)}" title="preview" allowfullscreen loading="lazy"></iframe></div>
      </div>
      <div class="admin-pending-meta">
        <a href="#/anime/${row.mal_id}" target="_blank" rel="noopener">MAL #${row.mal_id} ↗</a>
        <span>${escapeHtml(row.channel_name || 'Unknown channel')}${row.label ? ` — ${escapeHtml(row.label)}` : ''}</span>
        <span style="color:var(--muted)">Submitted by ${escapeHtml(row.submitted_by_username || 'someone')}</span>
        <a href="${watchUrlFor(row.youtube_video_id)}" target="_blank" rel="noopener">Open on YouTube ↗</a>
        <div class="hero-actions">
          <button class="btn-pow btn-pow--pink btn-pow--sm" data-approve="${row.id}">✅ Approve</button>
          <button class="btn-pow btn-pow--outline btn-pow--sm" data-reject="${row.id}">❌ Reject</button>
        </div>
      </div>
    </div>`;
}

async function renderPendingSection(root) {
  const el = root.querySelector('#pending-section');
  if (!el) return;
  el.innerHTML = loadingHTML('LOADING QUEUE');
  try {
    const { data } = await AdminWatchSources.pending();
    el.innerHTML = `
      <div class="section-head"><h2 class="section-title">🕓 Pending submissions (${data.length})</h2></div>
      ${data.length ? `<div class="admin-pending-list">${data.map(pendingRowHTML).join('')}</div>` : '<div class="compare-results-empty">Nothing waiting on review.</div>'}
    `;
    el.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await AdminWatchSources.approve(btn.dataset.approve);
          showToast('Approved — it’s live now.');
          renderPendingSection(root);
        } catch (err) {
          showToast(err.message || 'Something went wrong.');
          btn.disabled = false;
        }
      });
    });
    el.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await AdminWatchSources.reject(btn.dataset.reject);
          showToast('Rejected.');
          renderPendingSection(root);
        } catch (err) {
          showToast(err.message || 'Something went wrong.');
          btn.disabled = false;
        }
      });
    });
  } catch {
    el.innerHTML = '<div class="error-box">Couldn’t load the pending queue.</div>';
  }
}

function render(root) {
  root.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">🛠️ Watch-Source Curation</h2>
      <span class="section-sub">Admin only</span>
    </div>
    ${channels ? bulkImportSectionHTML(channels) : loadingHTML('LOADING')}
    ${pickedAnime ? pickedAnimeHTML(pickedAnime) : pickerHTML()}
    ${pickedAnime && channels ? searchFormHTML(channels) : ''}
    <div id="pending-section"></div>
  `;
  wireEvents(root);
  renderPendingSection(root);
}

function wireEvents(root) {
  root.querySelector('#bulk-import-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const channel = root.querySelector('#bulk-import-channel').value;
    const resultEl = root.querySelector('#bulk-import-result');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    resultEl.innerHTML = loadingHTML('SCANNING CHANNEL');
    try {
      const report = await AdminWatchSources.bulkImport(channel);
      resultEl.innerHTML = bulkImportReportHTML(report);
      showToast(`Added ${report.added.length} new free episodes!`);
      renderPendingSection(root);
    } catch (err) {
      resultEl.innerHTML = err.quotaExceeded
        ? '<div class="error-box">⏳ YouTube quota is exhausted for today — try again tomorrow.</div>'
        : err.notConfigured
          ? '<div class="error-box">⚙️ YouTube search isn\'t configured (set YOUTUBE_API_KEY).</div>'
          : `<div class="error-box">💥 ${escapeHtml(err.message || 'Import failed.')}</div>`;
    } finally {
      submitBtn.disabled = false;
    }
  });

  root.querySelector('#anime-search-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = root.querySelector('#anime-search-input');
    const q = input.value.trim();
    if (!q) return;
    const resultsEl = root.querySelector('#anime-search-results');
    resultsEl.innerHTML = loadingHTML('SEARCHING');
    try {
      const { data } = await Api.search({ q, page: 1 });
      resultsEl.innerHTML = (data || []).slice(0, 6).map((a) => `
        <li><button class="compare-result" data-pick-id="${a.mal_id}">
          ${imageOf(a) ? `<img src="${escapeHtml(imageOf(a))}" alt="" />` : ''}
          <span>${escapeHtml(a.title)}</span>
        </button></li>`).join('') || '<div class="compare-results-empty">No matches.</div>';
      if (resultsEl.querySelector('.compare-result')) resultsEl.innerHTML = `<ul class="compare-results-list">${resultsEl.innerHTML}</ul>`;
      resultsEl.querySelectorAll('[data-pick-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const { data } = await Api.fullById(btn.dataset.pickId);
          pickedAnime = data;
          searchResults = null;
          searchNotice = null;
          if (!channels) {
            const chRes = await AdminWatchSources.channels().catch(() => ({ data: [] }));
            channels = chRes.data;
          }
          render(root);
        });
      });
    } catch {
      resultsEl.innerHTML = '<div class="compare-results-empty">Search failed — try again.</div>';
    }
  });

  root.querySelector('#change-anime')?.addEventListener('click', () => {
    pickedAnime = null;
    searchResults = null;
    searchNotice = null;
    render(root);
  });

  root.querySelector('#yt-search-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const channel = root.querySelector('#yt-channel').value;
    const q = root.querySelector('#yt-query').value.trim() || pickedAnime.title;
    const resultsEl = root.querySelector('#yt-search-results');
    const noticeEl = root.querySelector('#yt-search-notice');
    resultsEl.innerHTML = loadingHTML('SEARCHING YOUTUBE');
    noticeEl.innerHTML = '';
    try {
      const { data } = await AdminWatchSources.search(channel, q);
      searchResults = data;
      resultsEl.innerHTML = ytResultsHTML(data);
      resultsEl.querySelectorAll('[data-use-video]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await AdminWatchSources.add(pickedAnime.mal_id, watchUrlFor(btn.dataset.useVideo), btn.dataset.useChannel, btn.dataset.useTitle);
            showToast('Added and approved!');
            renderPendingSection(root);
          } catch (err) {
            showToast(err.message || 'Something went wrong.');
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      resultsEl.innerHTML = '';
      searchNotice = { kind: err.quotaExceeded ? 'quotaExceeded' : (err.notConfigured ? 'notConfigured' : 'error'), message: err.message };
      noticeEl.innerHTML = noticeHTML(searchNotice);
    }
  });

  root.querySelector('#yt-manual-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = root.querySelector('#yt-manual-url').value.trim();
    const channelName = root.querySelector('#yt-manual-channel').value.trim();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await AdminWatchSources.add(pickedAnime.mal_id, url, channelName);
      showToast('Added and approved!');
      root.querySelector('#yt-manual-url').value = '';
      root.querySelector('#yt-manual-channel').value = '';
      renderPendingSection(root);
    } catch (err) {
      showToast(err.message || 'Something went wrong.');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

export async function renderWatchSourcesAdmin(root) {
  document.title = 'Watch-Source Curation — AniNest';
  if (!Auth.get().user?.isAdmin) {
    root.innerHTML = '<div class="empty-state"><span class="big-emoji">🌀</span>This page wandered off into the filler dimension.</div>';
    return;
  }
  pickedAnime = null;
  searchResults = null;
  searchNotice = null;
  channels = null;
  root.innerHTML = loadingHTML('LOADING');
  const chRes = await AdminWatchSources.channels().catch(() => ({ data: [] }));
  channels = chRes.data;
  render(root);
}

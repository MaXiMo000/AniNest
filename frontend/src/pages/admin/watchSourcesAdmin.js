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
let searchNotice = null; // { kind: 'quotaExceeded' | 'notConfigured' | 'error', message }
let channels = null;

const MAX_IMPORT_RUNS = 40;

function bulkImportSectionHTML(channelsList) {
  return `
    <div class="watch-box">
      <h3>📥 Import from a channel</h3>
      <p style="color:var(--muted);font-weight:600;margin:0 0 10px">
        Reads a channel's whole upload history (a few quota units), keeps only real episodes and "Complete Series"
        uploads (PVs, CMs, teasers and vlogs are skipped), and adds each series only when its title matches an
        anime <em>exactly</em>. Anything it isn't sure about goes to <strong>Needs your review</strong> below, grouped
        by series, so you can assign a whole show in one click. Big channels take several passes — it keeps going by itself.
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

function bulkImportReportHTML(t, { finished, error }) {
  const addedList = t.added.size
    ? `<details open><summary>✅ ${t.addedEpisodes} episodes added across ${t.added.size} anime</summary><ul class="bulk-report-list">
        ${[...t.added.values()].map((a) => `<li><a href="#/anime/${a.malId}" target="_blank" rel="noopener">${escapeHtml(a.animeTitle)}</a> — ${a.episodes} ${a.episodes === 1 ? 'upload' : 'uploads'}</li>`).join('')}
      </ul></details>` : '';
  const samples = t.samples.length
    ? `<details><summary>Examples of what was skipped as not-an-episode</summary><ul class="bulk-report-list">
        ${t.samples.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul></details>` : '';
  return `
    <div class="watch-box" style="margin-top:14px">
      <p style="font-weight:700">
        ${finished ? 'Done. ' : 'Working… '}Scanned ${t.scanned} uploads — ${t.addedEpisodes} added,
        ${t.queuedEpisodes} sent to review (${t.queuedGroups} series), ${t.skippedNotEpisode} skipped as not episodes,
        ${t.alreadyKnown} already handled.
        ${t.remaining ? ` <span style="color:var(--yellow)">${t.remaining} series still to check…</span>` : ''}
      </p>
      ${error ? `<div class="error-box">${error}</div>` : ''}
      ${addedList}
      ${samples}
    </div>`;
}

// Big channels have hundreds of distinct series and AniList is rate-limited,
// so a single request only gets through part of them (see the backend's time
// budget); each pass skips everything already handled and reports what's
// left, so this just repeats until nothing is.
async function runBulkImport(channel, resultEl) {
  const t = { scanned: 0, alreadyKnown: 0, skippedNotEpisode: 0, samples: [], added: new Map(), addedEpisodes: 0, queuedGroups: 0, queuedEpisodes: 0, remaining: 0 };
  for (let run = 1; run <= MAX_IMPORT_RUNS; run += 1) {
    let r;
    try {
      r = await AdminWatchSources.bulkImport(channel);
    } catch (err) {
      const msg = err.quotaExceeded ? '⏳ YouTube quota is exhausted for today — try again tomorrow.'
        : err.notConfigured ? '⚙️ YouTube search isn\'t configured (set YOUTUBE_API_KEY).'
          : `💥 ${escapeHtml(err.message || 'Import failed.')}`;
      resultEl.innerHTML = bulkImportReportHTML(t, { finished: true, error: msg });
      return t;
    }
    t.scanned = r.totalUploadsScanned;
    t.alreadyKnown = r.alreadyKnown;
    t.skippedNotEpisode = r.skippedNotEpisode;
    if (r.skippedSamples?.length) t.samples = r.skippedSamples;
    t.addedEpisodes += r.addedEpisodes;
    t.queuedGroups += r.queuedGroups;
    t.queuedEpisodes += r.queuedEpisodes;
    t.remaining = r.remainingGroups;
    for (const a of r.added) {
      const prev = t.added.get(a.malId);
      t.added.set(a.malId, prev ? { ...prev, episodes: prev.episodes + a.episodes } : { ...a });
    }
    const finished = r.remainingGroups === 0;
    resultEl.innerHTML = bulkImportReportHTML(t, { finished });
    if (finished) return t;
    // No progress at all (e.g. AniList rate-limiting every call) - stop rather than spin.
    if (r.addedEpisodes === 0 && r.queuedEpisodes === 0) {
      resultEl.innerHTML = bulkImportReportHTML(t, { finished: true, error: '⏳ AniList is rate-limiting us right now — run Import again in a minute to continue.' });
      return t;
    }
  }
  resultEl.innerHTML = bulkImportReportHTML(t, { finished: true, error: 'Stopped after many passes — run Import again to continue.' });
  return t;
}

function pickerHTML() {
  return `
    <div class="watch-box">
      <h3>Add or manage links for one anime</h3>
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
    </div>
    <div id="approved-section"></div>`;
}

function searchFormHTML(channelsList) {
  return `
    <div class="watch-box">
      <h3>Search official channels</h3>
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

// --- Live links for the picked anime (with remove) --------------------------

async function renderApprovedSection(root) {
  const el = root.querySelector('#approved-section');
  if (!el || !pickedAnime) return;
  try {
    const { data } = await AdminWatchSources.approvedFor(pickedAnime.mal_id);
    el.innerHTML = `
      <div class="watch-box">
        <h3>Live on this anime's page (${data.length})</h3>
        ${data.length ? `<ul class="bulk-report-list">${data.map((s) => `
          <li style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span style="flex:1;min-width:160px">${escapeHtml(s.label || 'Untitled')} <span style="color:var(--muted)">— ${escapeHtml(s.channel_name || 'Unknown channel')}</span></span>
            <a href="${watchUrlFor(escapeHtml(s.youtube_video_id))}" target="_blank" rel="noopener">Open ↗</a>
            <button class="btn-pow btn-pow--outline btn-pow--sm" data-remove="${s.id}">🗑 Remove</button>
          </li>`).join('')}</ul>` : '<div class="compare-results-empty">Nothing live yet.</div>'}
      </div>`;
    el.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Take this link down from the site?')) return;
        btn.disabled = true;
        try {
          await AdminWatchSources.remove(btn.dataset.remove);
          showToast('Removed.');
          renderApprovedSection(root);
        } catch (err) {
          showToast(err.message || 'Something went wrong.');
          btn.disabled = false;
        }
      });
    });
  } catch {
    el.innerHTML = '<div class="error-box">Couldn’t load this anime’s live links.</div>';
  }
}

// --- Needs your review: uploads the importer couldn't match ------------------

function looksLatin(s) {
  const letters = (s.match(/\p{L}/gu) || []);
  return letters.length > 0 && letters.filter((c) => /[A-Za-z]/.test(c)).length / letters.length > 0.6;
}

function candidateRowHTML(g) {
  const seasonNote = g.season && g.season > 1 ? ` · Season ${g.season}` : '';
  return `
    <div class="cand-row" data-key="${escapeHtml(g.group_key)}">
      <div class="cand-head">
        <strong>${escapeHtml(g.series_guess)}</strong>${seasonNote}
        <span style="color:var(--muted)"> — ${g.episodes} ${Number(g.episodes) === 1 ? 'upload' : 'uploads'} · ${escapeHtml(g.channel_name || '')}</span>
      </div>
      <div style="color:var(--muted);font-size:0.85rem">
        e.g. ${escapeHtml(g.sample_title)}
        <a href="${watchUrlFor(escapeHtml(g.sample_video))}" target="_blank" rel="noopener">Watch ↗</a>
      </div>
      <form class="cand-search" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <input type="text" placeholder="Which anime is this? (type its English/romaji title)" value="${looksLatin(g.series_guess) ? escapeHtml(g.series_guess) : ''}" autocomplete="off" style="flex:1;min-width:200px" />
        <button type="submit" class="btn-pow btn-pow--sm">🔍</button>
        <button type="button" class="btn-pow btn-pow--outline btn-pow--sm" data-dismiss>Dismiss</button>
      </form>
      <div class="cand-results"></div>
    </div>`;
}

async function renderCandidatesSection(root) {
  const el = root.querySelector('#candidates-section');
  if (!el) return;
  try {
    const { data } = await AdminWatchSources.candidates();
    el.innerHTML = `
      <div class="section-head"><h2 class="section-title">🧐 Needs your review (${data.length})</h2></div>
      <p style="color:var(--muted);font-weight:600;margin:0 0 12px">
        Real episode uploads the importer wasn't sure which anime they belong to. Each row is one series (all of its
        episodes) — pick the anime once and every episode is added. Note Ani-One's Chinese-titled uploads carry Chinese subtitles;
        they're labelled that way on the page.
      </p>
      ${data.length ? `<div class="admin-pending-list">${data.map(candidateRowHTML).join('')}</div>` : '<div class="compare-results-empty">Nothing waiting on review.</div>'}
    `;
    el.querySelectorAll('.cand-row').forEach((row) => wireCandidateRow(root, row));
  } catch {
    el.innerHTML = '<div class="error-box">Couldn’t load the review queue.</div>';
  }
}

function wireCandidateRow(root, row) {
  const key = row.dataset.key;
  const resultsEl = row.querySelector('.cand-results');

  row.querySelector('.cand-search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = row.querySelector('input').value.trim();
    if (!q) return;
    resultsEl.innerHTML = loadingHTML('SEARCHING');
    try {
      const { data } = await Api.search({ q, page: 1 });
      const list = (data || []).slice(0, 6);
      resultsEl.innerHTML = list.length
        ? `<ul class="compare-results-list">${list.map((a) => `
            <li><button type="button" class="compare-result" data-pick="${a.mal_id}">
              ${imageOf(a) ? `<img src="${escapeHtml(imageOf(a))}" alt="" />` : ''}
              <span>${escapeHtml(a.title)}</span>
            </button></li>`).join('')}</ul>`
        : '<div class="compare-results-empty">No matches — try another spelling.</div>';
      resultsEl.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const r = await AdminWatchSources.assignCandidates(key, btn.dataset.pick);
            showToast(`Added ${r.added} uploads.`);
            renderCandidatesSection(root);
          } catch (err) {
            showToast(err.message || 'Something went wrong.');
            btn.disabled = false;
          }
        });
      });
    } catch {
      resultsEl.innerHTML = '<div class="compare-results-empty">Search failed — try again.</div>';
    }
  });

  row.querySelector('[data-dismiss]').addEventListener('click', async () => {
    try {
      await AdminWatchSources.dismissCandidates(key);
      showToast('Dismissed.');
      renderCandidatesSection(root);
    } catch (err) {
      showToast(err.message || 'Something went wrong.');
    }
  });
}

// --- Pending user submissions -----------------------------------------------

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
      <p style="color:var(--muted);font-weight:600;margin:0 0 12px">Links regular users suggested from an anime's page. (Uploads the importer found itself show up under "Needs your review" above instead.)</p>
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
    <div id="candidates-section"></div>
    ${pickedAnime ? pickedAnimeHTML(pickedAnime) : pickerHTML()}
    ${pickedAnime && channels ? searchFormHTML(channels) : ''}
    <div id="pending-section"></div>
  `;
  wireEvents(root);
  renderCandidatesSection(root);
  renderApprovedSection(root);
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
      const t = await runBulkImport(channel, resultEl);
      if (t.addedEpisodes) showToast(`Added ${t.addedEpisodes} free episodes!`);
      renderCandidatesSection(root);
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
      const list = (data || []).slice(0, 6);
      resultsEl.innerHTML = list.length
        ? `<ul class="compare-results-list">${list.map((a) => `
            <li><button class="compare-result" data-pick-id="${a.mal_id}">
              ${imageOf(a) ? `<img src="${escapeHtml(imageOf(a))}" alt="" />` : ''}
              <span>${escapeHtml(a.title)}</span>
            </button></li>`).join('')}</ul>`
        : '<div class="compare-results-empty">No matches.</div>';
      resultsEl.querySelectorAll('[data-pick-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const { data: full } = await Api.fullById(btn.dataset.pickId);
          pickedAnime = full;
          searchNotice = null;
          render(root);
        });
      });
    } catch {
      resultsEl.innerHTML = '<div class="compare-results-empty">Search failed — try again.</div>';
    }
  });

  root.querySelector('#change-anime')?.addEventListener('click', () => {
    pickedAnime = null;
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
      resultsEl.innerHTML = ytResultsHTML(data);
      resultsEl.querySelectorAll('[data-use-video]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await AdminWatchSources.add(pickedAnime.mal_id, watchUrlFor(btn.dataset.useVideo), btn.dataset.useChannel, btn.dataset.useTitle);
            showToast('Added and approved!');
            renderApprovedSection(root);
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
      renderApprovedSection(root);
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
  searchNotice = null;
  channels = null;
  root.innerHTML = loadingHTML('LOADING');
  const chRes = await AdminWatchSources.channels().catch(() => ({ data: [] }));
  channels = chRes.data;
  render(root);
}

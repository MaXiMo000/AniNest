import { ScreenshotSearch } from '../lib/screenshotSearchApi.js';
import { escapeHtml, loadingHTML, errorHTML, showToast } from '../lib/ui.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

function formatTimestamp(seconds) {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A plain `<article data-id>`, not a real `<a href>` - matches how every
// other card in the app works (see profile.js's favCard()) and relies on
// the global delegated click handler (wireCardEvents in main.js) for
// navigation. A real anchor here would double-navigate: the delegated
// handler has no data-id to key off an <a>, so it would jump to
// "#/anime/undefined" for an instant before the native anchor click
// corrected it to the right href.
function resultCardHTML(r) {
  const pct = Math.round(r.similarity * 100);
  const ts = formatTimestamp(r.from);
  const meta = [r.episode ? `Episode ${r.episode}` : null, ts ? `@ ${ts}` : null].filter(Boolean).join(' ');
  return `
    <article class="anime-card" data-id="${r.mal_id}">
      <div class="poster-wrap">
        ${r.image ? `<img src="${escapeHtml(r.image)}" alt="${escapeHtml(r.title)}" loading="lazy" />` : ''}
        <span class="card-score">${pct}% match</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(r.title)}</div>
        ${meta ? `<div class="card-meta">${escapeHtml(meta)}</div>` : ''}
      </div>
    </article>`;
}

function formHTML() {
  return `
    <div class="section-head">
      <h1 class="section-title">📸 Screenshot Search</h1>
      <span class="section-sub">Upload a frame from any anime and we'll try to identify it, powered by trace.moe.</span>
    </div>
    <div class="watch-box" style="max-width:480px;margin:0 auto">
      <input id="screenshot-input" type="file" accept="image/jpeg,image/png,image/webp" />
      <p class="section-sub" style="margin-top:10px">JPEG, PNG, or WebP, up to 5MB. This feature shares a small daily search quota across every AniNest visitor — it may be briefly unavailable if it's been heavily used today.</p>
    </div>
    <div id="screenshot-result" style="margin-top:20px"></div>
  `;
}

export function renderScreenshotSearch(root) {
  document.title = 'Screenshot Search — AniNest';
  root.innerHTML = formHTML();

  const input = root.querySelector('#screenshot-input');
  const resultBox = root.querySelector('#screenshot-result');

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast('Please choose a JPEG, PNG, or WebP image.');
      input.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      showToast('That image is too large (5MB max).');
      input.value = '';
      return;
    }

    resultBox.innerHTML = loadingHTML('IDENTIFYING FRAME');
    try {
      const { results } = await ScreenshotSearch.search(file);
      if (!results.length) {
        resultBox.innerHTML = `<p class="section-sub" style="text-align:center">No confident match found — try a clearer, less-cropped frame.</p>`;
        return;
      }
      resultBox.innerHTML = `
        <div class="section-head">
          <h2 class="section-title">🔍 Possible Matches</h2>
        </div>
        <div class="card-grid">${results.map(resultCardHTML).join('')}</div>
      `;
    } catch (err) {
      resultBox.innerHTML = errorHTML(err.message || 'Search failed — try again shortly.');
    } finally {
      input.value = '';
    }
  });
}

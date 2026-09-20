import { Api, imageOf } from '../lib/api.js';
import { escapeHtml, loadingHTML } from '../lib/ui.js';

// Kept as plain module state (not the router's params) - two search-and-pick
// slots that persist across re-renders of this same page instance, reset
// only by a fresh navigation to #/compare.
let picks = [null, null];

function resultsListHTML(slot, results) {
  if (!results) return '';
  if (!results.length) return '<div class="compare-results-empty">No matches — try another title.</div>';
  return `
    <ul class="compare-results-list">
      ${results.map((a) => `
        <li><button class="compare-result" data-slot="${slot}" data-id="${a.mal_id}">
          ${imageOf(a) ? `<img src="${escapeHtml(imageOf(a))}" alt="" />` : ''}
          <span>${escapeHtml(a.title)}</span>
        </button></li>
      `).join('')}
    </ul>`;
}

function emptySlotHTML(slot) {
  return `
    <div class="compare-slot compare-slot--empty">
      <span class="compare-slot-emoji">${slot === 0 ? '🅰️' : '🅱️'}</span>
      <form class="compare-search-form" data-slot="${slot}">
        <input type="text" class="compare-search-input" placeholder="Search an anime..." autocomplete="off" />
        <button type="submit" class="btn-pow btn-pow--sm">🔍</button>
      </form>
      <div class="compare-results" data-slot="${slot}"></div>
    </div>`;
}

function filledSlotHTML(slot, anime) {
  const img = imageOf(anime);
  return `
    <div class="compare-slot">
      ${img ? `<img class="compare-poster" src="${escapeHtml(img)}" alt="${escapeHtml(anime.title)}" />` : ''}
      <h3 class="compare-title">${escapeHtml(anime.title)}</h3>
      <button class="chip compare-change" data-slot="${slot}">🔄 Change</button>
    </div>`;
}

function statRow(label, aRaw, bRaw, { higherIsBetter = true, format = (v) => v } = {}) {
  const aNum = typeof aRaw === 'number' ? aRaw : null;
  const bNum = typeof bRaw === 'number' ? bRaw : null;
  const aWins = higherIsBetter && aNum != null && bNum != null && aNum > bNum;
  const bWins = higherIsBetter && aNum != null && bNum != null && bNum > aNum;
  const fmt = (v) => (v == null ? '—' : format(v));
  return `
    <div class="compare-row">
      <div class="compare-cell ${aWins ? 'compare-win' : ''}">${escapeHtml(String(fmt(aRaw)))}</div>
      <div class="compare-label">${escapeHtml(label)}</div>
      <div class="compare-cell ${bWins ? 'compare-win' : ''}">${escapeHtml(String(fmt(bRaw)))}</div>
    </div>`;
}

function comparisonHTML(a, b) {
  const genresOf = (x) => (x.genres || []).map((g) => g.name).join(', ') || '—';
  return `
    <div class="compare-stats">
      ${statRow('Score', a.score ?? null, b.score ?? null, { format: (v) => Number(v).toFixed(1) })}
      ${statRow('Episodes', a.episodes ?? null, b.episodes ?? null)}
      ${statRow('Members', a.members ?? null, b.members ?? null, { format: (v) => Number(v).toLocaleString() })}
      ${statRow('Year', a.year ?? null, b.year ?? null)}
      <div class="compare-row">
        <div class="compare-cell">${escapeHtml(a.type || '—')}</div>
        <div class="compare-label">Type</div>
        <div class="compare-cell">${escapeHtml(b.type || '—')}</div>
      </div>
      <div class="compare-row">
        <div class="compare-cell">${escapeHtml(a.status || '—')}</div>
        <div class="compare-label">Status</div>
        <div class="compare-cell">${escapeHtml(b.status || '—')}</div>
      </div>
      <div class="compare-row compare-row--genres">
        <div class="compare-cell">${escapeHtml(genresOf(a))}</div>
        <div class="compare-label">Genres</div>
        <div class="compare-cell">${escapeHtml(genresOf(b))}</div>
      </div>
    </div>`;
}

function render(root) {
  root.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">⚖️ Compare Anime</h2>
      <span class="section-sub">Pick two and see how they stack up</span>
    </div>
    <div class="compare-arena">
      ${picks[0] ? filledSlotHTML(0, picks[0]) : emptySlotHTML(0)}
      <div class="vs-bolt">⚡</div>
      ${picks[1] ? filledSlotHTML(1, picks[1]) : emptySlotHTML(1)}
    </div>
    ${picks[0] && picks[1] ? comparisonHTML(picks[0], picks[1]) : ''}
  `;
  wireEvents(root);
}

function wireEvents(root) {
  root.querySelectorAll('.compare-search-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const slot = Number(form.dataset.slot);
      const input = form.querySelector('.compare-search-input');
      const q = input.value.trim();
      if (!q) return;
      const resultsEl = root.querySelector(`.compare-results[data-slot="${slot}"]`);
      resultsEl.innerHTML = loadingHTML('SEARCHING');
      try {
        const { data } = await Api.search({ q, page: 1 });
        resultsEl.innerHTML = resultsListHTML(slot, (data || []).slice(0, 6));
        wireResultClicks(root);
      } catch {
        resultsEl.innerHTML = '<div class="compare-results-empty">Search failed — try again.</div>';
      }
    });
  });
  wireResultClicks(root);
  root.querySelectorAll('.compare-change').forEach((btn) => {
    btn.addEventListener('click', () => {
      picks[Number(btn.dataset.slot)] = null;
      render(root);
    });
  });
}

function wireResultClicks(root) {
  root.querySelectorAll('.compare-result').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const slot = Number(btn.dataset.slot);
      const id = btn.dataset.id;
      const { data } = await Api.fullById(id);
      picks[slot] = data;
      render(root);
    });
  });
}

export function renderCompare(root) {
  document.title = 'Compare Anime — AniNest';
  picks = [null, null];
  render(root);
}

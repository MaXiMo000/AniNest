import { Api } from '../lib/api.js';
import { Favorites } from '../lib/store.js';
import { Auth } from '../lib/authStore.js';
import { loadingHTML, errorHTML, emptyHTML, escapeHtml, wireRetry, WATCH_STATUSES } from '../lib/ui.js';

// Release-order watch guide for one franchise (built by the backend from
// AniList's typed relations, see backend/src/lib/franchise.js). Each entry
// carries a default tier, and the viewer's own status/progress from their list.

const TIERS = {
  essential: { label: 'Essential', emoji: '⭐' },
  optional: { label: 'Optional', emoji: '➕' },
  skip: { label: 'Skip (recap)', emoji: '⏭️' },
};

const FORMAT_LABELS = { TV: 'TV', TV_SHORT: 'TV short', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special' };

// Module scope so re-rendering keeps the chosen view.
let essentialsOnly = false;

function metaLine(e) {
  const parts = [
    FORMAT_LABELS[e.format] || e.format,
    e.format !== 'MOVIE' && e.episodes ? `${e.episodes} ep${e.episodes === 1 ? '' : 's'}` : null,
    e.start_date ? e.start_date.slice(0, 4) : 'Announced',
  ].filter(Boolean);
  return parts.join(' · ');
}

function yourStatusHTML(e) {
  if (!e.mal_id || !Favorites.has(e.mal_id)) return '';
  const status = Favorites.getStatus(e.mal_id);
  const { watched } = Favorites.getProgress(e.mal_id);
  const meta = WATCH_STATUSES.find((s) => s.value === status);
  if (status === 'watching' && watched) return `<span class="card-status">👀 Ep ${watched}${e.episodes ? ` / ${e.episodes}` : ''}</span>`;
  return meta ? `<span class="card-status">${meta.emoji} ${escapeHtml(meta.label)}</span>` : '<span class="card-status">💖 In your list</span>';
}

function entryHTML(e, index) {
  const tier = TIERS[e.tier] || TIERS.optional;
  const done = e.mal_id && Favorites.getStatus(e.mal_id) === 'completed';
  const title = escapeHtml(e.title);
  const cover = e.image ? `<img class="wo-cover" src="${escapeHtml(e.image)}" alt="" loading="lazy" />` : '<div class="wo-cover"></div>';
  return `
    <li class="wo-item wo-item--${e.tier}${done ? ' is-done' : ''}">
      <span class="wo-num">${index + 1}</span>
      ${cover}
      <div class="wo-body">
        ${e.mal_id ? `<a class="wo-title" href="#/anime/${Number(e.mal_id)}">${title}</a>` : `<span class="wo-title">${title}</span>`}
        <div class="wo-meta">${escapeHtml(metaLine(e))}</div>
        <div class="wo-tags">
          <span class="wo-tier wo-tier--${e.tier}">${tier.emoji} ${tier.label}</span>
          ${e.alt ? '<span class="wo-tier wo-tier--alt" title="A separate retelling or version of the story">🔀 Alternate version</span>' : ''}
          ${yourStatusHTML(e)}
        </div>
      </div>
    </li>`;
}

// "You're 4/11 through Fate": completed essentials, plus the first essential
// entry not finished yet as "up next".
function progressHTML(f) {
  if (!Auth.get().user) return '';
  const essentials = f.entries.filter((e) => e.tier === 'essential' && e.mal_id);
  const done = essentials.filter((e) => Favorites.getStatus(e.mal_id) === 'completed').length;
  const tracked = f.entries.some((e) => e.mal_id && Favorites.has(e.mal_id));
  if (!tracked || !essentials.length) return '';
  const next = essentials.find((e) => Favorites.getStatus(e.mal_id) !== 'completed');
  const pct = Math.round((done / essentials.length) * 100);
  return `
    <div class="wo-progress">
      <div><strong>You're ${done}/${essentials.length}</strong> through the essential ${escapeHtml(f.name)} entries.</div>
      <div class="card-progress-bar" role="progressbar" aria-label="Essential entries completed" aria-valuemin="0" aria-valuemax="${essentials.length}" aria-valuenow="${done}"><span style="width:${pct}%"></span></div>
      ${next ? `<div>Up next: <a href="#/anime/${Number(next.mal_id)}">${escapeHtml(next.title)}</a></div>` : '<div>All caught up. 🎉</div>'}
    </div>`;
}

export async function renderFranchise(root, slug) {
  root.innerHTML = loadingHTML('LINING UP THE WATCH ORDER');
  let f;
  try {
    ({ data: f } = await Api.franchise(slug));
  } catch (err) {
    if (err.status === 404 || err.status === 400) {
      root.innerHTML = emptyHTML('No watch guide here yet. Open any show in the franchise and its guide is built for you.', '📚');
      return;
    }
    root.innerHTML = errorHTML('Couldn’t load this watch guide. Try again shortly!');
    wireRetry(root, () => renderFranchise(root, slug));
    return;
  }

  document.title = `${f.name} watch order — AniNest`;
  const draw = () => {
    const shown = essentialsOnly ? f.entries.filter((e) => e.tier === 'essential') : f.entries;
    const essentialCount = f.entries.filter((e) => e.tier === 'essential').length;
    root.innerHTML = `
      <div class="section-head">
        <h1 class="section-title">📚 ${escapeHtml(f.name)} watch order</h1>
        <span class="section-sub">Release order · ${f.entries.length} entries</span>
      </div>
      ${progressHTML(f)}
      <div class="library-tabs" role="group" aria-label="Which entries to show">
        <button class="library-tab ${essentialsOnly ? '' : 'is-active'}" data-view="all" aria-pressed="${!essentialsOnly}">📚 Everything (${f.entries.length})</button>
        <button class="library-tab ${essentialsOnly ? 'is-active' : ''}" data-view="essentials" aria-pressed="${essentialsOnly}">⭐ Essentials only (${essentialCount})</button>
      </div>
      <ol class="watch-order">${shown.map((e, i) => entryHTML(e, i)).join('')}</ol>
      ${f.truncated ? '<p class="muted-note">This franchise is huge, so the guide covers the entries closest to where it starts.</p>' : ''}
      <p class="muted-note">This order is generated from AniList's relation data: sequels and main-story movies are marked essential, side stories and spin-offs optional, recaps skippable. Community-voted chronological and first-timer orders are on the way.</p>
    `;
    root.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        essentialsOnly = btn.dataset.view === 'essentials';
        draw();
      });
    });
  };
  draw();
}

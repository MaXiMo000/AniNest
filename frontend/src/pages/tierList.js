import { Favorites } from '../lib/store.js';
import { escapeHtml, emptyHTML, showToast } from '../lib/ui.js';
import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';

// Purely client-side (per the roadmap note) - no backend beyond the
// favorites data that's already loaded. Placement is kept in localStorage
// only, keyed per signed-in username, so switching accounts on the same
// browser doesn't mix up tier lists.
const TIERS = [
  { key: 'S', color: 'var(--pink)' },
  { key: 'A', color: 'var(--orange)' },
  { key: 'B', color: 'var(--yellow)' },
  { key: 'C', color: 'var(--green)' },
  { key: 'D', color: 'var(--blue)' },
  { key: 'F', color: 'var(--muted)' },
];

function storageKey(username) {
  return `aninest_tierlist_${username}`;
}

function loadPlacement(username) {
  try {
    const raw = localStorage.getItem(storageKey(username));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePlacement(username, placement) {
  try {
    localStorage.setItem(storageKey(username), JSON.stringify(placement));
  } catch { /* private-browsing/storage-full — placement just won't persist across reloads */ }
}

// No crossorigin here - these are for on-screen display only, and adding
// it caused a real bug: Browse/Favorites/Home all load these exact same
// poster URLs WITHOUT crossorigin, so by the time a user reaches Tier
// List the browser has usually already cached a non-CORS response for
// that URL - requesting the identical URL again in CORS mode then fails
// to load at all (confirmed directly: the same URL succeeds plain but
// fails with crossOrigin='anonymous' once already cached that way),
// showing a broken-image icon instead of the poster. Export needs a
// CORS-clean image, but it builds its own separate Image() objects (see
// loadImageForExport below) rather than reusing these <img> elements, so
// decoupling the two is both the fix and the more correct design.
function cardHTML(f) {
  return `
    <div class="tier-card" draggable="true" data-id="${f.mal_id}" title="${escapeHtml(f.title)}">
      ${f.image ? `<img src="${escapeHtml(f.image)}" alt="${escapeHtml(f.title)}" loading="lazy" />` : `<span class="tier-card-fallback">${escapeHtml(f.title.slice(0, 2))}</span>`}
    </div>`;
}

function poolHTML(tierKey, favs) {
  return `<div class="tier-pool" data-tier="${tierKey}">${favs.map(cardHTML).join('')}</div>`;
}

function renderBoard(root, favorites, placement) {
  const byTier = new Map(TIERS.map((t) => [t.key, []]));
  const unranked = [];
  for (const f of favorites) {
    const t = placement[f.mal_id];
    if (t && byTier.has(t)) byTier.get(t).push(f);
    else unranked.push(f);
  }

  root.querySelector('#tier-rows').innerHTML = TIERS.map((t) => `
    <div class="tier-row">
      <div class="tier-label" style="background:${t.color}">${t.key}</div>
      ${poolHTML(t.key, byTier.get(t.key))}
    </div>`).join('');

  root.querySelector('#unranked-pool-wrap').innerHTML = `
    <div class="section-head" style="margin-top:20px"><h2 class="section-title">📦 Unranked (${unranked.length})</h2></div>
    ${poolHTML('unranked', unranked)}`;

  wireDragAndDrop(root, favorites, placement);
}

function wireDragAndDrop(root, favorites, placement) {
  root.querySelectorAll('.tier-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  root.querySelectorAll('.tier-pool').forEach((pool) => {
    pool.addEventListener('dragover', (e) => {
      e.preventDefault();
      pool.classList.add('is-drag-over');
    });
    pool.addEventListener('dragleave', () => pool.classList.remove('is-drag-over'));
    pool.addEventListener('drop', (e) => {
      e.preventDefault();
      pool.classList.remove('is-drag-over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      if (!id) return;
      const tier = pool.dataset.tier;
      if (tier === 'unranked') delete placement[id];
      else placement[id] = tier;
      savePlacement(Auth.get().user.username, placement);
      renderBoard(root, favorites, placement);
    });
  });
}

const EXPORT_WIDTH = 1000;
const LABEL_WIDTH = 110;
const THUMB_W = 70;
const THUMB_H = 100;
const GAP = 10;
const PADDING = 14;

function loadImageForExport(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // one bad/blocked image shouldn't fail the whole export
    // Cache-busted on purpose: the plain <img> in the tier cards above
    // loads this exact URL without crossorigin, so the browser very often
    // already has a non-CORS cached response for it by export time - a
    // crossorigin='anonymous' request against that same cached URL fails
    // to load at all (confirmed directly). A unique query string forces a
    // fresh network fetch, which correctly gets AniList/MAL's CORS headers.
    const separator = url.includes('?') ? '&' : '?';
    img.src = `${url}${separator}_export=1`;
  });
}

function bandHeight(count) {
  const perRow = Math.max(1, Math.floor((EXPORT_WIDTH - LABEL_WIDTH - PADDING * 2) / (THUMB_W + GAP)));
  const rows = Math.max(1, Math.ceil(count / perRow) || 1);
  return rows * (THUMB_H + GAP) + PADDING;
}

async function exportAsImage(favorites, placement) {
  const byTier = new Map(TIERS.map((t) => [t.key, []]));
  for (const f of favorites) {
    const t = placement[f.mal_id];
    if (t && byTier.has(t)) byTier.get(t).push(f);
  }

  const heights = TIERS.map((t) => bandHeight(byTier.get(t.key).length));
  const totalHeight = heights.reduce((a, b) => a + b, 0);

  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_WIDTH;
  canvas.height = totalHeight || 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#120c22';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Preload every poster up front - drawImage needs a fully loaded image,
  // and doing this in one Promise.all is far faster than loading serially.
  const images = await Promise.all(
    TIERS.map((t) => Promise.all(byTier.get(t.key).map((f) => loadImageForExport(f.image)))),
  );

  let y = 0;
  TIERS.forEach((t, tierIndex) => {
    const h = heights[tierIndex];
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(t.color.slice(4, -1)).trim() || '#888';
    ctx.fillRect(0, y, LABEL_WIDTH, h);
    ctx.fillStyle = '#16101f';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.key, LABEL_WIDTH / 2, y + h / 2);

    const perRow = Math.max(1, Math.floor((EXPORT_WIDTH - LABEL_WIDTH - PADDING * 2) / (THUMB_W + GAP)));
    images[tierIndex].forEach((img, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = LABEL_WIDTH + PADDING + col * (THUMB_W + GAP);
      const cardY = y + PADDING + row * (THUMB_H + GAP);
      if (img) {
        ctx.drawImage(img, x, cardY, THUMB_W, THUMB_H);
      } else {
        ctx.fillStyle = '#241a3d';
        ctx.fillRect(x, cardY, THUMB_W, THUMB_H);
      }
    });
    y += h;
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Export failed.')); return; }
      resolve(blob);
    }, 'image/png');
  });
}

export function renderTierList(root) {
  document.title = 'Tier List Maker — AniNest';
  const { user } = Auth.get();
  if (!user) { navigate('#/login'); return; }

  const favorites = Object.values(Favorites.all());
  if (!favorites.length) {
    root.innerHTML = emptyHTML('Favorite some anime first, then come back to rank them!', '🏆');
    return;
  }

  const placement = loadPlacement(user.username);
  // Drop any placements for anime that were later unfavorited, so the
  // unranked count / export don't reference stale entries.
  const favIds = new Set(favorites.map((f) => f.mal_id));
  Object.keys(placement).forEach((id) => { if (!favIds.has(Number(id))) delete placement[id]; });

  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🏆 Tier List Maker</h1>
      <span class="section-sub">Drag your favorites into a tier, then export as an image.</span>
    </div>
    <div class="hero-actions" style="justify-content:center;margin-bottom:20px">
      <button id="export-btn" class="btn-pow btn-pow--pink">🖼️ EXPORT AS IMAGE</button>
      <button id="reset-btn" class="btn-pow btn-pow--outline">🔄 RESET ALL</button>
    </div>
    <div id="tier-rows"></div>
    <div id="unranked-pool-wrap"></div>
  `;

  renderBoard(root, favorites, placement);

  root.querySelector('#reset-btn').addEventListener('click', () => {
    Object.keys(placement).forEach((id) => delete placement[id]);
    savePlacement(user.username, placement);
    renderBoard(root, favorites, placement);
    showToast('Tier list reset.');
  });

  root.querySelector('#export-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '🖼️ RENDERING...';
    try {
      const blob = await exportAsImage(favorites, placement);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-anime-tier-list.png';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Export failed — try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = '🖼️ EXPORT AS IMAGE';
    }
  });
}

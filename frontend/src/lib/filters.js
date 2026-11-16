import { escapeHtml } from './ui.js';

// The filter panel shared by the browse pages (anime, manga, light novels,
// classics). On phones it folds behind a "Filters" button showing how many
// are on, so results come first; on wider screens it is always open. Active
// filters are listed as removable chips next to the result count.

export function selectHTML(id, label, options, value) {
  return `
    <label class="toolbar-label" for="${id}">${escapeHtml(label)}</label>
    <select id="${id}">${options.map(([v, l]) => `<option value="${escapeHtml(String(v))}" ${String(v) === String(value) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
}

// `active`: [{ label, href }] — each chip links to the same page without that filter.
export function filterPanelHTML(controlsHTML, active, clearHref, extraHTML = '') {
  return `
    <details class="filter-panel" data-filter-panel open>
      <summary class="filter-summary">⚙️ Filters${active.length ? ` <span class="filter-count">${active.length}</span>` : ''}</summary>
      <div class="toolbar">${controlsHTML}</div>
      ${extraHTML}
    </details>
    <div class="active-filters" aria-live="polite">
      <span class="result-count" data-result-count></span>
      ${active.map((a) => `<a class="chip active" href="${escapeHtml(a.href)}" aria-label="Remove filter ${escapeHtml(a.label)}">${escapeHtml(a.label)} ✕</a>`).join('')}
      ${active.length > 1 ? `<a class="chip" href="${escapeHtml(clearHref)}">Clear all</a>` : ''}
    </div>`;
}

// [['', 'Any Year'], [2027, '2027'], ...] down to `from`.
export function yearOptions(from = 1960) {
  const top = new Date().getFullYear() + 1;
  return [['', 'Any Year'], ...Array.from({ length: top - from + 1 }, (_, i) => [top - i, String(top - i)])];
}

// Open on wide screens, folded on phones, following the window as it resizes.
export function wireFilterPanel(root) {
  const panel = root.querySelector('[data-filter-panel]');
  if (!panel) return;
  const wide = window.matchMedia('(min-width: 641px)');
  panel.open = wide.matches;
  const follow = (e) => {
    if (!panel.isConnected) { wide.removeEventListener('change', follow); return; }
    panel.open = e.matches;
  };
  wide.addEventListener('change', follow);
}

export function setResultCount(root, text) {
  const el = root.querySelector('[data-result-count]');
  if (el) el.textContent = text;
}

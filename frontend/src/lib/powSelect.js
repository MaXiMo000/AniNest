import { escapeHtml } from './ui.js';

// The site's one dropdown. Every native <select> on every page is upgraded
// to it automatically (wirePowSelects watches the page for new ones), because
// a native select's open list is drawn by the browser or OS: it can't be
// themed, and on phones it becomes a full-screen system list.
//
// The real <select> stays in the page, visually hidden, as the source of
// truth: its value, its change events and its form submission work exactly as
// before, so page code never needs to know a select was upgraded.
//
// The open list:
// - wide screens: drops below the button, or above it when there's more room
//   there, never taller than the space left on screen (it scrolls inside);
// - phones and short screens: a bottom sheet with a title and a close button;
// - long lists get a search box; full keyboard support and listbox semantics.

const SHEET_MAX_WIDTH = 640; // narrower than this: bottom sheet
const SHEET_MAX_HEIGHT = 440; // shorter than this (landscape phones): bottom sheet
const SEARCH_FROM = 12; // lists at least this long get a search box
const GAP = 6;
const EDGE = 8;

let uid = 0;
let current = null; // the open dropdown: { wrap, sel, trigger, pop, list, search, items, active, cleanup }

// Kept for pages that build a dropdown from data: a plain <select>, upgraded
// like every other one.
export function powSelectHTML({ id, options, value, label }) {
  const selected = options.find((o) => String(o.value) === String(value)) || options[0];
  return `<select id="${escapeHtml(id)}"${label ? ` aria-label="${escapeHtml(label)}"` : ''}>${options.map((o) => `<option value="${escapeHtml(String(o.value))}"${String(o.value) === String(selected?.value) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
}

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const viewport = () => ({
  w: window.visualViewport?.width || window.innerWidth,
  h: window.visualViewport?.height || window.innerHeight,
});
const useSheet = () => {
  const { w, h } = viewport();
  return w <= SHEET_MAX_WIDTH || h <= SHEET_MAX_HEIGHT;
};

// The select's name for people: its aria-label, its <label for>, or the text
// of a wrapping <label> (without the options' own text).
function labelOf(sel) {
  if (sel.getAttribute('aria-label')) return sel.getAttribute('aria-label');
  if (sel.id) {
    const forLabel = document.querySelector(`label[for="${window.CSS?.escape ? CSS.escape(sel.id) : sel.id}"]`);
    if (forLabel) return forLabel.textContent.trim();
  }
  const wrapping = sel.closest('label');
  if (wrapping) {
    return [...wrapping.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').trim();
  }
  return '';
}

function sync(wrap) {
  const sel = wrap.querySelector('select');
  const trigger = wrap.querySelector('.pow-select-trigger');
  const text = sel.options[sel.selectedIndex]?.textContent.trim() ?? '';
  trigger.querySelector('.pow-select-trigger-label').textContent = text;
  const name = labelOf(sel);
  trigger.setAttribute('aria-label', name ? `${name}: ${text}` : text);
  trigger.disabled = sel.disabled;
}

export function enhanceSelect(sel) {
  if (sel.dataset.pow || sel.multiple || sel.size > 1 || sel.hasAttribute('data-native')) return;
  sel.dataset.pow = '1';
  const wrap = document.createElement('div');
  wrap.className = 'pow-select';
  wrap.dataset.powSelect = '';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'pow-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span class="pow-select-trigger-label"></span><span class="pow-select-arrow" aria-hidden="true">▾</span>';
  sel.before(wrap);
  wrap.append(trigger, sel);
  sel.classList.add('pow-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  sel.addEventListener('change', () => sync(wrap));
  // A <label for> click focuses the hidden select; hand focus to the button.
  sel.addEventListener('focus', () => trigger.focus());
  new MutationObserver(() => sync(wrap)).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-label'] });
  sync(wrap);
}

export function enhanceSelects(root = document) {
  if (root.matches?.('select')) enhanceSelect(root);
  root.querySelectorAll?.('select').forEach(enhanceSelect);
}

// ---- open / close ----

function render(state) {
  const { sel, list } = state;
  const q = fold(state.search?.value.trim() || '');
  const opts = [...sel.options];
  list.innerHTML = opts.map((o, i) => {
    const hidden = q && !fold(o.textContent).includes(q);
    return `<li role="option" id="${state.id}-o${i}" data-index="${i}" data-value="${escapeHtml(o.value)}"
      aria-selected="${o.selected}"${o.disabled ? ' aria-disabled="true"' : ''}${hidden ? ' hidden' : ''}
      class="${o.selected ? 'is-selected' : ''}">${escapeHtml(o.textContent.trim())}</li>`;
  }).join('');
  state.items = [...list.children];
  const visible = state.items.filter((li) => !li.hidden && li.getAttribute('aria-disabled') !== 'true');
  state.pop.querySelector('.pow-select-empty').hidden = visible.length > 0;
  const keep = state.items[state.active];
  setActive(state, keep && !keep.hidden ? state.active : (visible.find((li) => li.classList.contains('is-selected')) || visible[0])?.dataset.index ?? -1);
}

function setActive(state, index, scroll = true) {
  const i = Number(index);
  state.items.forEach((li) => li.classList.remove('is-active'));
  state.active = i;
  const li = state.items[i];
  const owner = state.search || state.list;
  if (!li) { owner.removeAttribute('aria-activedescendant'); return; }
  li.classList.add('is-active');
  owner.setAttribute('aria-activedescendant', li.id);
  if (scroll) li.scrollIntoView?.({ block: 'nearest' });
}

function move(state, step) {
  const usable = state.items.filter((li) => !li.hidden && li.getAttribute('aria-disabled') !== 'true');
  if (!usable.length) return;
  const at = usable.findIndex((li) => Number(li.dataset.index) === state.active);
  let next;
  if (step === 'first') next = 0;
  else if (step === 'last') next = usable.length - 1;
  else next = Math.min(usable.length - 1, Math.max(0, (at < 0 ? -1 : at) + step));
  setActive(state, usable[next].dataset.index);
}

function choose(state, index) {
  const { sel } = state;
  const opt = sel.options[index];
  if (!opt || opt.disabled) return;
  const changed = sel.selectedIndex !== Number(index);
  close({ focus: true });
  if (changed) {
    sel.selectedIndex = Number(index);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function place(state) {
  const { trigger, pop, sheet } = state;
  if (sheet) return;
  const r = trigger.getBoundingClientRect();
  if (r.bottom < 0 || r.top > viewport().h) { close(); return; }
  const { w, h } = viewport();
  const width = Math.min(Math.max(r.width, 220), w - EDGE * 2);
  const left = Math.min(Math.max(r.left, EDGE), w - width - EDGE);
  const below = h - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  // Full height without lifting the cap (lifting it would reset the list's
  // scroll position): the list's content plus everything around it.
  const natural = state.list.scrollHeight + (pop.offsetHeight - state.list.clientHeight);
  const down = below >= Math.min(natural, 260) || below >= above;
  const room = Math.max(120, down ? below : above);
  Object.assign(pop.style, {
    width: `${width}px`, left: `${left}px`, maxHeight: `${room}px`,
    top: down ? `${r.bottom + GAP}px` : 'auto',
    bottom: down ? 'auto' : `${h - r.top + GAP}px`,
  });
}

export function open(wrap) {
  if (current?.wrap === wrap) return;
  close();
  const sel = wrap.querySelector('select');
  const trigger = wrap.querySelector('.pow-select-trigger');
  if (sel.disabled) return;
  const id = `pow${++uid}`;
  const name = labelOf(sel) || 'Choose';
  const sheet = useSheet();
  const searchable = sel.options.length >= SEARCH_FROM;
  const pop = document.createElement('div');
  pop.className = `pow-select-pop${sheet ? ' is-sheet' : ''}`;
  pop.innerHTML = `
    ${sheet ? `<div class="pow-select-head"><strong>${escapeHtml(name)}</strong><button type="button" class="pow-select-close" aria-label="Close">✕</button></div>` : ''}
    ${searchable ? `<input type="search" class="pow-select-search" placeholder="Search…" aria-label="Search ${escapeHtml(name)}" aria-controls="${id}-list" autocomplete="off" spellcheck="false" />` : ''}
    <ul class="pow-select-options" role="listbox" id="${id}-list" tabindex="-1" aria-label="${escapeHtml(name)}"></ul>
    <p class="pow-select-empty" hidden>No matches.</p>`;
  // The open list lives on <body>, not inside the page: a page's slide-in
  // animation puts a transform on its container, and inside a transformed
  // box position:fixed and z-index stop meaning "the screen".
  const backdrop = sheet ? Object.assign(document.createElement('div'), { className: 'pow-select-backdrop' }) : null;
  if (backdrop) document.body.append(backdrop);
  document.body.append(pop);
  const state = {
    wrap, sel, trigger, pop, sheet, id, active: -1, items: [], typed: '', typedAt: 0,
    list: pop.querySelector('.pow-select-options'), search: pop.querySelector('.pow-select-search'),
  };
  current = state;
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', `${id}-list`);
  wrap.classList.add('is-open');
  render(state);

  // Follow the button when the page scrolls, but not when the list itself does.
  const reposition = (e) => { if (!(e?.target instanceof Node && pop.contains(e.target))) place(state); };
  const html = document.documentElement;
  const prevOverflow = html.style.overflow;
  if (sheet) html.style.overflow = 'hidden';
  else {
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
  }
  state.cleanup = () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    window.visualViewport?.removeEventListener('resize', reposition);
    if (sheet) html.style.overflow = prevOverflow;
    backdrop?.remove();
  };

  place(state);
  const sel0 = state.items[state.active];
  if (sel0) sel0.scrollIntoView?.({ block: sheet ? 'center' : 'nearest' });
  // On touch screens, don't pop the keyboard up just because a list opened.
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  (state.search && !touch ? state.search : state.list).focus({ preventScroll: true });

  state.search?.addEventListener('input', () => { state.active = -1; render(state); });
  pop.querySelector('.pow-select-close')?.addEventListener('click', () => close({ focus: true }));
  state.list.addEventListener('click', (e) => {
    const li = e.target.closest('li[role="option"]');
    if (li && li.getAttribute('aria-disabled') !== 'true') choose(state, li.dataset.index);
  });
  state.list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('li[role="option"]');
    if (li && Number(li.dataset.index) !== state.active) setActive(state, li.dataset.index, false);
  });
  pop.addEventListener('keydown', (e) => onListKey(state, e));
}

export function close({ focus = false } = {}) {
  const state = current;
  if (!state) return;
  current = null;
  state.cleanup?.();
  state.pop.remove();
  state.wrap.classList.remove('is-open');
  state.trigger.setAttribute('aria-expanded', 'false');
  state.trigger.removeAttribute('aria-controls');
  if (focus) state.trigger.focus({ preventScroll: true });
}

function onListKey(state, e) {
  const k = e.key;
  if (k === 'ArrowDown') { e.preventDefault(); move(state, 1); }
  else if (k === 'ArrowUp') { e.preventDefault(); move(state, -1); }
  else if (k === 'PageDown') { e.preventDefault(); move(state, 8); }
  else if (k === 'PageUp') { e.preventDefault(); move(state, -8); }
  else if (k === 'Home' && e.target !== state.search) { e.preventDefault(); move(state, 'first'); }
  else if (k === 'End' && e.target !== state.search) { e.preventDefault(); move(state, 'last'); }
  else if (k === 'Enter' || (k === ' ' && e.target !== state.search)) {
    e.preventDefault();
    if (state.active >= 0) choose(state, state.active);
  } else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close({ focus: true }); }
  else if (k === 'Tab') close({ focus: true });
  else if (!state.search && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Type to jump, like a native select.
    const now = Date.now();
    state.typed = now - state.typedAt < 700 ? state.typed + fold(k) : fold(k);
    state.typedAt = now;
    const hit = state.items.find((li) => fold(li.textContent).startsWith(state.typed))
      || state.items.find((li) => fold(li.textContent).includes(state.typed));
    if (hit) setActive(state, hit.dataset.index);
  }
}

// Wired once, at document level, for every dropdown on the page.
export function wirePowSelects() {
  enhanceSelects(document);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) enhanceSelects(n);
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.pow-select-trigger');
    if (trigger) {
      const wrap = trigger.closest('.pow-select');
      if (current?.wrap === wrap) close({ focus: true });
      else open(wrap);
      return;
    }
    if (current && (e.target.closest('.pow-select-backdrop') || !current.pop.contains(e.target))) close();
  });
  document.addEventListener('keydown', (e) => {
    const trigger = e.target.closest?.('.pow-select-trigger');
    if (!trigger || current?.trigger === trigger) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      open(trigger.closest('.pow-select'));
    }
  });
  window.addEventListener('hashchange', () => close());
}

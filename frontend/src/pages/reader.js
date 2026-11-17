import { apiGet } from '../lib/http.js';
import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, emptyHTML, errorHTML, wireRetry, showToast, skeletonDetail } from '../lib/ui.js';
import { confetti } from '../lib/gameFx.js';
import { localPosition, savePosition, isSavedOffline, markSavedOffline } from '../lib/classicsProgress.js';
import { watchAnimeHTML } from '../lib/classicLinks.js';
import { shareUrl, shareLink } from '../lib/share.js';
import { quoteCardBlob } from '../lib/quoteCard.js';

// #/read/:id?part=N — a public-domain book (backend/src/lib/classics.js),
// one chapter at a time, with reading settings kept in this browser, a
// reading streak, quote cards, offline saving and a LibriVox audiobook.

const PREFS_KEY = 'aninest:reader';
const SIZES = [0.95, 1.05, 1.15, 1.3, 1.45];
const WPM = 230;
const QUOTE_MIN = 20;
const QUOTE_MAX = 400;

function loadPrefs() {
  try { return { size: 2, font: 'serif', ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; } catch { return { size: 2, font: 'serif' }; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const minutes = (words) => Math.max(1, Math.round(words / WPM));
const duration = (words) => {
  const m = minutes(words);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
};

const books = new Map(); // id -> book details, for moving between chapters without a refetch

function aboutHTML(b, open) {
  return `
    <details class="reader-about" ${open ? 'open' : ''}>
      <summary>About this book</summary>
      <div class="reader-about-body">
        ${b.image ? `<img src="${escapeHtml(b.image)}" alt="" loading="lazy" />` : ''}
        <div>
          <p class="reader-about-meta">
            ${escapeHtml(b.authors.join(', ') || 'Unknown author')}${b.years.length ? ` (${escapeHtml(b.years.join(', '))})` : ''}
            · ${b.parts.length} ${b.parts.length === 1 ? 'part' : 'chapters'} · about ${duration(b.words)} to read
            · ${Number(b.downloads).toLocaleString()} downloads on Project Gutenberg
          </p>
          ${b.summary ? `<p>${escapeHtml(b.summary)}</p>` : ''}
          ${b.subjects.length ? `<div class="genre-chips">${b.subjects.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    </details>`;
}

// Offline saving needs a service worker in control of the page (the built
// app; not `vite dev`).
const canSaveOffline = () => Boolean(navigator.serviceWorker?.controller);

async function saveOffline(book, btn) {
  btn.disabled = true;
  let done = 0;
  const queue = book.parts.map((_, i) => i);
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      await apiGet(`/api/novels/classics/${book.id}/parts/${n}`);
      done++;
      btn.textContent = `⬇️ ${done}/${book.parts.length}`;
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
    markSavedOffline(book.id);
    btn.textContent = '✅ Offline';
    showToast('Saved. This book now opens without internet.');
  } catch {
    btn.disabled = false;
    btn.textContent = '⬇️ Offline';
    showToast('Saving stopped partway. Try again when you’re online.');
  }
}

// The LibriVox player, loaded the first time it's opened.
async function openAudio(panel, book, partIndex) {
  panel.hidden = !panel.hidden;
  if (panel.hidden || panel.dataset.loaded) return;
  panel.dataset.loaded = '1';
  panel.innerHTML = '<p class="muted-note">Looking for a free audiobook…</p>';
  let audio;
  try {
    ({ data: audio } = await apiGet(`/api/novels/classics/${book.id}/audio`));
  } catch {
    delete panel.dataset.loaded;
    panel.innerHTML = '<p class="muted-note">LibriVox didn’t answer. Try again in a moment.</p>';
    return;
  }
  if (!panel.isConnected) return;
  if (!audio) {
    panel.innerHTML = '<p class="muted-note">No free audiobook of this edition yet. LibriVox volunteers record new ones every week.</p>';
    return;
  }
  // Same position in the book, when the recording splits it the same way.
  const start = audio.sections.length === book.parts.length ? partIndex : 0;
  panel.innerHTML = `
    <label class="sr-only" for="reader-audio-part">Audiobook section</label>
    <select id="reader-audio-part" class="reader-select">
      ${audio.sections.map((s, i) => `<option value="${i}" ${i === start ? 'selected' : ''}>${escapeHtml(s.title || `Section ${i + 1}`)}${s.seconds ? ` (${Math.round(s.seconds / 60)} min)` : ''}</option>`).join('')}
    </select>
    <audio controls preload="none" src="${escapeHtml(audio.sections[start].url)}"></audio>
    <p class="muted-note">Read by LibriVox volunteers, public domain${audio.totalTime ? ` · ${escapeHtml(audio.totalTime)} in all` : ''} ·
      <a href="${escapeHtml(audio.librivoxUrl)}" target="_blank" rel="noopener">LibriVox ↗</a></p>`;
  const player = panel.querySelector('audio');
  const select = panel.querySelector('select');
  select.addEventListener('change', () => {
    player.src = audio.sections[Number(select.value)].url;
    player.play().catch(() => {});
  });
  // Plays straight on through the sections.
  player.addEventListener('ended', () => {
    const next = Number(select.value) + 1;
    if (next < audio.sections.length) { select.value = String(next); select.dispatchEvent(new Event('change')); }
  });
}

// Select a passage, then share it as an image card.
function wireQuotes(root, textEl, book, part, partIndex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-pow btn-pow--sm btn-pow--pink reader-quote-btn';
  btn.textContent = '❝ Share quote';
  btn.hidden = true;
  root.querySelector('.reader').append(btn);
  let quote = '';

  const onSelect = () => {
    if (!root.isConnected) { document.removeEventListener('selectionchange', onSelect); return; }
    const sel = document.getSelection();
    const text = sel && !sel.isCollapsed && textEl.contains(sel.anchorNode) && textEl.contains(sel.focusNode)
      ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    quote = text.length >= QUOTE_MIN ? text.slice(0, QUOTE_MAX) : '';
    btn.hidden = !quote;
    if (quote) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      btn.style.top = `${Math.max(64, r.top - 48)}px`;
      btn.style.left = `${Math.min(window.innerWidth - 170, Math.max(8, r.left + r.width / 2 - 80))}px`;
    }
  };
  document.addEventListener('selectionchange', onSelect);

  btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
  btn.addEventListener('click', async () => {
    if (!quote) return;
    const text = quote.length >= QUOTE_MAX ? `${quote}…` : quote;
    const url = shareUrl('classic', book.id, { part: partIndex, quote: text });
    const caption = `“${text}” — ${book.title}`;
    try {
      const blob = await quoteCardBlob({ quote: text, title: book.title, author: book.authors.join(', '), chapter: part.title });
      const file = new File([blob], 'aninest-quote.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: book.title, text: `${caption}\n${url}` }); return; } catch (err) { if (err?.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aninest-quote.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      try { await navigator.clipboard.writeText(url); showToast('Quote card saved, and the link is copied.'); } catch { showToast('Quote card saved.'); }
    } catch {
      shareLink(url, caption);
    }
  });
}

export async function renderReader(root, id, params) {
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId <= 0) { root.innerHTML = emptyHTML('That book link looks broken.', '📜'); return; }
  root.innerHTML = skeletonDetail('Opening the book');

  let book = books.get(bookId);
  let mine = null;
  try {
    if (!book || Auth.get().user) {
      const res = await apiGet(`/api/novels/classics/${bookId}`);
      book = res.data;
      mine = res.mine;
      books.set(bookId, book);
    }
  } catch (err) {
    if (!root.isConnected) return;
    if (err.status === 404) { root.innerHTML = emptyHTML('That book isn’t available to read here. Only public-domain books are.', '📜'); return; }
    root.innerHTML = errorHTML(navigator.onLine === false
      ? 'You’re offline, and this book isn’t saved for offline reading.'
      : 'Project Gutenberg didn’t answer. Try again in a moment.');
    wireRetry(root, () => renderReader(root, id, params));
    return;
  }
  if (!root.isConnected) return;
  if (!mine) mine = localPosition(bookId);

  const asked = params.get('part');
  const partIndex = Math.min(book.parts.length - 1, Math.max(0, asked != null ? Number(asked) || 0 : (mine?.part || 0)));
  const part = book.parts[partIndex];
  const wordsBefore = book.parts.slice(0, partIndex).reduce((s, p) => s + p.words, 0);
  const percent = Math.round((wordsBefore / book.words) * 100);
  const prefs = loadPrefs();
  const partHref = (n) => `#/read/${bookId}?part=${n}`;
  const offline = isSavedOffline(bookId);
  document.title = `${book.title} — AniNest`;

  root.innerHTML = `
    <div class="reader" data-font="${prefs.font}" style="--reader-size:${SIZES[prefs.size]}rem">
      <div class="reader-bar">
        <a class="chip" href="#/novels/free">← Classics</a>
        <label class="sr-only" for="reader-part">Chapter</label>
        <select id="reader-part" class="reader-select">
          ${book.parts.map((p, i) => `<option value="${i}" ${i === partIndex ? 'selected' : ''}>${i + 1}. ${escapeHtml(p.title)}</option>`).join('')}
        </select>
        <div class="reader-tools" role="group" aria-label="Reading settings">
          <button class="chip" data-size="-1" aria-label="Smaller text" ${prefs.size === 0 ? 'disabled' : ''}>A−</button>
          <button class="chip" data-size="1" aria-label="Larger text" ${prefs.size === SIZES.length - 1 ? 'disabled' : ''}>A+</button>
          <button class="chip" data-font-toggle aria-label="Switch font">${prefs.font === 'serif' ? 'Sans' : 'Serif'}</button>
          <button class="chip" data-audio aria-expanded="false" aria-controls="reader-audio">🎧 Listen</button>
          ${canSaveOffline() || offline ? `<button class="chip" data-offline ${offline ? 'disabled' : ''} aria-label="Save this book for offline reading">${offline ? '✅ Offline' : '⬇️ Offline'}</button>` : ''}
          <button class="chip" data-share-chapter aria-label="Share this chapter">📤</button>
        </div>
        <div class="reader-progress" role="progressbar" aria-label="Progress through the book" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <span style="width:${percent}%"></span>
        </div>
      </div>
      <div id="reader-audio" class="reader-audio" hidden></div>

      <h1 class="reader-title">${escapeHtml(book.title)}</h1>
      ${aboutHTML(book, partIndex === 0 && !mine)}

      <p class="reader-info">
        ${book.parts.length > 1 ? `Chapter ${partIndex + 1} of ${book.parts.length} · ` : ''}~${minutes(part.words)} min · ${percent}% through the book<span data-streak></span>
        ${Auth.get().user ? '' : ' · <a href="#/login">Log in</a> to keep your place on every device and earn XP for finishing'}
      </p>
      ${watchAnimeHTML(bookId)}

      <article class="reader-text" id="reader-text" aria-busy="true">
        <h2>${escapeHtml(part.title)}</h2>
        <p class="muted-note">Loading the chapter…</p>
      </article>
      <p class="muted-note reader-tip">Tip: select a passage to share it as a quote card.</p>

      <nav class="reader-nav" aria-label="Chapters">
        ${partIndex > 0 ? `<a class="btn-pow btn-pow--sm btn-pow--outline" href="${partHref(partIndex - 1)}">◀ Previous</a>` : '<span></span>'}
        <span class="reader-nav-count">${partIndex + 1} / ${book.parts.length}</span>
        ${partIndex < book.parts.length - 1
    ? `<a class="btn-pow btn-pow--sm btn-pow--pink" href="${partHref(partIndex + 1)}">Next ▶</a>`
    : '<a class="btn-pow btn-pow--sm btn-pow--pink" href="#/novels/free">More classics ▶</a>'}
      </nav>

      <p class="reader-credit">
        Public domain in the United States. Text from <a href="${escapeHtml(book.sourceUrl)}" target="_blank" rel="noopener">Project Gutenberg ↗</a>.
        Copyright terms differ by country.
      </p>
    </div>`;

  const wrap = root.querySelector('.reader');
  root.querySelector('#reader-part').addEventListener('change', (e) => navigate(partHref(Number(e.target.value))));
  root.querySelector('.reader-tools').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-audio')) {
      const panel = root.querySelector('#reader-audio');
      openAudio(panel, book, partIndex);
      btn.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    if (btn.hasAttribute('data-offline')) { saveOffline(book, btn); return; }
    if (btn.hasAttribute('data-share-chapter')) {
      shareLink(shareUrl('classic', bookId, partIndex ? { part: partIndex } : null), `${book.title}: ${part.title}`);
      return;
    }
    if (btn.dataset.size) prefs.size = Math.min(SIZES.length - 1, Math.max(0, prefs.size + Number(btn.dataset.size)));
    if (btn.hasAttribute('data-font-toggle')) prefs.font = prefs.font === 'serif' ? 'sans' : 'serif';
    savePrefs(prefs);
    wrap.style.setProperty('--reader-size', `${SIZES[prefs.size]}rem`);
    wrap.dataset.font = prefs.font;
    root.querySelector('[data-size="-1"]').disabled = prefs.size === 0;
    root.querySelector('[data-size="1"]').disabled = prefs.size === SIZES.length - 1;
    root.querySelector('[data-font-toggle]').textContent = prefs.font === 'serif' ? 'Sans' : 'Serif';
  });

  // Arrow keys move between chapters (not while typing or choosing).
  const onKey = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input, select, textarea, audio')) return;
    if (e.key === 'ArrowRight' && partIndex < book.parts.length - 1) navigate(partHref(partIndex + 1));
    if (e.key === 'ArrowLeft' && partIndex > 0) navigate(partHref(partIndex - 1));
  };
  document.addEventListener('keydown', onKey);

  const textEl = root.querySelector('#reader-text');
  try {
    const { paragraphs } = await apiGet(`/api/novels/classics/${bookId}/parts/${partIndex}`);
    if (!textEl.isConnected) return;
    textEl.innerHTML = `<h2>${escapeHtml(part.title)}</h2>${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}`;
    textEl.removeAttribute('aria-busy');
    // Moving between chapters lands on the chapter heading, not above the book details.
    if (asked != null) textEl.scrollIntoView({ block: 'start' });
  } catch {
    if (!textEl.isConnected) return;
    textEl.innerHTML = errorHTML(navigator.onLine === false
      ? 'You’re offline, and this chapter isn’t saved. Use “⬇️ Offline” next time you’re online.'
      : 'This chapter didn’t load. Try again in a moment.');
    wireRetry(textEl, () => renderReader(root, id, params));
    return;
  }
  wireQuotes(root, textEl, book, part, partIndex);

  try {
    const { justFinished, streak, firstToday } = await savePosition(book, partIndex);
    if (!root.isConnected) return;
    if (streak > 1) root.querySelector('[data-streak]').textContent = ` · 🔥 ${streak}-day streak`;
    if (justFinished) {
      confetti();
      showToast(`📜 You finished ${book.title}! +40 XP`);
    } else if (firstToday && streak > 1) {
      showToast(`🔥 ${streak} days of reading in a row!`);
    }
  } catch {
    /* progress is a convenience; the chapter is already on screen */
  }
}

import { Games } from '../../lib/gamesApi.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, showToast } from '../../lib/ui.js';
import {
  recordLocalResult, getLocalStats, gameOverHTML, wireGameOver, challengeBannerHTML,
} from '../../lib/gameKit.js';
import {
  celebrateCorrect, lamentWrong, soundToggleHTML, wireSoundToggle, sfx,
} from '../../lib/gameFx.js';
import { navigate } from '../../lib/router.js';

// Timeline: tap the cards oldest first. The server deals the cards (4, then
// 5 from a streak of 5), keeps their years until the order is locked in,
// judges it, and records the score (backend/src/lib/roundGames.js).

const SLUG = 'timeline';
const LIVES = 3;
const REVEAL_MS = 2000;

export async function renderTimeline(root, params = new URLSearchParams()) {
  root.innerHTML = loadingHTML('WINDING THE CLOCK');
  const seed = params.get('seed');
  let state;
  try {
    state = await Games.roundStart(SLUG, { seed });
  } catch (err) {
    if (!root.isConnected) return;
    root.innerHTML = errorHTML(err.message || 'Couldn’t load anime for Timeline — try again shortly!');
    wireRetry(root, () => renderTimeline(root, params));
    return;
  }
  if (!root.isConnected) return; // left the page while it was dealing

  document.title = 'Timeline — AniNest';
  const best = getLocalStats(SLUG).best;
  let picked = []; // indexes into the cards, in the order tapped
  let locked = false;
  let over = false;

  const cards = () => state.round.cards;
  function hud() {
    return `
      <span class="stat-pill">${'❤️'.repeat(state.lives)}${'🖤'.repeat(LIVES - state.lives)}</span>
      <span class="stat-pill">🔥 Streak ${state.streak}</span>
      <span class="stat-pill">🏆 Best ${Math.max(best, state.streak)}</span>
      ${soundToggleHTML()}`;
  }

  function render() {
    root.innerHTML = `
      <div class="hl-header">
        <h1 class="section-title">📆 Timeline</h1>
        <div class="hl-stats">${hud()}</div>
      </div>
      ${challengeBannerHTML(seed)}
      <p class="section-sub">Tap the anime in release order: <strong>oldest first</strong>. Tap a numbered card again to undo.</p>
      <div class="timeline-cards fx-stagger" id="timeline-cards">
        ${cards().map((a, i) => {
          const pos = picked.indexOf(i);
          return `
            <button type="button" class="timeline-card ${pos >= 0 ? 'is-picked' : ''}" data-index="${i}" aria-pressed="${pos >= 0}">
              ${pos >= 0 ? `<span class="timeline-order">${pos + 1}</span>` : ''}
              ${a.image ? `<img src="${escapeHtml(a.image)}" alt="" loading="lazy" />` : ''}
              <span class="timeline-title">${escapeHtml(a.title)}</span>
              <span class="timeline-year" hidden></span>
            </button>`;
        }).join('')}
      </div>
      <div class="hl-actions">
        <button class="btn-pow btn-pow--pink" id="timeline-check" ${picked.length === cards().length ? '' : 'disabled'}>✔ LOCK IN</button>
        <button class="btn-pow btn-pow--sm btn-pow--outline" id="timeline-reset" ${picked.length ? '' : 'disabled'}>↺ RESET</button>
      </div>
      <p class="guess-reveal-title" id="timeline-result" aria-live="polite"></p>`;
    wireSoundToggle(root);
    root.querySelectorAll('.timeline-card').forEach((btn) => btn.addEventListener('click', () => tap(Number(btn.dataset.index))));
    root.querySelector('#timeline-check').addEventListener('click', check);
    root.querySelector('#timeline-reset').addEventListener('click', () => { if (!locked) { picked = []; render(); } });
  }

  function tap(i) {
    if (locked) return;
    const pos = picked.indexOf(i);
    if (pos >= 0) picked = picked.slice(0, pos); // undo this card and any after it
    else picked.push(i);
    sfx('click');
    render();
  }

  async function check() {
    if (locked || picked.length !== cards().length) return;
    locked = true;
    root.querySelectorAll('.hl-actions button, .timeline-card').forEach((b) => { b.disabled = true; });
    let out;
    try {
      out = await Games.roundAnswer(state.runId, { order: picked.map((i) => cards()[i].id) });
    } catch (err) {
      if (!root.isConnected) return;
      showToast(err.message || 'Lost connection — try that again.');
      if (err.status === 404) { renderTimeline(root, params); return; }
      locked = false;
      render();
      return;
    }
    if (!root.isConnected || over) return;

    const years = out.reveal.years;
    const truth = [...cards()].sort((a, b) => years[a.id] - years[b.id]);
    root.querySelectorAll('.timeline-card').forEach((btn) => {
      const a = cards()[Number(btn.dataset.index)];
      const yearEl = btn.querySelector('.timeline-year');
      yearEl.textContent = String(years[a.id]);
      yearEl.hidden = false;
      const right = picked.indexOf(Number(btn.dataset.index)) === truth.indexOf(a);
      btn.classList.add(right ? 'is-right' : 'is-wrong');
    });
    const result = root.querySelector('#timeline-result');
    if (result) result.textContent = truth.map((a) => years[a.id]).join(' → ');
    const area = root.querySelector('#timeline-cards');
    if (out.correct) celebrateCorrect(out.streak, area);
    else lamentWrong(area);
    state = { ...state, streak: out.streak, lives: out.lives };
    const hudEl = root.querySelector('.hl-stats');
    if (hudEl) { hudEl.innerHTML = hud(); wireSoundToggle(hudEl); }

    setTimeout(() => {
      if (over || !root.isConnected) return;
      if (out.gameOver) { finish(out.streak); return; }
      state = out.next;
      picked = [];
      locked = false;
      render();
    }, REVEAL_MS);
  }

  function finish(streak) {
    over = true;
    const stats = recordLocalResult(SLUG, streak);
    root.innerHTML = gameOverHTML({ emoji: '📆', score: streak, scoreLabel: 'Timelines sorted', stats, slug: SLUG });
    wireGameOver(root, {
      stats,
      onReplay: () => (seed ? navigate('#/games/timeline') : renderTimeline(root)),
      challenge: { text: `I sorted ${streak} timelines in AniNest's Timeline game. Your turn!`, path: '/games/timeline', params: {} },
    });
  }

  window.addEventListener('hashchange', () => { over = true; }, { once: true });
  render();
}

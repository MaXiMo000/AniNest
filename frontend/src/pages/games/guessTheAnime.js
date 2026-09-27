import { Games } from '../../lib/gamesApi.js';
import { API_BASE } from '../../lib/http.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, showToast } from '../../lib/ui.js';
import { roundPoints } from '../../lib/guessMechanic.js';
import {
  recordLocalResult, getLocalStats, gameOverHTML, wireGameOver, challengeBannerHTML,
} from '../../lib/gameKit.js';
import {
  sfx, celebrateCorrect, lamentWrong, soundToggleHTML, wireSoundToggle, popText, bounce,
} from '../../lib/gameFx.js';
import { navigate } from '../../lib/router.js';

// Guess the Anime. The server deals and judges every round
// (backend/src/lib/roundGames.js): it picks the show, sends the clues and
// choices (never the answer), serves the blurred cover through our own API so
// the image address can't give it away, checks typed answers, keeps the
// lives and the Blitz clock, and records the score. The page draws it, and
// keeps the points (which aren't ranked).

const REVEAL_DELAY_MS = 1600;
const BLITZ_REVEAL_MS = 650;
const BLITZ_SECONDS = 60;
const BLITZ_WRONG_PENALTY_S = 3;
const LIVES = 3;

const DIFFICULTIES = {
  easy: { label: 'Easy', emoji: '🌱', desc: 'Famous shows. Synopsis shown from the start. Just for fun (no leaderboard).', game: 'gta-easy', ranked: false },
  normal: { label: 'Normal', emoji: '⚔️', desc: 'Any anime from the pool. Cover only — buy clues if you need them.', game: 'guess-the-anime', ranked: true },
  hard: { label: 'Hard', emoji: '🔥', desc: 'Deep cuts only: the lesser-known 60% of the pool.', game: 'gta-hard', ranked: true },
};

// The clue ladder, bought one step at a time. Each step lowers the points the
// round is worth (see roundPoints). BLUR_BY_CLUES is the cover blur per step.
const CLUES = [
  { id: 'synopsis', label: '📜 Synopsis' },
  { id: 'meta', label: '🏷️ Genres & format' },
  { id: 'facts', label: '📅 Year & studio' },
  { id: 'unblur', label: '🔍 Clearer cover' },
];
const BLUR_BY_CLUES = [28, 26, 22, 18, 7];

const legacyKeyFor = (difficulty) => (difficulty === 'normal' ? 'aninest_gta_best' : null);
const localSlugFor = (difficulty) => (DIFFICULTIES[difficulty].ranked ? DIFFICULTIES[difficulty].game : `gta-local-${difficulty}`);
const bestFor = (difficulty) => getLocalStats(localSlugFor(difficulty), legacyKeyFor(difficulty)).best;

function setupHTML() {
  return `
    <div class="section-head">
      <h1 class="section-title">🕵️ Guess the Anime</h1>
      <span class="section-sub">A blurred cover and a stack of clues. How far can your streak go?</span>
    </div>
    <h2 class="setup-heading">1. Pick a difficulty</h2>
    <div class="setup-grid fx-stagger" role="radiogroup" aria-label="Difficulty">
      ${Object.entries(DIFFICULTIES).map(([key, d]) => `
        <button type="button" class="setup-option ${key === 'normal' ? 'is-selected' : ''}" data-diff="${key}" role="radio" aria-checked="${key === 'normal'}">
          <span class="setup-option-emoji">${d.emoji}</span>
          <strong>${d.label}</strong>
          <span>${d.desc}</span>
          <span class="setup-option-best">Best: ${bestFor(key)}</span>
        </button>`).join('')}
    </div>
    <h2 class="setup-heading">2. How do you answer?</h2>
    <div class="setup-grid setup-grid--two" role="radiogroup" aria-label="Answer style">
      <button type="button" class="setup-option is-selected" data-input="choices" role="radio" aria-checked="true">
        <span class="setup-option-emoji">🔢</span><strong>Multiple choice</strong><span>Four options. Keys 1–4 work too.</span>
      </button>
      <button type="button" class="setup-option" data-input="typed" role="radio" aria-checked="false">
        <span class="setup-option-emoji">⌨️</span><strong>Type it</strong><span>For experts: type the title, with suggestions.</span>
      </button>
    </div>
    <div class="hero-actions setup-actions">
      <button class="btn-pow btn-pow--pink" id="start-classic">▶ PLAY (${LIVES} LIVES)</button>
      <button class="btn-pow btn-pow--blue" id="start-blitz">⚡ BLITZ: ${BLITZ_SECONDS} SECONDS</button>
    </div>
    <p class="section-sub setup-note">Blitz: multiple choice against the clock. Wrong answers cost ${BLITZ_WRONG_PENALTY_S} seconds. Best: ${getLocalStats('gta-blitz').best}</p>
    <div class="games-leaderboard-links">
      <a href="#/games/leaderboard/guess-the-anime">🏆 Normal</a>
      <a href="#/games/leaderboard/gta-hard">🏆 Hard</a>
      <a href="#/games/leaderboard/gta-blitz">🏆 Blitz</a>
    </div>`;
}

export function renderGuessTheAnime(root, params = new URLSearchParams()) {
  document.title = 'Guess the Anime — AniNest';
  // A challenge link skips the setup screen and starts the same run.
  const seed = params.get('seed');
  if (seed) {
    const mode = params.get('mode') === 'blitz' ? 'blitz' : 'classic';
    const difficulty = DIFFICULTIES[params.get('diff')] ? params.get('diff') : 'normal';
    const input = params.get('input') === 'typed' ? 'typed' : 'choices';
    play(root, { mode, difficulty, input, seed });
    return;
  }

  root.innerHTML = setupHTML();
  let difficulty = 'normal';
  let input = 'choices';
  const select = (attr, value) => {
    root.querySelectorAll(`[data-${attr}]`).forEach((b) => {
      const on = b.dataset[attr] === value;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  root.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { difficulty = b.dataset.diff; select('diff', difficulty); sfx('click'); }));
  root.querySelectorAll('[data-input]').forEach((b) => b.addEventListener('click', () => { input = b.dataset.input; select('input', input); sfx('click'); }));
  root.querySelector('#start-classic').addEventListener('click', () => play(root, { mode: 'classic', difficulty, input }));
  root.querySelector('#start-blitz').addEventListener('click', () => play(root, { mode: 'blitz', difficulty: 'normal', input: 'choices' }));
}

async function play(root, { mode, difficulty, input, seed = null }) {
  const blitz = mode === 'blitz';
  const game = blitz ? 'gta-blitz' : DIFFICULTIES[difficulty].game;
  const ranked = blitz || DIFFICULTIES[difficulty].ranked;
  const localSlug = blitz ? 'gta-blitz' : localSlugFor(difficulty);
  root.innerHTML = loadingHTML('BLURRING A COVER');

  let state;
  try {
    state = await Games.roundStart(game, { seed, input: blitz ? 'choices' : input });
  } catch (err) {
    if (!root.isConnected) return;
    root.innerHTML = errorHTML(err.message || 'Couldn’t start the game — try again shortly!');
    wireRetry(root, () => play(root, { mode, difficulty, input, seed }));
    return;
  }
  if (!root.isConnected) return; // left the page while it was dealing

  const typed = !blitz && input === 'typed';
  const titles = state.titles || [];
  let points = 0;
  let cluesUsed = difficulty === 'easy' && !blitz ? 1 : 0; // Easy starts with the synopsis
  let locked = false;
  let over = false;
  let timeLeft = blitz ? Math.ceil(state.msLeft / 1000) : BLITZ_SECONDS;
  let timer = null;
  const recap = []; // { label, href, correct }
  const best = getLocalStats(localSlug, legacyKeyFor(difficulty)).best;

  function cluesHTML() {
    const c = state.round.clues;
    if (blitz) return `<div class="speech-bubble">${escapeHtml(c.synopsis)}</div>`;
    const parts = [];
    if (cluesUsed >= 1) parts.push(`<div class="speech-bubble fx-pop-in">${escapeHtml(c.synopsis)}</div>`);
    const chips = [];
    if (cluesUsed >= 2) {
      chips.push(...c.genres.map(escapeHtml));
      if (c.type) chips.push(escapeHtml(c.type));
      if (c.episodes) chips.push(`${Number(c.episodes)} ep`);
    }
    if (cluesUsed >= 3) {
      if (c.year) chips.push(`📅 ${Number(c.year)}`);
      if (c.studio) chips.push(`🏢 ${escapeHtml(c.studio)}`);
      if (c.source) chips.push(`📚 ${escapeHtml(c.source)}`);
    }
    if (chips.length) parts.push(`<div class="clue-chips fx-stagger">${chips.map((x) => `<span class="stat-pill">${x}</span>`).join('')}</div>`);
    const next = CLUES[cluesUsed];
    parts.push(next
      ? `<button type="button" class="btn-pow btn-pow--sm btn-pow--outline clue-btn" id="buy-clue">Clue: ${next.label} <span class="clue-cost">(−20 pts)</span></button>`
      : '<p class="section-sub clue-done">All clues used. Trust your gut!</p>');
    return parts.join('');
  }

  function answerAreaHTML() {
    if (typed) {
      return `
        <form class="typed-answer" id="typed-form" autocomplete="off">
          <input id="typed-input" list="gta-titles" placeholder="Type the anime title…" aria-label="Your answer" />
          <datalist id="gta-titles">${titles.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('')}</datalist>
          <button type="submit" class="btn-pow btn-pow--pink">GUESS</button>
          <button type="button" class="btn-pow btn-pow--outline" id="give-up">SKIP (−1 ❤️)</button>
        </form>`;
    }
    return `
      <div class="guess-choices" id="guess-choices">
        ${state.round.choices.map((c, i) => `<button class="guess-choice" data-id="${escapeHtml(c.id)}"><kbd>${i + 1}</kbd> ${escapeHtml(c.label)}</button>`).join('')}
      </div>`;
  }

  function hudHTML() {
    const pills = blitz
      ? [`⏱️ <span id="blitz-time">${Math.max(0, timeLeft)}</span>s`, `✅ ${state.streak}`, `🏆 Best ${Math.max(best, state.streak)}`]
      : [`${'❤️'.repeat(state.lives)}${'🖤'.repeat(LIVES - state.lives)}`, `🔥 Streak ${state.streak}`, `⭐ ${points} pts`, `🏆 Best ${Math.max(best, state.streak)}`];
    return pills.map((p) => `<span class="stat-pill">${p}</span>`).join('');
  }
  const refreshHud = () => {
    const hud = root.querySelector('.hl-stats');
    if (hud) { hud.innerHTML = hudHTML() + soundToggleHTML(); wireSoundToggle(root); }
  };

  function renderRound() {
    if (over) return;
    locked = false;
    const blur = blitz ? 14 : BLUR_BY_CLUES[cluesUsed];
    const diffLabel = blitz ? 'Blitz' : DIFFICULTIES[difficulty].label;
    root.innerHTML = `
      <div class="guess-header">
        <h1 class="section-title">🕵️ Guess the Anime <span class="mode-tag">${diffLabel}</span></h1>
        <div class="hl-stats">${hudHTML()}${soundToggleHTML()}</div>
      </div>
      ${challengeBannerHTML(seed)}
      ${blitz ? `<div class="blitz-bar"><div class="blitz-bar-fill" id="blitz-fill" style="width:${(Math.max(0, timeLeft) / BLITZ_SECONDS) * 100}%"></div></div>` : ''}
      <div class="guess-arena fx-slide-in" id="guess-arena">
        <div class="guess-poster-frame" id="guess-poster">
          <img src="${escapeHtml(API_BASE + state.round.cover)}" alt="Mystery anime cover" style="filter:blur(${blur}px) saturate(0.7) brightness(0.85)" />
          <span class="guess-poster-mark">?</span>
        </div>
        <p class="guess-reveal-title" id="guess-reveal-title" aria-live="polite"></p>
        <div id="clue-area">${cluesHTML()}</div>
        ${answerAreaHTML()}
      </div>`;
    wireSoundToggle(root);
    root.querySelectorAll('.guess-choice').forEach((btn) => btn.addEventListener('click', () => submit({ answer: btn.dataset.id }, btn.dataset.id)));
    root.querySelector('#buy-clue')?.addEventListener('click', buyClue);
    const form = root.querySelector('#typed-form');
    if (form) {
      const inputEl = form.querySelector('#typed-input');
      inputEl.focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = inputEl.value.trim();
        if (value) submit({ typed: value });
      });
      form.querySelector('#give-up').addEventListener('click', () => submit({ giveUp: true }));
    }
  }

  function buyClue() {
    if (locked || cluesUsed >= CLUES.length) return;
    cluesUsed += 1;
    sfx('reveal');
    const imgEl = root.querySelector('#guess-poster img');
    if (imgEl) imgEl.style.filter = `blur(${BLUR_BY_CLUES[cluesUsed]}px) saturate(0.8) brightness(0.9)`;
    root.querySelector('#clue-area').innerHTML = cluesHTML();
    root.querySelector('#buy-clue')?.addEventListener('click', buyClue);
  }

  async function submit(body, chosenId = null) {
    if (locked || over) return;
    locked = true;
    const controls = root.querySelectorAll('.guess-choice, #typed-form input, #typed-form button, #buy-clue');
    controls.forEach((el) => { el.disabled = true; });
    let out;
    try {
      out = await Games.roundAnswer(state.runId, body);
    } catch (err) {
      if (!root.isConnected || over) return;
      showToast(err.message || 'Lost connection — try that again.');
      if (err.status === 404) { finish(state.streak); return; }
      locked = false;
      controls.forEach((el) => { el.disabled = false; });
      return;
    }
    if (!root.isConnected || over) return;

    // A typed miss costs a life but the round stays open.
    if (out.retry) {
      state = { ...state, lives: out.lives };
      const form = root.querySelector('#typed-form');
      lamentWrong(form);
      popText(`NOPE! ${out.lives} ❤️ left`, { anchor: form, color: 'var(--pink)' });
      refreshHud();
      locked = false;
      controls.forEach((el) => { el.disabled = false; });
      const inputEl = root.querySelector('#typed-input');
      if (inputEl) { inputEl.value = ''; inputEl.focus(); }
      return;
    }
    resolve(out, chosenId);
  }

  function resolve(out, chosenId) {
    root.querySelectorAll('.guess-choice').forEach((btn) => {
      if (btn.dataset.id === String(out.solution)) btn.classList.add('is-correct');
      else if (btn.dataset.id === chosenId) btn.classList.add('is-wrong');
      else btn.classList.add('is-muted');
    });
    const imgEl = root.querySelector('#guess-poster img');
    if (imgEl) imgEl.style.filter = 'blur(0) saturate(1) brightness(1)';
    root.querySelector('#guess-poster')?.classList.add('is-revealed');
    const titleEl = root.querySelector('#guess-reveal-title');
    if (titleEl && out.reveal?.title) titleEl.textContent = out.reveal.title;
    if (out.recap) recap.push({ ...out.recap, correct: out.correct });

    const poster = root.querySelector('#guess-poster');
    if (out.correct) {
      const gained = blitz ? 0 : roundPoints(cluesUsed, state.streak);
      points += gained;
      celebrateCorrect(out.streak, poster);
      bounce(poster);
      if (gained) popText(`+${gained}`, { anchor: titleEl, color: 'var(--green)' });
    } else {
      lamentWrong(root.querySelector('#guess-arena'));
      if (blitz) {
        timeLeft = Math.max(0, timeLeft - BLITZ_WRONG_PENALTY_S);
        popText(`−${BLITZ_WRONG_PENALTY_S}s`, { anchor: poster, color: 'var(--pink)' });
      }
    }
    state = { ...state, streak: out.streak, lives: out.lives };
    refreshHud();

    setTimeout(() => {
      if (over || !root.isConnected) return;
      if (out.gameOver) { finish(out.streak); return; }
      state = out.next;
      if (blitz && state.msLeft != null) timeLeft = Math.ceil(state.msLeft / 1000);
      cluesUsed = difficulty === 'easy' && !blitz ? 1 : 0;
      renderRound();
    }, blitz ? BLITZ_REVEAL_MS : REVEAL_DELAY_MS);
  }

  async function tick() {
    timeLeft -= 1;
    const t = root.querySelector('#blitz-time');
    if (t) t.textContent = String(Math.max(0, timeLeft));
    const fill = root.querySelector('#blitz-fill');
    if (fill) fill.style.width = `${(Math.max(0, timeLeft) / BLITZ_SECONDS) * 100}%`;
    if (timeLeft <= 10 && timeLeft > 0) sfx('tick');
    if (timeLeft <= 0 && !over) {
      clearInterval(timer);
      locked = true;
      // The server has the real clock; this ends the run once it agrees.
      let out = null;
      for (let i = 0; i < 3 && !out; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        out = await Games.roundFinish(state.runId).catch(() => null);
        // eslint-disable-next-line no-await-in-loop
        if (!out) await new Promise((r) => { setTimeout(r, 800); });
      }
      finish(out?.streak ?? state.streak);
    }
  }

  function onKey(e) {
    if (!root.isConnected || over) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest?.('input, textarea')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4) root.querySelectorAll('.guess-choice')[n - 1]?.click();
  }

  function finish(streak) {
    if (over) return;
    over = true;
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', stop);
    const stats = recordLocalResult(localSlug, streak, legacyKeyFor(difficulty));
    const recapHTML = recap.length ? `
      <details class="recap"><summary>Round recap (${recap.filter((r) => r.correct).length}/${recap.length})</summary>
        <ul class="recap-list">${recap.slice(-20).map((r) => `<li class="${r.correct ? 'is-right' : 'is-wrong'}">${r.correct ? '✅' : '❌'} ${r.href ? `<a href="${escapeHtml(r.href)}">${escapeHtml(r.label)}</a>` : escapeHtml(r.label)}</li>`).join('')}</ul>
      </details>` : '';
    root.innerHTML = gameOverHTML({
      emoji: blitz ? '⏱️' : '🔍',
      title: blitz ? "TIME'S UP!" : 'GAME OVER',
      score: streak,
      scoreLabel: 'Correct answers',
      stats,
      slug: ranked ? game : 'guess-the-anime',
      leaderboard: ranked,
      extra: `${blitz ? '' : `<p class="section-sub">⭐ ${points} points</p>`}${recapHTML}`,
    });
    wireGameOver(root, {
      stats,
      onReplay: () => (seed ? navigate('#/games/guess-the-anime') : renderGuessTheAnime(root)),
      challenge: {
        text: `I got ${streak} right in AniNest's Guess the Anime (${blitz ? 'Blitz' : DIFFICULTIES[difficulty].label}). Can you beat me?`,
        path: '/games/guess-the-anime',
        params: { mode, diff: difficulty, input },
      },
    });
  }

  // Leaving the page mid-run stops the clock and listeners.
  function stop() { over = true; clearInterval(timer); document.removeEventListener('keydown', onKey); }
  window.addEventListener('hashchange', stop, { once: true });
  document.addEventListener('keydown', onKey);
  if (blitz) timer = setInterval(tick, 1000);
  renderRound();
}

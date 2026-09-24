import { getAnimePool } from '../../lib/animePool.js';
import { imageOf } from '../../lib/api.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry } from '../../lib/ui.js';
import { shuffle } from '../../lib/shuffle.js';
import {
  synopsisSnippet, pickChoices, typedGuessMatches, poolForDifficulty, roundPoints,
} from '../../lib/guessMechanic.js';
import { randomFor, stableOrder } from '../../lib/rng.js';
import {
  startServerRun, recordLocalResult, getLocalStats, gameOverHTML, wireGameOver, challengeBannerHTML,
} from '../../lib/gameKit.js';
import {
  sfx, celebrateCorrect, lamentWrong, soundToggleHTML, wireSoundToggle, popText, bounce,
} from '../../lib/gameFx.js';
import { navigate } from '../../lib/router.js';
import { freshFirst, markSeen } from '../../lib/recentlySeen.js';

const MIN_SYNOPSIS_LEN = 60;
const REVEAL_DELAY_MS = 1600;
const BLITZ_REVEAL_MS = 650;
const BLITZ_SECONDS = 60;
const BLITZ_WRONG_PENALTY_S = 3;
const LIVES = 3;

const DIFFICULTIES = {
  easy: { label: 'Easy', emoji: '🌱', desc: 'Famous shows. Synopsis shown from the start. Just for fun (no leaderboard).', slug: null },
  normal: { label: 'Normal', emoji: '⚔️', desc: 'Any anime from the pool. Cover only — buy clues if you need them.', slug: 'guess-the-anime' },
  hard: { label: 'Hard', emoji: '🔥', desc: 'Deep cuts only: the lesser-known 60% of the pool.', slug: 'gta-hard' },
};

// The clue ladder, bought one step at a time. Each step lowers the points the
// round is worth (see roundPoints). `blur` is the cover blur after that step.
const CLUES = [
  { id: 'synopsis', label: '📜 Synopsis' },
  { id: 'meta', label: '🏷️ Genres & format' },
  { id: 'facts', label: '📅 Year & studio' },
  { id: 'unblur', label: '🔍 Clearer cover' },
];
const BLUR_BY_CLUES = [28, 26, 22, 18, 7];

function legacyKeyFor(difficulty) {
  return difficulty === 'normal' ? 'aninest_gta_best' : null;
}

function bestFor(difficulty) {
  return getLocalStats(DIFFICULTIES[difficulty].slug || `gta-local-${difficulty}`, legacyKeyFor(difficulty)).best;
}

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

export async function renderGuessTheAnime(root, params = new URLSearchParams()) {
  root.innerHTML = loadingHTML('BLURRING A COVER');

  let rawPool;
  try {
    rawPool = await getAnimePool();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load anime for the game — try again shortly!');
    wireRetry(root, () => renderGuessTheAnime(root, params));
    return;
  }

  const basePool = rawPool.filter((a) => (a.synopsis || '').length >= MIN_SYNOPSIS_LEN && imageOf(a));
  if (basePool.length < 8) {
    root.innerHTML = errorHTML('Not enough anime data available right now to play. Try again shortly!');
    wireRetry(root, () => renderGuessTheAnime(root, params));
    return;
  }

  document.title = 'Guess the Anime — AniNest';

  // A challenge link skips the setup screen and starts the same run.
  const seed = params.get('seed');
  if (seed) {
    const mode = params.get('mode') === 'blitz' ? 'blitz' : 'classic';
    const difficulty = DIFFICULTIES[params.get('diff')] ? params.get('diff') : 'normal';
    const input = params.get('input') === 'typed' ? 'typed' : 'choices';
    play(root, basePool, { mode, difficulty, input, seed });
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
  root.querySelector('#start-classic').addEventListener('click', () => play(root, basePool, { mode: 'classic', difficulty, input }));
  root.querySelector('#start-blitz').addEventListener('click', () => play(root, basePool, { mode: 'blitz', difficulty: 'normal', input: 'choices' }));
}

function play(root, basePool, { mode, difficulty, input, seed = null }) {
  const blitz = mode === 'blitz';
  const pool = poolForDifficulty(basePool, blitz ? 'normal' : difficulty);
  const rand = randomFor(seed);
  const slug = blitz ? 'gta-blitz' : DIFFICULTIES[difficulty].slug;
  const localSlug = blitz ? 'gta-blitz' : (slug || `gta-local-${difficulty}`);
  const run = slug ? startServerRun(slug) : { submit() {} };
  const titleList = [...new Set(basePool.flatMap((a) => [a.title, a.title_english].filter(Boolean)))].sort();

  // All modes share one "recently seen" memory; challenge runs skip it so
  // they deal the exact same deck for everyone.
  const SEEN_KEY = 'guess-the-anime';
  const deal = (list) => (seed ? shuffle(list, rand) : freshFirst(shuffle(list, rand), SEEN_KEY));
  let deck = deal(seed ? stableOrder(pool) : pool);
  let answer = deck.pop();
  let streak = 0;
  let points = 0;
  let lives = LIVES;
  let cluesUsed = difficulty === 'easy' ? 1 : 0; // Easy starts with the synopsis
  let locked = false;
  let timeLeft = BLITZ_SECONDS;
  let timer = null;
  let over = false;
  const recap = []; // { anime, correct }
  const best = getLocalStats(localSlug, legacyKeyFor(difficulty)).best;

  function drawAnswer() {
    if (deck.length === 0) deck = deal(pool.filter((a) => a.mal_id !== answer.mal_id));
    answer = deck.pop();
    cluesUsed = difficulty === 'easy' && !blitz ? 1 : 0;
  }

  function cluesHTML() {
    if (blitz) return `<div class="speech-bubble">${escapeHtml(synopsisSnippet(answer))}</div>`;
    const parts = [];
    if (cluesUsed >= 1) parts.push(`<div class="speech-bubble fx-pop-in">${escapeHtml(synopsisSnippet(answer))}</div>`);
    const chips = [];
    if (cluesUsed >= 2) {
      chips.push(...(answer.genres || []).slice(0, 4).map((g) => escapeHtml(g.name)));
      if (answer.type) chips.push(escapeHtml(answer.type));
      if (answer.episodes) chips.push(`${answer.episodes} ep`);
    }
    if (cluesUsed >= 3) {
      if (answer.year) chips.push(`📅 ${answer.year}`);
      if (answer.studios?.[0]?.name) chips.push(`🏢 ${escapeHtml(answer.studios[0].name)}`);
      if (answer.source) chips.push(`📚 ${escapeHtml(answer.source)}`);
    }
    if (chips.length) parts.push(`<div class="clue-chips fx-stagger">${chips.map((c) => `<span class="stat-pill">${c}</span>`).join('')}</div>`);
    const next = CLUES[cluesUsed];
    parts.push(next
      ? `<button type="button" class="btn-pow btn-pow--sm btn-pow--outline clue-btn" id="buy-clue">Clue: ${next.label} <span class="clue-cost">(−20 pts)</span></button>`
      : '<p class="section-sub clue-done">All clues used. Trust your gut!</p>');
    return parts.join('');
  }

  function answerAreaHTML(choices) {
    if (input === 'typed' && !blitz) {
      return `
        <form class="typed-answer" id="typed-form" autocomplete="off">
          <input id="typed-input" list="gta-titles" placeholder="Type the anime title…" aria-label="Your answer" />
          <datalist id="gta-titles">${titleList.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('')}</datalist>
          <button type="submit" class="btn-pow btn-pow--pink">GUESS</button>
          <button type="button" class="btn-pow btn-pow--outline" id="give-up">SKIP (−1 ❤️)</button>
        </form>`;
    }
    return `
      <div class="guess-choices" id="guess-choices">
        ${choices.map((c, i) => `<button class="guess-choice" data-id="${c.mal_id}"><kbd>${i + 1}</kbd> ${escapeHtml(c.title)}</button>`).join('')}
      </div>`;
  }

  function hudHTML() {
    const pills = blitz
      ? [`⏱️ <span id="blitz-time">${timeLeft}</span>s`, `✅ ${streak}`, `🏆 Best ${Math.max(best, streak)}`]
      : [`${'❤️'.repeat(lives)}${'🖤'.repeat(LIVES - lives)}`, `🔥 Streak ${streak}`, `⭐ ${points} pts`, `🏆 Best ${Math.max(best, streak)}`];
    return pills.map((p) => `<span class="stat-pill">${p}</span>`).join('');
  }

  function renderRound() {
    if (over) return;
    locked = false;
    if (!seed) markSeen(SEEN_KEY, answer.mal_id);
    const choices = pickChoices(pool, answer, 3, rand);
    const img = imageOf(answer);
    const blur = blitz ? 14 : BLUR_BY_CLUES[cluesUsed];
    const diffLabel = blitz ? 'Blitz' : DIFFICULTIES[difficulty].label;

    root.innerHTML = `
      <div class="guess-header">
        <h1 class="section-title">🕵️ Guess the Anime <span class="mode-tag">${diffLabel}</span></h1>
        <div class="hl-stats">${hudHTML()}${soundToggleHTML()}</div>
      </div>
      ${challengeBannerHTML(seed)}
      ${blitz ? `<div class="blitz-bar"><div class="blitz-bar-fill" id="blitz-fill" style="width:${(timeLeft / BLITZ_SECONDS) * 100}%"></div></div>` : ''}
      <div class="guess-arena fx-slide-in" id="guess-arena">
        <div class="guess-poster-frame" id="guess-poster">
          ${img ? `<img src="${escapeHtml(img)}" alt="Mystery anime cover" style="filter:blur(${blur}px) saturate(0.7) brightness(0.85)" />` : ''}
          <span class="guess-poster-mark">?</span>
        </div>
        <p class="guess-reveal-title" id="guess-reveal-title" aria-live="polite"></p>
        <div id="clue-area">${cluesHTML()}</div>
        ${answerAreaHTML(choices)}
      </div>
    `;
    wireSoundToggle(root);

    root.querySelectorAll('.guess-choice').forEach((btn) => {
      btn.addEventListener('click', () => resolve(Number(btn.dataset.id) === answer.mal_id, Number(btn.dataset.id)));
    });
    root.querySelector('#buy-clue')?.addEventListener('click', buyClue);
    const form = root.querySelector('#typed-form');
    if (form) {
      const inputEl = form.querySelector('#typed-input');
      inputEl.focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = inputEl.value.trim();
        if (!value) return;
        if (typedGuessMatches(value, answer)) resolve(true);
        else {
          // A typed miss costs a life but keeps the round going, so a typo
          // isn't the end of it - until the lives run out.
          lives -= 1;
          lamentWrong(form);
          inputEl.value = '';
          popText(`NOPE! ${lives} ❤️ left`, { anchor: form, color: 'var(--pink)' });
          if (lives <= 0) {
            resolve(false, null, { lifeTaken: true });
          } else {
            root.querySelector('.hl-stats').innerHTML = hudHTML() + soundToggleHTML();
            wireSoundToggle(root);
          }
        }
      });
      form.querySelector('#give-up').addEventListener('click', () => resolve(false));
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

  function revealAnswer() {
    const imgEl = root.querySelector('#guess-poster img');
    if (imgEl) imgEl.style.filter = 'blur(0) saturate(1) brightness(1)';
    root.querySelector('#guess-poster')?.classList.add('is-revealed');
    const titleEl = root.querySelector('#guess-reveal-title');
    if (titleEl) titleEl.textContent = answer.title;
  }

  // `lifeTaken`: a typed miss already cost its life before resolving the round.
  function resolve(correct, chosenId = null, { lifeTaken = false } = {}) {
    if (locked || over) return;
    locked = true;
    root.querySelectorAll('.guess-choice').forEach((btn) => {
      btn.disabled = true;
      const id = Number(btn.dataset.id);
      if (id === answer.mal_id) btn.classList.add('is-correct');
      else if (id === chosenId) btn.classList.add('is-wrong');
      else btn.classList.add('is-muted');
    });
    root.querySelectorAll('#typed-form input, #typed-form button, #buy-clue').forEach((el) => { el.disabled = true; });
    revealAnswer();
    recap.push({ anime: answer, correct });

    const poster = root.querySelector('#guess-poster');
    if (correct) {
      streak += 1;
      const gained = blitz ? 0 : roundPoints(cluesUsed, streak - 1);
      points += gained;
      celebrateCorrect(streak, poster);
      bounce(poster);
      if (gained) popText(`+${gained}`, { anchor: root.querySelector('#guess-reveal-title'), color: 'var(--green)' });
    } else {
      lamentWrong(root.querySelector('#guess-arena'));
      if (blitz) {
        timeLeft = Math.max(0, timeLeft - BLITZ_WRONG_PENALTY_S);
        popText(`−${BLITZ_WRONG_PENALTY_S}s`, { anchor: poster, color: 'var(--pink)' });
      } else if (!lifeTaken) {
        lives -= 1;
      }
    }

    setTimeout(() => {
      if (over) return;
      if (!blitz && lives <= 0) { finish(); return; }
      drawAnswer();
      renderRound();
    }, blitz ? BLITZ_REVEAL_MS : REVEAL_DELAY_MS);
  }

  function tick() {
    timeLeft -= 1;
    const t = root.querySelector('#blitz-time');
    if (t) t.textContent = String(Math.max(0, timeLeft));
    const fill = root.querySelector('#blitz-fill');
    if (fill) fill.style.width = `${(Math.max(0, timeLeft) / BLITZ_SECONDS) * 100}%`;
    if (timeLeft <= 10 && timeLeft > 0) sfx('tick');
    if (timeLeft <= 0) finish();
  }

  function onKey(e) {
    if (!root.isConnected || over) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest?.('input, textarea')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4) root.querySelectorAll('.guess-choice')[n - 1]?.click();
  }

  function finish() {
    if (over) return;
    over = true;
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', stop);
    run.submit(streak);
    const stats = recordLocalResult(localSlug, streak, legacyKeyFor(difficulty));
    const recapHTML = recap.length ? `
      <details class="recap"><summary>Round recap (${recap.filter((r) => r.correct).length}/${recap.length})</summary>
        <ul class="recap-list">${recap.slice(-20).map((r) => `<li class="${r.correct ? 'is-right' : 'is-wrong'}">${r.correct ? '✅' : '❌'} <a href="#/anime/${r.anime.mal_id}">${escapeHtml(r.anime.title)}</a></li>`).join('')}</ul>
      </details>` : '';
    root.innerHTML = gameOverHTML({
      emoji: blitz ? '⏱️' : '🔍',
      title: blitz ? "TIME'S UP!" : 'GAME OVER',
      score: streak,
      scoreLabel: 'Correct answers',
      stats,
      slug: slug || 'guess-the-anime',
      leaderboard: Boolean(slug),
      extra: `${blitz ? '' : `<p class="section-sub">⭐ ${points} points</p>`}${recapHTML}`,
    });
    wireGameOver(root, {
      stats,
      // From a challenge link, drop the seed (the hash change re-renders);
      // otherwise just show the setup screen again.
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

// The page side of the multiple-choice streak games (Studio Match, Source
// Material, Emoji Plot, Cast Call, Name That Opening). The server deals and
// judges every round (backend/src/lib/roundGames.js): it sends the prompt and
// four choices, says whether an answer was right, and keeps the lives and the
// streak, recording the score itself. Each game here only says how to draw
// its prompt.
//
// config:
//   slug, title (HTML-safe text), emoji, intro, loadingLabel, revealMs (default 1500)
//   promptHTML(round): the prompt, from what the server sent
//   onMount?(stage, round, { skip }), onReveal?(stage), cleanup?()
//        skip(): a new round with no penalty (e.g. a clip that won't load)

import { Games } from './gamesApi.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, showToast } from './ui.js';
import {
  recordLocalResult, getLocalStats, gameOverHTML, wireGameOver, challengeBannerHTML,
} from './gameKit.js';
import { celebrateCorrect, lamentWrong, soundToggleHTML, wireSoundToggle } from './gameFx.js';
import { navigate } from './router.js';

const START_LIVES = 3;

export async function runChoiceGame(root, config, params = new URLSearchParams()) {
  const {
    slug, title, emoji, intro, loadingLabel = 'LOADING', revealMs = 1500,
  } = config;
  root.innerHTML = loadingHTML(loadingLabel);
  const seed = params.get('seed');

  let state;
  try {
    state = await Games.roundStart(slug, { seed });
  } catch (err) {
    if (!root.isConnected) return;
    root.innerHTML = errorHTML(err.message || 'Couldn’t load this game — try again shortly!');
    wireRetry(root, () => runChoiceGame(root, config, params));
    return;
  }
  if (!root.isConnected) return; // left the page while it was dealing

  document.title = `${title} — AniNest`;
  const best = getLocalStats(slug).best;
  const recap = [];
  let locked = false;
  let over = false;

  function hud() {
    return `
      <span class="stat-pill">${'❤️'.repeat(state.lives)}${'🖤'.repeat(Math.max(0, START_LIVES - state.lives))}</span>
      <span class="stat-pill">🔥 Streak ${state.streak}</span>
      <span class="stat-pill">🏆 Best ${Math.max(best, state.streak)}</span>
      ${soundToggleHTML()}`;
  }

  function render() {
    if (over) return;
    config.cleanup?.();
    const { round } = state;
    locked = false;
    root.innerHTML = `
      <div class="hl-header">
        <h1 class="section-title">${emoji} ${escapeHtml(title)}</h1>
        <div class="hl-stats" id="choice-hud">${hud()}</div>
      </div>
      ${challengeBannerHTML(seed)}
      <p class="section-sub">${escapeHtml(intro)}</p>
      <div class="guess-arena choice-arena fx-slide-in" id="choice-stage">
        <div class="choice-prompt">${config.promptHTML(round)}</div>
        <p class="guess-reveal-title" id="choice-reveal" aria-live="polite"></p>
        <div class="guess-choices">
          ${round.choices.map((c, i) => `<button class="guess-choice" data-id="${escapeHtml(String(c.id))}"><kbd>${i + 1}</kbd> ${escapeHtml(c.label)}</button>`).join('')}
        </div>
      </div>`;
    wireSoundToggle(root);
    root.querySelectorAll('.guess-choice').forEach((btn) => btn.addEventListener('click', () => answer(btn.dataset.id)));
    config.onMount?.(root.querySelector('#choice-stage'), round, { skip });
  }

  async function skip() {
    if (locked || over) return;
    locked = true;
    try {
      state = await Games.roundSkip(state.runId);
    } catch (err) {
      showToast(err.message || 'Couldn’t skip this one.');
      locked = false;
      return;
    }
    render();
  }

  async function answer(chosenId) {
    if (locked || over) return;
    locked = true;
    root.querySelectorAll('.guess-choice').forEach((b) => { b.disabled = true; });
    let out;
    try {
      out = await Games.roundAnswer(state.runId, { answer: chosenId });
    } catch (err) {
      if (!root.isConnected) return;
      showToast(err.message || 'Lost connection — try that again.');
      if (err.status === 404) { runChoiceGame(root, config, params); return; }
      locked = false;
      root.querySelectorAll('.guess-choice').forEach((b) => { b.disabled = false; });
      return;
    }
    if (!root.isConnected || over) return;

    const solution = String(out.solution);
    root.querySelectorAll('.guess-choice').forEach((btn) => {
      if (btn.dataset.id === solution) btn.classList.add('is-correct');
      else if (btn.dataset.id === chosenId) btn.classList.add('is-wrong');
      else btn.classList.add('is-muted');
    });
    const stage = root.querySelector('#choice-stage');
    const reveal = root.querySelector('#choice-reveal');
    if (reveal && out.reveal?.text) reveal.textContent = out.reveal.text;
    config.onReveal?.(stage);
    recap.push({ ...out.recap, correct: out.correct });
    state = { ...state, streak: out.streak, lives: out.lives };
    if (out.correct) celebrateCorrect(out.streak, stage);
    else lamentWrong(stage);
    const hudEl = root.querySelector('#choice-hud');
    if (hudEl) { hudEl.innerHTML = hud(); wireSoundToggle(hudEl); }

    setTimeout(() => {
      if (over || !root.isConnected) return;
      if (out.gameOver) finish(out.streak);
      else { state = out.next; render(); }
    }, revealMs);
  }

  function onKey(e) {
    if (!root.isConnected || over) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest?.('input, textarea')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 9) root.querySelectorAll('.guess-choice')[n - 1]?.click();
  }

  function finish(streak) {
    over = true;
    config.cleanup?.();
    document.removeEventListener('keydown', onKey);
    const stats = recordLocalResult(slug, streak);
    const recapHTML = recap.length ? `
      <details class="recap"><summary>Round recap (${recap.filter((r) => r.correct).length}/${recap.length})</summary>
        <ul class="recap-list">${recap.slice(-20).map((r) => `<li class="${r.correct ? 'is-right' : 'is-wrong'}">${r.correct ? '✅' : '❌'} ${r.href ? `<a href="${escapeHtml(r.href)}">${escapeHtml(r.label)}</a>` : escapeHtml(r.label)}</li>`).join('')}</ul>
      </details>` : '';
    root.innerHTML = gameOverHTML({ emoji, score: streak, scoreLabel: 'Correct answers', stats, slug, extra: recapHTML });
    wireGameOver(root, {
      stats,
      onReplay: () => (seed ? navigate(`#/games/${slug}`) : runChoiceGame(root, config)),
      challenge: { text: `I got ${streak} right in AniNest's ${title}. Can you beat me?`, path: `/games/${slug}`, params: {} },
    });
  }

  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { over = true; config.cleanup?.(); document.removeEventListener('keydown', onKey); }, { once: true });
  render();
}

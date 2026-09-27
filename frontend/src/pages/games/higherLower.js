import { Games } from '../../lib/gamesApi.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, showToast } from '../../lib/ui.js';
import {
  recordLocalResult, getLocalStats, gameOverHTML, wireGameOver, challengeBannerHTML,
} from '../../lib/gameKit.js';
import {
  celebrateCorrect, lamentWrong, soundToggleHTML, wireSoundToggle, countUp, sfx, popText,
} from '../../lib/gameFx.js';
import { navigate } from '../../lib/router.js';

// Higher or Lower. The server deals and judges every round
// (backend/src/lib/hlGame.js): the page only knows the champion's number
// until it guesses, then learns the challenger's. So the four leaderboards
// hold real streaks, and a "challenge a friend" seed deals the same deck to
// both players. Anyone can play; signed-in runs are recorded by the server.

const REVEAL_DELAY_MS = 1400;

function compact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

// Each mode compares one number; `format` is how it is shown (also used mid
// count-up animation). The server knows which number each mode uses.
export const HL_MODES = {
  score: {
    slug: 'higher-lower', legacyKey: 'aninest_hl_best', emoji: '⭐', label: 'Score',
    question: 'community score', format: (v) => Number(v).toFixed(1),
  },
  popularity: {
    slug: 'hl-popularity', emoji: '👥', label: 'Popularity',
    question: 'number of fans (members)', format: compact,
  },
  episodes: {
    slug: 'hl-episodes', emoji: '🎞️', label: 'Episodes',
    question: 'episode count', format: (v) => String(Math.round(v)),
  },
  year: {
    slug: 'hl-year', emoji: '📅', label: 'Release Year',
    question: 'release year (higher = newer)', format: (v) => String(Math.round(v)),
  },
};

// Combo multiplier on points (the leaderboard still ranks the streak).
export function comboFor(streak) {
  if (streak >= 15) return 4;
  if (streak >= 10) return 3;
  if (streak >= 5) return 2;
  return 1;
}

function cardHTML(card, mode, { hidden, id, label }) {
  return `
    <div class="vs-card" id="${id}">
      <span class="vs-card-label">${label}</span>
      <div class="vs-poster-wrap">
        ${card.image ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.title)}" />` : ''}
      </div>
      <div class="vs-title">${escapeHtml(card.title)}</div>
      <div class="vs-flip ${hidden ? '' : 'is-flipped'}">
        <div class="vs-flip-inner">
          <div class="vs-score vs-face vs-face--back is-hidden">?</div>
          <div class="vs-score vs-face vs-face--front">${hidden ? '' : mode.format(card.value)}</div>
        </div>
      </div>
    </div>`;
}

function modeTabsHTML(current) {
  return `
    <div class="mode-tabs" role="tablist" aria-label="Compare by">
      ${Object.entries(HL_MODES).map(([key, m]) => `
        <button type="button" role="tab" class="mode-tab ${key === current ? 'is-active' : ''}" aria-selected="${key === current}" data-mode="${key}">
          ${m.emoji} ${m.label}<span class="mode-tab-best">Best ${getLocalStats(m.slug, m.legacyKey).best}</span>
        </button>`).join('')}
    </div>`;
}

export async function renderHigherLower(root, params = new URLSearchParams()) {
  root.innerHTML = loadingHTML('SHUFFLING THE DECK');
  document.title = 'Higher or Lower — AniNest';
  const modeKey = HL_MODES[params.get('mode')] ? params.get('mode') : 'score';
  const mode = HL_MODES[modeKey];
  const seed = params.get('seed');

  let state;
  try {
    state = await Games.hlStart(mode.slug, seed);
  } catch (err) {
    root.innerHTML = errorHTML(err.message || 'Couldn’t start the game — try again shortly!');
    wireRetry(root, () => (err.status === 503 ? navigate('#/games/higher-lower') : renderHigherLower(root, params)));
    return;
  }

  let points = 0;
  let locked = false; // true while a guess is out or the reveal plays
  let last = null; // the final round, for the game-over line
  const best = getLocalStats(mode.slug, mode.legacyKey).best;

  function renderRound() {
    locked = false;
    const { streak, champion, challenger, skipsLeft } = state;
    const combo = comboFor(streak);
    root.innerHTML = `
      <div class="hl-header">
        <h1 class="section-title">🎮 Higher or Lower</h1>
        <div class="hl-stats">
          <span class="stat-pill">🔥 Streak: ${streak}</span>
          <span class="stat-pill ${combo > 1 ? 'combo-pill' : ''}">✖️${combo} Combo</span>
          <span class="stat-pill">⭐ ${points} pts</span>
          <span class="stat-pill">🏆 Best: ${Math.max(best, streak)}</span>
          ${soundToggleHTML()}
        </div>
      </div>
      ${modeTabsHTML(modeKey)}
      ${challengeBannerHTML(seed)}
      <p class="section-sub hl-question">Will the challenger's <strong>${escapeHtml(mode.question)}</strong> be <strong>higher</strong> or <strong>lower</strong> than the champion's?</p>

      <div class="vs-arena">
        ${cardHTML(champion, mode, { hidden: false, id: 'vs-champion', label: 'CHAMPION' })}
        <div class="vs-bolt">⚡</div>
        ${cardHTML(challenger, mode, { hidden: true, id: 'vs-challenger', label: 'CHALLENGER' })}
      </div>

      <div class="hl-actions">
        <button class="btn-pow btn-pow--blue" id="guess-higher">▲ HIGHER <kbd>↑</kbd></button>
        <button class="btn-pow btn-pow--pink" id="guess-lower">▼ LOWER <kbd>↓</kbd></button>
      </div>
      <div class="hl-actions">
        <button class="btn-pow btn-pow--sm btn-pow--outline" id="skip" ${skipsLeft ? '' : 'disabled'}>⏭️ SKIP THIS ONE (${skipsLeft} left)</button>
      </div>
    `;

    wireSoundToggle(root);
    root.querySelector('#guess-higher').addEventListener('click', () => guess('higher'));
    root.querySelector('#guess-lower').addEventListener('click', () => guess('lower'));
    root.querySelector('#skip').addEventListener('click', skip);
    root.querySelectorAll('.mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.dataset.mode !== modeKey) navigate(`#/games/higher-lower?mode=${tab.dataset.mode}`);
      });
    });
  }

  async function skip() {
    if (locked || state.skipsLeft <= 0) return;
    locked = true;
    sfx('click');
    try {
      state = await Games.hlSkip(state.runId);
    } catch (err) {
      showToast(err.message || 'Couldn’t skip — try again.');
    }
    if (root.isConnected) renderRound();
  }

  async function guess(direction) {
    if (locked) return;
    locked = true;
    root.querySelectorAll('.hl-actions button').forEach((b) => { b.disabled = true; });

    let out;
    try {
      out = await Games.hlGuess(state.runId, direction);
    } catch (err) {
      if (!root.isConnected) return;
      showToast(err.message || 'Lost connection — try that again.');
      if (err.status === 404) renderHigherLower(root, params);
      else renderRound();
      return;
    }
    if (!root.isConnected) return;

    const { correct, value } = out;
    last = { champion: state.champion, challenger: { ...state.challenger, value } };
    const cardEl = root.querySelector('#vs-challenger');
    cardEl?.querySelector('.vs-flip')?.classList.add('is-flipped');
    const front = cardEl?.querySelector('.vs-face--front');
    if (front) countUp(front, value, { from: modeKey === 'year' ? value - 30 : 0, ms: 650, format: mode.format });

    setTimeout(() => {
      cardEl?.classList.add(correct ? 'vs-correct' : 'vs-wrong');
      if (correct) {
        points += 10 * comboFor(out.streak - 1);
        celebrateCorrect(out.streak, cardEl);
        if (comboFor(out.streak) > comboFor(out.streak - 1)) popText(`COMBO ×${comboFor(out.streak)}!`, { color: 'var(--blue)' });
      } else {
        lamentWrong(cardEl);
      }
    }, 450);

    setTimeout(() => {
      if (!root.isConnected) return;
      if (correct) {
        state = out.next;
        renderRound();
      } else {
        renderGameOver(out.streak);
      }
    }, REVEAL_DELAY_MS);
  }

  function onKey(e) {
    if (!root.isConnected || !root.querySelector('#guess-higher')) {
      if (!root.isConnected) document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); guess('higher'); }
    if (e.key === 'ArrowDown') { e.preventDefault(); guess('lower'); }
  }
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onKey), { once: true });

  function renderGameOver(streak) {
    document.removeEventListener('keydown', onKey);
    const stats = recordLocalResult(mode.slug, streak, mode.legacyKey);
    root.innerHTML = gameOverHTML({
      emoji: '💥',
      score: streak,
      stats,
      slug: mode.slug,
      extra: `<p class="section-sub">${mode.emoji} ${escapeHtml(mode.label)} mode · ⭐ ${points} points</p>
        <p class="section-sub">The run ended on <a href="#/anime/${Number(last.challenger.mal_id)}"><strong>${escapeHtml(last.challenger.title)}</strong></a> (${escapeHtml(mode.format(last.challenger.value))}) vs ${escapeHtml(mode.format(last.champion.value))}.</p>`,
    });
    wireGameOver(root, {
      stats,
      onReplay: () => (seed ? navigate(`#/games/higher-lower?mode=${modeKey}`) : renderHigherLower(root, params)),
      challenge: {
        text: `I got a ${streak} streak in AniNest's Higher or Lower (${mode.label}). Beat that!`,
        path: '/games/higher-lower',
        params: { mode: modeKey },
      },
    });
  }

  renderRound();
}

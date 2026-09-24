import { getAnimePool } from '../../lib/animePool.js';
import { imageOf } from '../../lib/api.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry } from '../../lib/ui.js';
import { shuffle } from '../../lib/shuffle.js';
import { randomFor, stableOrder } from '../../lib/rng.js';
import {
  startServerRun, recordLocalResult, getLocalStats, gameOverHTML, wireGameOver, challengeBannerHTML,
} from '../../lib/gameKit.js';
import {
  celebrateCorrect, lamentWrong, soundToggleHTML, wireSoundToggle, countUp, sfx, popText,
} from '../../lib/gameFx.js';
import { navigate } from '../../lib/router.js';
import { freshFirst, markSeen } from '../../lib/recentlySeen.js';

const REVEAL_DELAY_MS = 1400;

function compact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

// Each mode compares one number. `valid` filters the pool to entries that
// have it; `format` is how it is shown (also used mid count-up animation).
export const HL_MODES = {
  score: {
    slug: 'higher-lower', legacyKey: 'aninest_hl_best', emoji: '⭐', label: 'Score',
    question: 'community score', value: (a) => Number(a.score), format: (v) => Number(v).toFixed(1),
    valid: (a) => Number(a.score) > 0,
  },
  popularity: {
    slug: 'hl-popularity', emoji: '👥', label: 'Popularity',
    question: 'number of fans (members)', value: (a) => Number(a.members), format: compact,
    valid: (a) => Number(a.members) > 0,
  },
  episodes: {
    slug: 'hl-episodes', emoji: '🎞️', label: 'Episodes',
    question: 'episode count', value: (a) => Number(a.episodes), format: (v) => String(Math.round(v)),
    valid: (a) => Number(a.episodes) > 0,
  },
  year: {
    slug: 'hl-year', emoji: '📅', label: 'Release Year',
    question: 'release year (higher = newer)', value: (a) => Number(a.year), format: (v) => String(Math.round(v)),
    valid: (a) => Number(a.year) > 1900,
  },
};

// Combo multiplier on points (the leaderboard still ranks the streak).
export function comboFor(streak) {
  if (streak >= 15) return 4;
  if (streak >= 10) return 3;
  if (streak >= 5) return 2;
  return 1;
}

// A tie counts as a win either way - punishing an exact match as a "wrong"
// guess would feel unfair, not skill-testing.
export function isCorrectGuess(direction, championValue, challengerValue) {
  return direction === 'higher' ? challengerValue >= championValue : challengerValue <= championValue;
}

function cardHTML(anime, mode, { hidden, id, label }) {
  const img = imageOf(anime) || '';
  const value = mode.value(anime);
  return `
    <div class="vs-card" id="${id}">
      <span class="vs-card-label">${label}</span>
      <div class="vs-poster-wrap">
        ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(anime.title)}" />` : ''}
      </div>
      <div class="vs-title">${escapeHtml(anime.title)}</div>
      <div class="vs-flip ${hidden ? '' : 'is-flipped'}">
        <div class="vs-flip-inner">
          <div class="vs-score vs-face vs-face--back is-hidden">?</div>
          <div class="vs-score vs-face vs-face--front" data-value="${value}">${hidden ? '' : mode.format(value)}</div>
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

  let rawPool;
  try {
    rawPool = await getAnimePool();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load anime for the game — try again shortly!');
    wireRetry(root, () => renderHigherLower(root, params));
    return;
  }

  document.title = 'Higher or Lower — AniNest';
  const modeKey = HL_MODES[params.get('mode')] ? params.get('mode') : 'score';
  const mode = HL_MODES[modeKey];
  const seed = params.get('seed');
  const pool = rawPool.filter(mode.valid);
  if (pool.length < 8) {
    root.innerHTML = errorHTML('Not enough anime data for this mode right now. Try another one!');
    wireRetry(root, () => navigate('#/games/higher-lower'));
    return;
  }

  // Game state lives in this closure, not a module-level store - the game
  // is scoped to a single page visit and doesn't need to survive navigation.
  const rand = randomFor(seed);
  const SEEN_KEY = 'higher-lower';
  const deal = (list) => (seed ? shuffle(list, rand) : freshFirst(shuffle(list, rand), SEEN_KEY));
  let deck = deal(seed ? stableOrder(pool) : pool);
  let champion = deck.pop();
  let challenger = deck.pop();
  let streak = 0;
  let points = 0;
  let skipsLeft = 1;
  let locked = false; // true during the reveal animation, blocks a double guess
  const best = getLocalStats(mode.slug, mode.legacyKey).best;
  const run = startServerRun(mode.slug);

  function drawChallenger() {
    if (deck.length === 0) deck = deal(pool.filter((a) => a.mal_id !== champion.mal_id));
    challenger = deck.pop();
  }

  function renderRound() {
    locked = false;
    if (!seed) { markSeen(SEEN_KEY, champion.mal_id); markSeen(SEEN_KEY, challenger.mal_id); }
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

  function skip() {
    if (locked || skipsLeft <= 0) return;
    skipsLeft -= 1;
    sfx('click');
    drawChallenger();
    renderRound();
  }

  function guess(direction) {
    if (locked) return;
    locked = true;
    root.querySelectorAll('.hl-actions button').forEach((b) => { b.disabled = true; });

    const correct = isCorrectGuess(direction, mode.value(champion), mode.value(challenger));
    const cardEl = root.querySelector('#vs-challenger');
    const flip = cardEl?.querySelector('.vs-flip');
    const front = cardEl?.querySelector('.vs-face--front');
    flip?.classList.add('is-flipped');
    if (front) {
      const target = mode.value(challenger);
      countUp(front, target, { from: modeKey === 'year' ? target - 30 : 0, ms: 650, format: mode.format });
    }

    setTimeout(() => {
      cardEl?.classList.add(correct ? 'vs-correct' : 'vs-wrong');
      if (correct) {
        streak += 1;
        const gained = 10 * comboFor(streak - 1);
        points += gained;
        celebrateCorrect(streak, cardEl);
        if (comboFor(streak) > comboFor(streak - 1)) popText(`COMBO ×${comboFor(streak)}!`, { color: 'var(--blue)' });
      } else {
        lamentWrong(cardEl);
      }
    }, 450);

    setTimeout(() => {
      if (!root.isConnected) return;
      if (correct) {
        champion = challenger;
        drawChallenger();
        renderRound();
      } else {
        renderGameOver();
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

  function renderGameOver() {
    document.removeEventListener('keydown', onKey);
    run.submit(streak);
    const stats = recordLocalResult(mode.slug, streak, mode.legacyKey);
    root.innerHTML = gameOverHTML({
      emoji: '💥',
      score: streak,
      stats,
      slug: mode.slug,
      extra: `<p class="section-sub">${mode.emoji} ${escapeHtml(mode.label)} mode · ⭐ ${points} points</p>
        <p class="section-sub">The run ended on <a href="#/anime/${challenger.mal_id}"><strong>${escapeHtml(challenger.title)}</strong></a> (${escapeHtml(mode.format(mode.value(challenger)))}) vs ${escapeHtml(mode.format(mode.value(champion)))}.</p>`,
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

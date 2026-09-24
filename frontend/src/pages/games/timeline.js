import { getAnimePool } from '../../lib/animePool.js';
import { imageOf } from '../../lib/api.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry } from '../../lib/ui.js';
import { randomFor, stableOrder, shuffleWith } from '../../lib/rng.js';
import {
  startServerRun, recordLocalResult, getLocalStats, gameOverHTML, wireGameOver, challengeBannerHTML,
} from '../../lib/gameKit.js';
import {
  celebrateCorrect, lamentWrong, soundToggleHTML, wireSoundToggle, sfx,
} from '../../lib/gameFx.js';
import { navigate } from '../../lib/router.js';
import { recentlySeen, markSeen } from '../../lib/recentlySeen.js';

const SLUG = 'timeline';
const LIVES = 3;
const REVEAL_MS = 2000;

// Four cards at first, five once the streak reaches 5.
export function cardsForStreak(streak) {
  return streak >= 5 ? 5 : 4;
}

// Draws `count` anime with DIFFERENT release years, so there is exactly one
// right order. Anime in `avoid` (ids already played) are only used when the
// rest can't fill the round.
export function drawDistinctYears(pool, count, rand, avoid = new Set()) {
  const byYear = new Map();
  const shuffled = shuffleWith(pool, rand);
  const ordered = [...shuffled.filter((a) => !avoid.has(a.mal_id)), ...shuffled.filter((a) => avoid.has(a.mal_id))];
  for (const a of ordered) {
    if (!byYear.has(a.year)) byYear.set(a.year, a);
    if (byYear.size === count) break;
  }
  return byYear.size === count ? shuffleWith([...byYear.values()], rand) : null;
}

export function isChronological(list) {
  return list.every((a, i) => i === 0 || Number(list[i - 1].year) <= Number(a.year));
}

export async function renderTimeline(root, params = new URLSearchParams()) {
  root.innerHTML = loadingHTML('WINDING THE CLOCK');
  let pool;
  try {
    pool = stableOrder((await getAnimePool()).filter((a) => Number(a.year) > 1900 && imageOf(a)));
    if (new Set(pool.map((a) => a.year)).size < 5) throw new Error('too few years');
  } catch {
    root.innerHTML = errorHTML('Couldn’t load anime for Timeline — try again shortly!');
    wireRetry(root, () => renderTimeline(root, params));
    return;
  }

  document.title = 'Timeline — AniNest';
  const seed = params.get('seed');
  const rand = randomFor(seed);
  const run = startServerRun(SLUG);
  const best = getLocalStats(SLUG).best;
  let streak = 0;
  let lives = LIVES;
  let cards = [];
  let picked = []; // indexes into cards, in the order tapped
  let locked = false;
  let over = false;

  function hud() {
    return `
      <span class="stat-pill">${'❤️'.repeat(lives)}${'🖤'.repeat(LIVES - lives)}</span>
      <span class="stat-pill">🔥 Streak ${streak}</span>
      <span class="stat-pill">🏆 Best ${Math.max(best, streak)}</span>
      ${soundToggleHTML()}`;
  }

  // Ids played this run, plus (outside challenge runs) ones seen in recent runs.
  const avoid = new Set(seed ? [] : recentlySeen(SLUG).slice(-Math.floor(pool.length / 2)).map(Number));

  function newRound() {
    cards = drawDistinctYears(pool, cardsForStreak(streak), rand, avoid) || drawDistinctYears(pool, 4, rand, avoid);
    cards.forEach((a) => {
      avoid.add(a.mal_id);
      if (!seed) markSeen(SLUG, a.mal_id);
    });
    // Everything played: start the rotation over.
    if (avoid.size >= pool.length - 5) avoid.clear();
    picked = [];
    locked = false;
    render();
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
        ${cards.map((a, i) => {
          const pos = picked.indexOf(i);
          return `
            <button type="button" class="timeline-card ${pos >= 0 ? 'is-picked' : ''}" data-index="${i}" aria-pressed="${pos >= 0}">
              ${pos >= 0 ? `<span class="timeline-order">${pos + 1}</span>` : ''}
              <img src="${escapeHtml(imageOf(a))}" alt="" loading="lazy" />
              <span class="timeline-title">${escapeHtml(a.title)}</span>
              <span class="timeline-year" hidden>${a.year}</span>
            </button>`;
        }).join('')}
      </div>
      <div class="hl-actions">
        <button class="btn-pow btn-pow--pink" id="timeline-check" ${picked.length === cards.length ? '' : 'disabled'}>✔ LOCK IN</button>
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

  function check() {
    if (locked || picked.length !== cards.length) return;
    locked = true;
    const ordered = picked.map((i) => cards[i]);
    const correct = isChronological(ordered);
    const truth = [...cards].sort((a, b) => a.year - b.year);
    root.querySelectorAll('.timeline-card').forEach((btn) => {
      btn.disabled = true;
      const a = cards[Number(btn.dataset.index)];
      btn.querySelector('.timeline-year').hidden = false;
      const right = picked.indexOf(Number(btn.dataset.index)) === truth.indexOf(a);
      btn.classList.add(right ? 'is-right' : 'is-wrong');
    });
    root.querySelectorAll('.hl-actions button').forEach((b) => { b.disabled = true; });
    const result = root.querySelector('#timeline-result');
    if (result) result.textContent = truth.map((a) => a.year).join(' → ');
    const area = root.querySelector('#timeline-cards');
    if (correct) {
      streak += 1;
      celebrateCorrect(streak, area);
    } else {
      lives -= 1;
      lamentWrong(area);
    }
    setTimeout(() => {
      if (over || !root.isConnected) return;
      if (lives <= 0) finish();
      else newRound();
    }, REVEAL_MS);
  }

  function finish() {
    over = true;
    run.submit(streak);
    const stats = recordLocalResult(SLUG, streak);
    root.innerHTML = gameOverHTML({ emoji: '📆', score: streak, scoreLabel: 'Timelines sorted', stats, slug: SLUG });
    wireGameOver(root, {
      stats,
      onReplay: () => (seed ? navigate('#/games/timeline') : renderTimeline(root)),
      challenge: { text: `I sorted ${streak} timelines in AniNest's Timeline game. Your turn!`, path: '/games/timeline', params: {} },
    });
  }

  window.addEventListener('hashchange', () => { over = true; }, { once: true });
  newRound();
}

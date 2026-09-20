import { getAnimePool } from '../../lib/animePool.js';
import { imageOf } from '../../lib/api.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry } from '../../lib/ui.js';
import { shuffle } from '../../lib/shuffle.js';

const BEST_KEY = 'aninest_hl_best';
const REVEAL_DELAY_MS = 1100;

function cardHTML(anime, { hidden, id, label }) {
  const img = imageOf(anime) || '';
  return `
    <div class="vs-card" id="${id}">
      <span class="vs-card-label">${label}</span>
      <div class="vs-poster-wrap">
        ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(anime.title)}" />` : ''}
      </div>
      <div class="vs-title">${escapeHtml(anime.title)}</div>
      <div class="vs-score ${hidden ? 'is-hidden' : ''}">${hidden ? '?' : Number(anime.score).toFixed(1)}</div>
    </div>`;
}

export async function renderHigherLower(root) {
  root.innerHTML = loadingHTML('SHUFFLING THE DECK');

  let pool;
  try {
    pool = await getAnimePool();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load anime for the game — try again shortly!');
    wireRetry(root, () => renderHigherLower(root));
    return;
  }

  document.title = 'Higher or Lower — AniNest';

  // Game state lives in this closure, not a module-level store — the game
  // is scoped to a single page visit and doesn't need to survive navigation.
  let deck = shuffle(pool);
  let champion = deck.pop();
  let challenger = deck.pop();
  let streak = 0;
  let best = Number(localStorage.getItem(BEST_KEY)) || 0;
  let locked = false; // true during the reveal animation, blocks a double guess

  function drawChallenger() {
    if (deck.length === 0) deck = shuffle(pool.filter((a) => a.mal_id !== champion.mal_id));
    challenger = deck.pop();
  }

  function renderRound() {
    locked = false;
    root.innerHTML = `
      <div class="hl-header">
        <h1 class="section-title">🎮 Higher or Lower</h1>
        <div class="hl-stats">
          <span class="stat-pill">🔥 Streak: ${streak}</span>
          <span class="stat-pill">🏆 Best: ${best}</span>
        </div>
      </div>
      <p class="section-sub" style="margin-bottom:18px">Will the challenger's community score be <strong>higher</strong> or <strong>lower</strong> than the champion's?</p>

      <div class="vs-arena">
        ${cardHTML(champion, { hidden: false, id: 'vs-champion', label: 'CHAMPION' })}
        <div class="vs-bolt">⚡</div>
        ${cardHTML(challenger, { hidden: true, id: 'vs-challenger', label: 'CHALLENGER' })}
      </div>

      <div class="hl-actions">
        <button class="btn-pow btn-pow--blue" id="guess-higher">▲ HIGHER</button>
        <button class="btn-pow btn-pow--pink" id="guess-lower">▼ LOWER</button>
      </div>
    `;

    root.querySelector('#guess-higher').addEventListener('click', () => guess('higher'));
    root.querySelector('#guess-lower').addEventListener('click', () => guess('lower'));
  }

  function guess(direction) {
    if (locked) return;
    locked = true;
    root.querySelectorAll('.hl-actions button').forEach((b) => { b.disabled = true; });

    // A tie counts as a win either way — punishing an exact score match
    // as a "wrong" guess would feel unfair, not skill-testing.
    const correct = direction === 'higher'
      ? challenger.score >= champion.score
      : challenger.score <= champion.score;

    const cardEl = root.querySelector('#vs-challenger');
    const scoreEl = cardEl?.querySelector('.vs-score');
    if (scoreEl) {
      scoreEl.textContent = Number(challenger.score).toFixed(1);
      scoreEl.classList.remove('is-hidden');
    }
    cardEl?.classList.add(correct ? 'vs-correct' : 'vs-wrong');

    setTimeout(() => {
      if (correct) {
        streak += 1;
        if (streak > best) {
          best = streak;
          localStorage.setItem(BEST_KEY, String(best));
        }
        champion = challenger;
        drawChallenger();
        renderRound();
      } else {
        renderGameOver();
      }
    }, REVEAL_DELAY_MS);
  }

  function renderGameOver() {
    const isNewBest = streak > 0 && streak === best;
    root.innerHTML = `
      <div class="hl-gameover">
        <div class="hl-gameover-emoji">💥</div>
        <h1 class="section-title">GAME OVER</h1>
        <p class="hl-final-streak">Final streak: <strong>${streak}</strong></p>
        ${isNewBest ? '<p class="hl-new-best">🏆 New best streak!</p>' : `<p class="section-sub">Best streak: ${best}</p>`}
        <div class="hero-actions" style="justify-content:center;margin-top:20px">
          <button class="btn-pow btn-pow--pink" id="play-again">🔄 PLAY AGAIN</button>
          <a href="#/games" class="btn-pow btn-pow--outline">🎮 More Games</a>
        </div>
      </div>`;
    root.querySelector('#play-again').addEventListener('click', () => renderHigherLower(root));
  }

  renderRound();
}

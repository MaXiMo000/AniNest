import { getAnimePool } from '../../lib/animePool.js';
import { imageOf } from '../../lib/api.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry } from '../../lib/ui.js';
import { shuffle } from '../../lib/shuffle.js';

const BEST_KEY = 'aninest_gta_best';
const REVEAL_DELAY_MS = 1600;
const MIN_SYNOPSIS_LEN = 60;
const SNIPPET_MAX_CHARS = 260;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strips the trailing "(Source: ...)" citation Jikan/AniList synopses often
// carry, then blacks out the anime's own title if it happens to appear in
// the text — otherwise the clue can just hand over the answer.
function synopsisSnippet(anime) {
  let text = (anime.synopsis || '').replace(/\(Source:.*$/is, '').trim();
  const titleRe = new RegExp(escapeRegExp(anime.title), 'gi');
  text = text.replace(titleRe, '████');
  if (text.length > SNIPPET_MAX_CHARS) {
    text = text.slice(0, SNIPPET_MAX_CHARS).replace(/\s+\S*$/, '') + '…';
  }
  return text || 'No synopsis available for this mystery entry — go by the cover alone!';
}

function pickChoices(pool, answer) {
  const seenTitles = new Set([answer.title.toLowerCase()]);
  const distractors = [];
  for (const a of shuffle(pool)) {
    if (a.mal_id === answer.mal_id) continue;
    const key = a.title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    distractors.push(a);
    if (distractors.length === 3) break;
  }
  return shuffle([answer, ...distractors]);
}

export async function renderGuessTheAnime(root) {
  root.innerHTML = loadingHTML('BLURRING A COVER');

  let rawPool;
  try {
    rawPool = await getAnimePool();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load anime for the game — try again shortly!');
    wireRetry(root, () => renderGuessTheAnime(root));
    return;
  }

  const pool = rawPool.filter((a) => (a.synopsis || '').length >= MIN_SYNOPSIS_LEN && imageOf(a));
  if (pool.length < 8) {
    root.innerHTML = errorHTML('Not enough anime data available right now to play. Try again shortly!');
    wireRetry(root, () => renderGuessTheAnime(root));
    return;
  }

  document.title = 'Guess the Anime — AniNest';

  let deck = shuffle(pool);
  let answer = deck.pop();
  let streak = 0;
  let best = Number(localStorage.getItem(BEST_KEY)) || 0;
  let locked = false;

  function drawAnswer() {
    if (deck.length === 0) deck = shuffle(pool.filter((a) => a.mal_id !== answer.mal_id));
    answer = deck.pop();
  }

  function renderRound() {
    locked = false;
    const choices = pickChoices(pool, answer);
    const img = imageOf(answer);

    root.innerHTML = `
      <div class="guess-header">
        <h1 class="section-title">🕵️ Guess the Anime</h1>
        <div class="hl-stats">
          <span class="stat-pill">🔥 Streak: ${streak}</span>
          <span class="stat-pill">🏆 Best: ${best}</span>
        </div>
      </div>
      <p class="section-sub">Blurred cover, redacted synopsis — name the anime in four guesses or fewer.</p>

      <div class="guess-arena">
        <div class="guess-poster-frame" id="guess-poster">
          ${img ? `<img src="${escapeHtml(img)}" alt="Mystery anime cover" />` : ''}
          <span class="guess-poster-mark">?</span>
        </div>
        <p class="guess-reveal-title" id="guess-reveal-title"></p>
        <div class="speech-bubble">${escapeHtml(synopsisSnippet(answer))}</div>
        <div class="guess-choices" id="guess-choices">
          ${choices.map((c, i) => `<button class="guess-choice" data-id="${c.mal_id}" data-index="${i}">${escapeHtml(c.title)}</button>`).join('')}
        </div>
      </div>
    `;

    root.querySelectorAll('.guess-choice').forEach((btn) => {
      btn.addEventListener('click', () => guess(Number(btn.dataset.id)));
    });
  }

  function guess(chosenId) {
    if (locked) return;
    locked = true;

    const correct = chosenId === answer.mal_id;
    root.querySelectorAll('.guess-choice').forEach((btn) => {
      btn.disabled = true;
      const id = Number(btn.dataset.id);
      if (id === answer.mal_id) btn.classList.add('is-correct');
      else if (id === chosenId) btn.classList.add('is-wrong');
      else btn.classList.add('is-muted');
    });
    root.querySelector('#guess-poster')?.classList.add('is-revealed');
    const titleEl = root.querySelector('#guess-reveal-title');
    if (titleEl) titleEl.textContent = answer.title;

    setTimeout(() => {
      if (correct) {
        streak += 1;
        if (streak > best) {
          best = streak;
          localStorage.setItem(BEST_KEY, String(best));
        }
        drawAnswer();
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
        <div class="hl-gameover-emoji">🔍</div>
        <h1 class="section-title">GAME OVER</h1>
        <p class="hl-final-streak">Final streak: <strong>${streak}</strong></p>
        ${isNewBest ? '<p class="hl-new-best">🏆 New best streak!</p>' : `<p class="section-sub">Best streak: ${best}</p>`}
        <div class="hero-actions" style="justify-content:center;margin-top:20px">
          <button class="btn-pow btn-pow--pink" id="play-again">🔄 PLAY AGAIN</button>
          <a href="#/games" class="btn-pow btn-pow--outline">🎮 More Games</a>
        </div>
      </div>`;
    root.querySelector('#play-again').addEventListener('click', () => renderGuessTheAnime(root));
  }

  renderRound();
}

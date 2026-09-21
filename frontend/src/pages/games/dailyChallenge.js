import { getAnimePool } from '../../lib/animePool.js';
import { Games } from '../../lib/gamesApi.js';
import { synopsisSnippet, pickChoices } from '../../lib/guessMechanic.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, showToast } from '../../lib/ui.js';

// Wordle-style: up to MAX_ATTEMPTS rounds against the SAME mystery anime.
// Each round redraws fresh distractors (never repeating one already shown,
// so a wrong choice can't be "used up" as a freebie) and the poster unblurs
// a little more - failing every round is a genuine loss, not just a slower
// win, which is what gives this actual Wordle-style stakes.
const MAX_ATTEMPTS = 4;
const BLUR_STEPS = [18, 12, 6, 0];
const STORAGE_PREFIX = 'aninest_daily_';

function storageKey(date) {
  return `${STORAGE_PREFIX}${date}`;
}

function loadResult(date) {
  try {
    const raw = localStorage.getItem(storageKey(date));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveResult(date, result) {
  try {
    localStorage.setItem(storageKey(date), JSON.stringify(result));
  } catch { /* private-browsing/storage-full — result just won't persist across reloads */ }
}

function emojiGrid(attemptResults) {
  return attemptResults.map((r) => (r === 'correct' ? '🟩' : '🟥')).join('');
}

function shareText(puzzleNumber, attemptResults, won) {
  const scoreLabel = won ? `${attemptResults.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
  return [
    `AniNest Daily Challenge #${puzzleNumber} — ${scoreLabel}`,
    emojiGrid(attemptResults),
    `${window.location.origin}${window.location.pathname}#/games/daily`,
  ].join('\n');
}

function wireCopyButton(root, challenge, result) {
  root.querySelector('#copy-result')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(shareText(challenge.puzzleNumber, result.attempts, result.won))
      .then(() => showToast('Result copied!'))
      .catch(() => showToast('Could not copy — try selecting the text manually.'));
  });
}

function resultHTML(challenge, result) {
  const { puzzleNumber, answer } = challenge;
  const { attempts, won } = result;
  return `
    <div class="guess-header">
      <h1 class="section-title">📅 Daily Challenge #${puzzleNumber}</h1>
    </div>
    <div class="hl-gameover">
      <div class="hl-gameover-emoji">${won ? '🎉' : '📖'}</div>
      <p class="hl-final-streak">${won ? `Solved in <strong>${attempts.length}/${MAX_ATTEMPTS}</strong>` : `Not solved today (${MAX_ATTEMPTS}/${MAX_ATTEMPTS})`}</p>
      <p class="section-sub">${escapeHtml(answer.title)}</p>
      <div class="daily-emoji-grid">${emojiGrid(attempts)}</div>
      <div class="hero-actions" style="justify-content:center;margin-top:20px">
        <button class="btn-pow btn-pow--pink" id="copy-result">📋 COPY RESULT</button>
        <a href="#/anime/${answer.mal_id}" class="btn-pow btn-pow--outline">View Anime</a>
        <a href="#/games" class="btn-pow btn-pow--outline">🎮 More Games</a>
      </div>
      <p class="section-sub" style="margin-top:14px">Come back tomorrow for a new mystery anime!</p>
    </div>`;
}

export async function renderDailyChallenge(root) {
  document.title = 'Daily Challenge — AniNest';
  root.innerHTML = loadingHTML('PICKING TODAY’S MYSTERY');

  let challenge;
  let rawPool;
  try {
    [challenge, rawPool] = await Promise.all([Games.daily(), getAnimePool()]);
  } catch {
    root.innerHTML = errorHTML('Couldn’t load today’s challenge — try again shortly!');
    wireRetry(root, () => renderDailyChallenge(root));
    return;
  }

  const existing = loadResult(challenge.date);
  if (existing) {
    root.innerHTML = resultHTML(challenge, existing);
    wireCopyButton(root, challenge, existing);
    return;
  }

  const answer = challenge.answer;
  const distractorPool = rawPool.filter((a) => a.mal_id !== answer.mal_id && a.title.toLowerCase() !== answer.title.toLowerCase());
  const usedDistractorIds = new Set();
  const attempts = []; // 'wrong' | 'correct', in the order played
  let locked = false;

  function finish(won) {
    const result = { attempts: [...attempts], won };
    saveResult(challenge.date, result);
    root.innerHTML = resultHTML(challenge, result);
    wireCopyButton(root, challenge, result);
  }

  function renderRound() {
    locked = false;
    const blur = BLUR_STEPS[Math.min(attempts.length, BLUR_STEPS.length - 1)];

    // Fresh distractors each round, excluding ones already shown - falls
    // back to allowing repeats only if the pool is ever too thin to avoid
    // it (extremely unlikely at ~280 pool entries for 3 spots x 4 rounds).
    let freshCandidates = distractorPool.filter((a) => !usedDistractorIds.has(a.mal_id));
    if (freshCandidates.length < 3) freshCandidates = distractorPool;
    const choices = pickChoices(freshCandidates, answer);
    choices.forEach((c) => { if (c.mal_id !== answer.mal_id) usedDistractorIds.add(c.mal_id); });

    root.innerHTML = `
      <div class="guess-header">
        <h1 class="section-title">📅 Daily Challenge #${challenge.puzzleNumber}</h1>
        <div class="hl-stats">
          <span class="stat-pill">🎯 Guess ${attempts.length + 1}/${MAX_ATTEMPTS}</span>
        </div>
      </div>
      <p class="section-sub">One shared mystery anime, every day — same puzzle for everyone. Guess wrong and the cover unblurs a little more.</p>

      <div class="guess-arena">
        <div class="guess-poster-frame" id="guess-poster">
          ${answer.image ? `<img src="${escapeHtml(answer.image)}" alt="Mystery anime cover" style="filter:blur(${blur}px) saturate(0.3) brightness(0.8)" />` : ''}
          <span class="guess-poster-mark" style="opacity:${blur === 0 ? 0 : 1}">?</span>
        </div>
        <p class="guess-reveal-title" id="guess-reveal-title"></p>
        <div class="speech-bubble">${escapeHtml(synopsisSnippet(answer))}</div>
        <div class="guess-choices" id="guess-choices">
          ${choices.map((c) => `<button class="guess-choice" data-id="${c.mal_id}">${escapeHtml(c.title)}</button>`).join('')}
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

    if (correct) {
      attempts.push('correct');
      // Only reveal which choice was correct here - the round (and the
      // puzzle) is over, so there's nothing left to spoil.
      root.querySelectorAll('.guess-choice').forEach((btn) => {
        btn.disabled = true;
        btn.classList.add(Number(btn.dataset.id) === answer.mal_id ? 'is-correct' : 'is-muted');
      });
      root.querySelector('#guess-poster')?.querySelector('img')?.style.setProperty('filter', 'blur(0) saturate(1) brightness(1)');
      root.querySelector('#guess-poster')?.classList.add('is-revealed');
      const titleEl = root.querySelector('#guess-reveal-title');
      if (titleEl) titleEl.textContent = answer.title;
      setTimeout(() => finish(true), 1200);
      return;
    }

    attempts.push('wrong');
    const isFinalAttempt = attempts.length >= MAX_ATTEMPTS;

    // A wrong guess with attempts left must NOT reveal which button was
    // actually correct - the same fixed answer reappears in every
    // subsequent round, so highlighting it here would trivially hand over
    // the puzzle. Only mark the one the player picked as wrong; leave
    // everything else - including the real answer - unstyled until the
    // round is genuinely over (this branch, or the final attempt below).
    root.querySelectorAll('.guess-choice').forEach((btn) => {
      btn.disabled = true;
      const id = Number(btn.dataset.id);
      if (isFinalAttempt && id === answer.mal_id) btn.classList.add('is-correct');
      else if (id === chosenId) btn.classList.add('is-wrong');
      else if (isFinalAttempt) btn.classList.add('is-muted');
    });

    if (isFinalAttempt) {
      root.querySelector('#guess-poster')?.querySelector('img')?.style.setProperty('filter', 'blur(0) saturate(1) brightness(1)');
      root.querySelector('#guess-poster')?.classList.add('is-revealed');
      const titleEl = root.querySelector('#guess-reveal-title');
      if (titleEl) titleEl.textContent = answer.title;
      setTimeout(() => finish(false), 1400);
      return;
    }

    setTimeout(renderRound, 1200);
  }

  renderRound();
}

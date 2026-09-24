import { getAnimePool } from '../../lib/animePool.js';
import { imageOf } from '../../lib/api.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry } from '../../lib/ui.js';
import {
  drawQuiz, buildProfile, recommend, personaFor, QUESTION_BANK,
} from '../../lib/tasteQuiz.js';
import { recordLocalResult, shareOrCopy } from '../../lib/gameKit.js';
import { sfx, confetti, soundToggleHTML, wireSoundToggle } from '../../lib/gameFx.js';
import { recentlySeen, markSeen } from '../../lib/recentlySeen.js';

// Questions from the last two runs are avoided on a retake where possible.
const SEEN_KEY = 'taste-quiz';
const SEEN_LIMIT = 16;

export async function renderQuiz(root) {
  root.innerHTML = loadingHTML('WARMING UP THE QUIZ');

  let pool;
  try {
    pool = await getAnimePool();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load anime for the quiz — try again shortly!');
    wireRetry(root, () => renderQuiz(root));
    return;
  }

  document.title = 'Taste Quiz — AniNest';

  const questions = drawQuiz(Math.random, undefined, new Set(recentlySeen(SEEN_KEY)));
  questions.forEach((q) => markSeen(SEEN_KEY, q.q, SEEN_LIMIT));
  const answers = []; // chosen option per question, by index
  let step = 0;

  function onKey(e) {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= 4) root.querySelectorAll('.quiz-option')[n - 1]?.click();
    if (e.key === 'Backspace' && step > 0 && root.querySelector('#quiz-back')) root.querySelector('#quiz-back').click();
  }
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onKey), { once: true });

  function renderQuestion() {
    const { q, options } = questions[step];
    root.innerHTML = `
      <div class="quiz-header">
        <h1 class="section-title">🧭 Taste Quiz</h1>
        <span class="section-sub">Question ${step + 1} of ${questions.length} · from a bank of ${QUESTION_BANK.length} ${soundToggleHTML()}</span>
      </div>
      <div class="quiz-progress"><div class="quiz-progress-bar" style="width:${(step / questions.length) * 100}%"></div></div>

      <h2 class="quiz-question fx-slide-in">${escapeHtml(q)}</h2>
      <div class="quiz-options fx-stagger">
        ${options.map((o, i) => `
          <button class="quiz-option ${answers[step] === o ? 'is-chosen' : ''}" data-index="${i}">
            <span class="quiz-option-emoji">${o.emoji}</span>
            <span class="quiz-option-label">${escapeHtml(o.label)}</span>
            <kbd class="quiz-key">${i + 1}</kbd>
          </button>`).join('')}
      </div>
      ${step > 0 ? '<div class="hl-actions"><button class="btn-pow btn-pow--sm btn-pow--outline" id="quiz-back">← BACK</button></div>' : ''}
    `;
    wireSoundToggle(root);

    root.querySelectorAll('.quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        sfx('click');
        answers[step] = options[Number(btn.dataset.index)];
        step += 1;
        if (step < questions.length) renderQuestion();
        else renderResult();
      });
    });
    root.querySelector('#quiz-back')?.addEventListener('click', () => {
      step -= 1;
      renderQuestion();
    });
  }

  function renderResult() {
    document.removeEventListener('keydown', onKey);
    const profile = buildProfile(answers);
    const persona = personaFor(profile);
    const picks = recommend(pool, profile, 3);
    recordLocalResult('taste-quiz', 1);
    sfx('fanfare');
    confetti();

    const maxWeight = Math.max(1, ...Object.values(profile.g));
    const bars = Object.entries(profile.g).sort((a, b) => b[1] - a[1]).slice(0, 6);

    root.innerHTML = `
      <div class="quiz-header">
        <h1 class="section-title">🎉 Your Anime Taste</h1>
      </div>
      <div class="persona-card fx-pop-in">
        <div class="persona-emoji">${persona.emoji}</div>
        <div>
          <p class="persona-kicker">You are…</p>
          <h2 class="persona-title">${escapeHtml(persona.title)}</h2>
          <div class="taste-bars">
            ${bars.map(([g, w]) => `
              <div class="taste-bar"><span>${escapeHtml(g)}</span><div class="taste-bar-track"><div class="taste-bar-fill" style="width:${Math.round((w / maxWeight) * 100)}%"></div></div></div>`).join('')}
          </div>
        </div>
      </div>

      <h2 class="setup-heading">Your top 3 picks</h2>
      <div class="quiz-picks fx-stagger">
        ${picks.map(({ anime, reasons }, i) => {
          const img = imageOf(anime);
          const score = anime.score ? Number(anime.score).toFixed(1) : '—';
          return `
            <a class="quiz-pick" href="#/anime/${anime.mal_id}">
              <span class="quiz-pick-rank">#${i + 1}</span>
              ${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" />` : ''}
              <div class="quiz-pick-body">
                <strong>${escapeHtml(anime.title)}</strong>
                <div class="quiz-result-badges">
                  <span class="stat-pill">★ ${score}</span>
                  ${(anime.genres || []).slice(0, 2).map((g) => `<span class="stat-pill">${escapeHtml(g.name)}</span>`).join('')}
                </div>
                ${reasons.length ? `<p class="quiz-pick-why">Because ${escapeHtml(reasons.slice(0, 3).join(', '))}.</p>` : ''}
              </div>
            </a>`;
        }).join('')}
      </div>

      <div class="hero-actions" style="justify-content:center;margin-top:24px">
        <button class="btn-pow btn-pow--pink" id="retake-quiz">🔄 RETAKE (NEW QUESTIONS)</button>
        <button class="btn-pow btn-pow--blue" id="share-quiz">📣 SHARE MY TASTE</button>
        <a href="#/games" class="btn-pow btn-pow--outline">🎮 More Games</a>
      </div>
    `;

    root.querySelector('#retake-quiz').addEventListener('click', () => renderQuiz(root));
    root.querySelector('#share-quiz').addEventListener('click', () => {
      const text = `My AniNest Taste Quiz result: ${persona.emoji} ${persona.title} (${persona.topGenres.join(', ')}). Top pick: ${picks[0]?.anime.title || '?'}. What's yours?`;
      shareOrCopy(text, `${window.location.origin}${window.location.pathname}#/games/quiz`);
    });
  }

  renderQuestion();
}

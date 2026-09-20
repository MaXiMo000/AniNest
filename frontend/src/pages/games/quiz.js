import { getAnimePool } from '../../lib/animePool.js';
import { imageOf } from '../../lib/api.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry } from '../../lib/ui.js';

// Genre labels are restricted to AniList's genre enum (no MAL-only tags like
// "Shounen"/"Shoujo") since AniList is now the primary data source for the
// pool this quiz draws from — a genre absent from AniList's schema would
// never match anything and quietly fall through to the next-ranked pick.
const QUESTIONS = [
  {
    q: 'Pick a mood for tonight:',
    options: [
      { emoji: '😂', label: 'Make me laugh', genre: 'Comedy' },
      { emoji: '😢', label: 'Make me cry', genre: 'Drama' },
      { emoji: '😱', label: 'Creep me out', genre: 'Horror' },
      { emoji: '💥', label: 'Get my heart racing', genre: 'Action' },
    ],
  },
  {
    q: 'Pick your dream setting:',
    options: [
      { emoji: '🏫', label: 'A slice of everyday life', genre: 'Slice of Life' },
      { emoji: '🧙', label: 'A world of magic and monsters', genre: 'Fantasy' },
      { emoji: '🛰️', label: 'Deep space or a far future', genre: 'Sci-Fi' },
      { emoji: '🔍', label: 'A city hiding dark secrets', genre: 'Mystery' },
    ],
  },
  {
    q: 'What’s your ideal pace?',
    options: [
      { emoji: '💞', label: 'Sweet, slow-building feelings', genre: 'Romance' },
      { emoji: '🧩', label: 'Twists that mess with your head', genre: 'Psychological' },
      { emoji: '🏆', label: 'Training arcs and big matches', genre: 'Sports' },
      { emoji: '⚔️', label: 'Nonstop adventure', genre: 'Adventure' },
    ],
  },
  {
    q: 'Pick a power:',
    options: [
      { emoji: '🤖', label: 'Pilot a giant robot', genre: 'Mecha' },
      { emoji: '🎶', label: 'Move people with music', genre: 'Music' },
      { emoji: '👻', label: 'See what others can’t', genre: 'Supernatural' },
      { emoji: '😰', label: 'Survive against all odds', genre: 'Thriller' },
    ],
  },
  {
    q: 'How should it end?',
    options: [
      { emoji: '😆', label: 'Everyone laughing together', genre: 'Comedy' },
      { emoji: '💔', label: 'Bittersweet, unforgettable', genre: 'Drama' },
      { emoji: '🎉', label: 'A hard-won victory', genre: 'Action' },
      { emoji: '🥰', label: 'Warm and cozy', genre: 'Slice of Life' },
    ],
  },
];

function hasGenre(anime, genre) {
  return (anime.genres || []).some((g) => g.name?.toLowerCase() === genre.toLowerCase());
}

// Tries genres in tally order (most-picked first); the first one with any
// pool matches wins. Falls back to the pool's best-scored anime overall in
// the unlikely case none of the five tallied genres matched anything.
function pickRecommendation(pool, tally) {
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([genre]) => genre);
  for (const genre of ranked) {
    const matches = pool.filter((a) => hasGenre(a, genre)).sort((a, b) => (b.score || 0) - (a.score || 0));
    if (matches.length) {
      const topMatches = matches.slice(0, 10);
      return { anime: topMatches[Math.floor(Math.random() * topMatches.length)], genre };
    }
  }
  const fallback = [...pool].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
  return { anime: fallback[Math.floor(Math.random() * fallback.length)], genre: null };
}

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

  let step = 0;
  const tally = {};

  function renderQuestion() {
    const { q, options } = QUESTIONS[step];
    root.innerHTML = `
      <div class="quiz-header">
        <h1 class="section-title">🧭 Taste Quiz</h1>
        <span class="section-sub">Question ${step + 1} of ${QUESTIONS.length}</span>
      </div>
      <div class="quiz-progress"><div class="quiz-progress-bar" style="width:${(step / QUESTIONS.length) * 100}%"></div></div>

      <h2 class="quiz-question">${escapeHtml(q)}</h2>
      <div class="quiz-options">
        ${options.map((o, i) => `
          <button class="quiz-option" data-index="${i}">
            <span class="quiz-option-emoji">${o.emoji}</span>
            <span class="quiz-option-label">${escapeHtml(o.label)}</span>
          </button>`).join('')}
      </div>
    `;

    root.querySelectorAll('.quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { genre } = options[Number(btn.dataset.index)];
        tally[genre] = (tally[genre] || 0) + 1;
        step += 1;
        if (step < QUESTIONS.length) renderQuestion();
        else renderResult();
      });
    });
  }

  function renderResult() {
    const { anime, genre } = pickRecommendation(pool, tally);
    const img = imageOf(anime);
    const score = anime.score ? Number(anime.score).toFixed(1) : '—';

    root.innerHTML = `
      <div class="quiz-header">
        <h1 class="section-title">🎉 Your Match!</h1>
      </div>
      <p class="section-sub" style="margin-bottom:20px">${genre ? `You're all about <strong>${escapeHtml(genre)}</strong> — here's your pick:` : 'Here’s something great for you:'}</p>

      <div class="quiz-result-card">
        ${img ? `<img class="quiz-result-poster" src="${escapeHtml(img)}" alt="${escapeHtml(anime.title)}" />` : ''}
        <div class="quiz-result-body">
          <h2 class="quiz-result-title">${escapeHtml(anime.title)}</h2>
          <div class="quiz-result-badges">
            <span class="stat-pill">★ ${score}</span>
            ${(anime.genres || []).slice(0, 3).map((g) => `<span class="stat-pill">${escapeHtml(g.name)}</span>`).join('')}
          </div>
          <div class="hero-actions" style="margin-top:16px">
            <a class="btn-pow btn-pow--pink" href="#/anime/${anime.mal_id}">▶ VIEW DETAILS</a>
            <button class="btn-pow btn-pow--outline" id="retake-quiz">🔄 RETAKE QUIZ</button>
          </div>
        </div>
      </div>
    `;

    root.querySelector('#retake-quiz').addEventListener('click', () => renderQuiz(root));
  }

  renderQuestion();
}

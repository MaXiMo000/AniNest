import { getAnimePool } from '../../lib/animePool.js';
import { Games } from '../../lib/gamesApi.js';
import { Auth } from '../../lib/authStore.js';
import { synopsisSnippet, pickChoices } from '../../lib/guessMechanic.js';
import { mangaImg } from '../../lib/mangaImage.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, showToast } from '../../lib/ui.js';
import { dailyStats, localDailyResults } from '../../lib/dailyStats.js';
import {
  sfx, confetti, lamentWrong, soundToggleHTML, wireSoundToggle, popText,
} from '../../lib/gameFx.js';

// Wordle-style: up to MAX_ATTEMPTS rounds against the SAME mystery title.
// Each round redraws fresh distractors (never repeating one already shown,
// so a wrong choice can't be "used up" as a freebie) and the cover unblurs
// a little more - failing every round is a genuine loss, not just a slower
// win, which is what gives this actual Wordle-style stakes.
//
// Two flavours share this page: the anime daily and the manga daily. They
// differ only in where the puzzle comes from and a few labels (KINDS).
const MAX_ATTEMPTS = 4;
const BLUR_STEPS = [18, 12, 6, 0];

const KINDS = {
  anime: {
    title: 'Daily Challenge',
    emoji: '📅',
    noun: 'anime',
    path: '/games/daily',
    other: { path: '#/games/manga-daily', label: '📖 Try the Manga Daily' },
    storagePrefix: 'aninest_daily_',
    load: async () => {
      const [challenge, pool] = await Promise.all([Games.daily(), getAnimePool()]);
      const { answer } = challenge;
      const distractors = pool
        .filter((a) => a.mal_id !== answer.mal_id && a.title.toLowerCase() !== answer.title.toLowerCase())
        .map((a) => ({ id: a.mal_id, title: a.title }));
      return {
        ...challenge,
        answer: { ...answer, id: answer.mal_id },
        distractors,
        shuffleDistractors: true,
      };
    },
    image: (answer) => answer.image,
    link: (answer) => `#/anime/${answer.id}`,
    // Extra clues by round (index = attempts already made).
    extraClues: (answer, round) => (round >= 2 && answer.score ? [`★ ${Number(answer.score).toFixed(1)} score`] : []),
    submit: (date, won, rounds) => Games.submitDailyResult(date, won, rounds),
    statsKey: 'daily',
  },
  manga: {
    title: 'Manga Daily',
    emoji: '📖',
    noun: 'manga',
    path: '/games/manga-daily',
    other: { path: '#/games/daily', label: '📅 Try the Anime Daily' },
    storagePrefix: 'aninest_manga_daily_',
    load: async () => {
      const challenge = await Games.mangaDaily();
      // The server stored this puzzle's 12 wrong answers (3 per round), so
      // everyone sees the same rounds.
      return { ...challenge, shuffleDistractors: false };
    },
    image: (answer) => mangaImg(answer.image),
    link: (answer) => `#/manga/${answer.id}`,
    extraClues: (answer, round) => {
      const out = [];
      if (round >= 1) out.push(...(answer.tags || []).slice(0, 3));
      if (round >= 2 && answer.year) out.push(`📅 ${answer.year}`);
      return out;
    },
    submit: (date, won, rounds) => Games.submitMangaDailyResult(date, won, rounds),
    statsKey: 'mangaDaily',
  },
};

function loadResult(kind, date) {
  try {
    const raw = localStorage.getItem(`${kind.storagePrefix}${date}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveResult(kind, date, result) {
  try {
    localStorage.setItem(`${kind.storagePrefix}${date}`, JSON.stringify(result));
  } catch { /* private-browsing/storage-full — result just won't persist across reloads */ }
}

function emojiGrid(attemptResults) {
  return attemptResults.map((r) => (r === 'correct' ? '🟩' : '🟥')).join('');
}

function shareText(kind, puzzleNumber, attemptResults, won) {
  const scoreLabel = won ? `${attemptResults.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
  return [
    `AniNest ${kind.title} #${puzzleNumber} — ${scoreLabel}`,
    emojiGrid(attemptResults),
    `${window.location.origin}${window.location.pathname}#${kind.path}`,
  ].join('\n');
}

function secondsToNextPuzzle() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, Math.floor((next - now.getTime()) / 1000));
}

function formatCountdown(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

// Stats panel: guess distribution, streaks and a 5-week calendar strip.
export function statsPanelHTML(stats, highlightRounds = null) {
  const maxBar = Math.max(1, ...Object.values(stats.distribution));
  const cells = stats.calendar.map((d) => `<span class="cal-cell ${d.result ? `cal-${d.result}` : ''}" title="${d.date}${d.result ? `: ${d.result}` : ''}"></span>`).join('');
  return `
    <div class="daily-stats">
      <div class="daily-stat-row">
        <div class="daily-stat"><strong>${stats.played}</strong><span>Played</span></div>
        <div class="daily-stat"><strong>${stats.winRate}%</strong><span>Win rate</span></div>
        <div class="daily-stat"><strong>${stats.currentStreak}</strong><span>Streak</span></div>
        <div class="daily-stat"><strong>${stats.longestStreak}</strong><span>Longest</span></div>
      </div>
      <h3 class="daily-stats-heading">Guess distribution</h3>
      <div class="dist-bars">
        ${[1, 2, 3, 4].map((n) => `
          <div class="dist-row"><span>${n}</span>
            <div class="dist-bar ${highlightRounds === n ? 'is-today' : ''}" style="width:${Math.max(8, Math.round((stats.distribution[n] / maxBar) * 100))}%">${stats.distribution[n]}</div>
          </div>`).join('')}
      </div>
      ${stats.calendar.length ? `<h3 class="daily-stats-heading">Last 5 weeks</h3><div class="cal-strip" aria-label="Wins and losses over the last 35 days">${cells}</div>` : ''}
    </div>`;
}

async function loadStats(kind) {
  if (Auth.get().user) {
    try {
      const all = await Games.myStats();
      if (all?.[kind.statsKey]) return all[kind.statsKey];
    } catch { /* fall back to this device's history */ }
  }
  return dailyStats(localDailyResults(kind.storagePrefix));
}

function resultHTML(kind, challenge, result) {
  const { puzzleNumber, answer } = challenge;
  const { attempts, won } = result;
  return `
    <div class="guess-header">
      <h1 class="section-title">${kind.emoji} ${kind.title} #${puzzleNumber}</h1>
    </div>
    <div class="hl-gameover fx-pop-in">
      <div class="hl-gameover-emoji">${won ? '🎉' : '📖'}</div>
      <p class="hl-final-streak">${won ? `Solved in <strong>${attempts.length}/${MAX_ATTEMPTS}</strong>` : `Not solved today (${MAX_ATTEMPTS}/${MAX_ATTEMPTS})`}</p>
      ${kind.image(answer) ? `<img class="daily-answer-cover" src="${escapeHtml(kind.image(answer))}" alt="" />` : ''}
      <p class="section-sub">${escapeHtml(answer.title)}</p>
      <div class="daily-emoji-grid">${emojiGrid(attempts)}</div>
      <div id="daily-stats-slot">${loadingHTML('TALLYING')}</div>
      <p class="daily-countdown">Next puzzle in <strong id="daily-countdown">${formatCountdown(secondsToNextPuzzle())}</strong></p>
      <div class="hero-actions" style="justify-content:center;margin-top:20px">
        <button class="btn-pow btn-pow--pink" id="copy-result">📋 COPY RESULT</button>
        <a href="${kind.link(answer)}" class="btn-pow btn-pow--outline">View ${kind.noun === 'manga' ? 'Manga' : 'Anime'}</a>
        <a href="${kind.other.path}" class="btn-pow btn-pow--blue">${kind.other.label}</a>
        <a href="#/games" class="btn-pow btn-pow--outline">🎮 More Games</a>
      </div>
    </div>`;
}

function showResult(root, kind, challenge, result) {
  root.innerHTML = resultHTML(kind, challenge, result);
  root.querySelector('#copy-result')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(shareText(kind, challenge.puzzleNumber, result.attempts, result.won))
      .then(() => showToast('Result copied!'))
      .catch(() => showToast('Could not copy — try selecting the text manually.'));
  });
  const timer = setInterval(() => {
    const el = root.querySelector('#daily-countdown');
    if (!el) { clearInterval(timer); return; }
    el.textContent = formatCountdown(secondsToNextPuzzle());
  }, 1000);
  loadStats(kind).then((stats) => {
    const slot = root.querySelector('#daily-stats-slot');
    if (slot) slot.innerHTML = statsPanelHTML(stats, result.won ? result.attempts.length : null);
  });
}

export function renderMangaDailyChallenge(root) {
  return renderDaily(root, KINDS.manga);
}

export function renderDailyChallenge(root) {
  return renderDaily(root, KINDS.anime);
}

async function renderDaily(root, kind) {
  document.title = `${kind.title} — AniNest`;
  root.innerHTML = loadingHTML(`PICKING TODAY’S MYSTERY ${kind.noun.toUpperCase()}`);

  let challenge;
  try {
    challenge = await kind.load();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load today’s challenge — try again shortly!');
    wireRetry(root, () => renderDaily(root, kind));
    return;
  }

  // The server records one result per player per date (that's what the XP
  // system awards). Idempotent, so it is safe to re-send an existing result -
  // which also covers a result played before this was recorded server-side.
  const recordResult = (result) => {
    if (!Auth.get().user) return;
    kind.submit(challenge.date, Boolean(result.won), Math.min(4, Math.max(1, result.attempts.length))).catch(() => {});
  };

  const existing = loadResult(kind, challenge.date);
  if (existing) {
    recordResult(existing);
    showResult(root, kind, challenge, existing);
    return;
  }

  const { answer } = challenge;
  const image = kind.image(answer);
  const usedDistractorIds = new Set();
  const attempts = []; // 'wrong' | 'correct', in the order played
  let locked = false;

  function finish(won) {
    const result = { attempts: [...attempts], won };
    saveResult(kind, challenge.date, result);
    recordResult(result);
    if (won) { sfx('fanfare'); confetti(); } else sfx('gameover');
    showResult(root, kind, challenge, result);
  }

  function roundChoices() {
    const round = attempts.length;
    if (!challenge.shuffleDistractors) {
      const slice = challenge.distractors.slice(round * 3, round * 3 + 3);
      const fallback = challenge.distractors.slice(0, 3);
      const picks = slice.length === 3 ? slice : fallback;
      return pickChoices([...picks, answer].map((m) => ({ mal_id: m.id, title: m.title })), { mal_id: answer.id, title: answer.title });
    }
    // Fresh distractors each round, excluding ones already shown - falls
    // back to allowing repeats only if the pool is ever too thin to avoid it.
    let fresh = challenge.distractors.filter((a) => !usedDistractorIds.has(a.id));
    if (fresh.length < 3) fresh = challenge.distractors;
    const choices = pickChoices(fresh.map((m) => ({ mal_id: m.id, title: m.title })), { mal_id: answer.id, title: answer.title });
    choices.forEach((c) => { if (c.mal_id !== answer.id) usedDistractorIds.add(c.mal_id); });
    return choices;
  }

  function renderRound() {
    locked = false;
    const round = attempts.length;
    const blur = BLUR_STEPS[Math.min(round, BLUR_STEPS.length - 1)];
    const choices = roundChoices();
    const clues = kind.extraClues(answer, round);

    root.innerHTML = `
      <div class="guess-header">
        <h1 class="section-title">${kind.emoji} ${kind.title} #${challenge.puzzleNumber}</h1>
        <div class="hl-stats">
          <span class="stat-pill">🎯 Guess ${round + 1}/${MAX_ATTEMPTS}</span>
          <span class="stat-pill">${emojiGrid(attempts) || '⬜'}</span>
          ${soundToggleHTML()}
        </div>
      </div>
      <p class="section-sub">One shared mystery ${kind.noun}, every day — same puzzle for everyone. Guess wrong and the cover unblurs a little more.</p>

      <div class="guess-arena fx-slide-in" id="guess-arena">
        <div class="guess-poster-frame" id="guess-poster">
          ${image ? `<img src="${escapeHtml(image)}" alt="Mystery ${kind.noun} cover" style="filter:blur(${blur}px) saturate(0.3) brightness(0.8)" />` : ''}
          <span class="guess-poster-mark" style="opacity:${blur === 0 ? 0 : 1}">?</span>
        </div>
        <p class="guess-reveal-title" id="guess-reveal-title" aria-live="polite"></p>
        <div class="speech-bubble">${escapeHtml(synopsisSnippet({ title: answer.title, synopsis: answer.synopsis }))}</div>
        ${clues.length ? `<div class="clue-chips fx-stagger">${clues.map((c) => `<span class="stat-pill">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
        <div class="guess-choices" id="guess-choices">
          ${choices.map((c, i) => `<button class="guess-choice" data-id="${escapeHtml(String(c.mal_id))}"><kbd>${i + 1}</kbd> ${escapeHtml(c.title)}</button>`).join('')}
        </div>
      </div>
    `;
    wireSoundToggle(root);
    root.querySelectorAll('.guess-choice').forEach((btn) => {
      btn.addEventListener('click', () => guess(btn.dataset.id));
    });
  }

  function reveal() {
    root.querySelector('#guess-poster img')?.style.setProperty('filter', 'blur(0) saturate(1) brightness(1)');
    root.querySelector('#guess-poster')?.classList.add('is-revealed');
    const titleEl = root.querySelector('#guess-reveal-title');
    if (titleEl) titleEl.textContent = answer.title;
  }

  function guess(chosenId) {
    if (locked) return;
    locked = true;
    const correct = chosenId === String(answer.id);

    if (correct) {
      attempts.push('correct');
      // Only reveal which choice was correct here - the puzzle is over, so
      // there's nothing left to spoil.
      root.querySelectorAll('.guess-choice').forEach((btn) => {
        btn.disabled = true;
        btn.classList.add(btn.dataset.id === String(answer.id) ? 'is-correct' : 'is-muted');
      });
      reveal();
      sfx('correct');
      popText(['GENIUS!', 'SUPERB!', 'NICE!', 'PHEW!'][attempts.length - 1], { anchor: root.querySelector('#guess-poster'), big: true });
      setTimeout(() => finish(true), 1300);
      return;
    }

    attempts.push('wrong');
    const isFinalAttempt = attempts.length >= MAX_ATTEMPTS;
    lamentWrong(root.querySelector('#guess-arena'));

    // A wrong guess with attempts left must NOT reveal which button was
    // actually correct - the same answer reappears in every later round, so
    // highlighting it here would hand over the puzzle.
    root.querySelectorAll('.guess-choice').forEach((btn) => {
      btn.disabled = true;
      const id = btn.dataset.id;
      if (isFinalAttempt && id === String(answer.id)) btn.classList.add('is-correct');
      else if (id === chosenId) btn.classList.add('is-wrong');
      else if (isFinalAttempt) btn.classList.add('is-muted');
    });

    if (isFinalAttempt) {
      reveal();
      setTimeout(() => finish(false), 1500);
      return;
    }
    setTimeout(renderRound, 1200);
  }

  function onKey(e) {
    if (!root.isConnected || !root.querySelector('.guess-choice')) {
      if (!root.isConnected) document.removeEventListener('keydown', onKey);
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 4) root.querySelectorAll('.guess-choice')[n - 1]?.click();
  }
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onKey), { once: true });

  renderRound();
}

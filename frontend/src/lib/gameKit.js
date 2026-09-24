// Plumbing every streak game shares: the server run (for leaderboard
// scores), local per-game stats, the game-over screen and challenge links.
// Games keep their own rules and rendering; this is only the common frame.

import { Games } from './gamesApi.js';
import { Auth } from './authStore.js';
import { escapeHtml, showToast } from './ui.js';
import { sfx, confetti, countUp } from './gameFx.js';
import { newSeed } from './rng.js';

const STATS_KEY = 'aninest_game_stats_v1';
const HISTORY_LEN = 30;

// ------------------------------------------------------------ local stats

function readAll() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(all)); } catch { /* storage full or blocked */ }
}

// Pure: folds one finished game into a stats record. Exported for tests.
export function foldResult(prev, score, now = Date.now()) {
  const base = prev || { plays: 0, best: 0, total: 0, history: [], lastPlayed: null };
  const isNewBest = score > (base.best || 0);
  return {
    stats: {
      plays: base.plays + 1,
      best: Math.max(base.best || 0, score),
      total: (base.total || 0) + score,
      history: [...(base.history || []), { s: score, t: now }].slice(-HISTORY_LEN),
      lastPlayed: now,
    },
    isNewBest: isNewBest && score > 0,
  };
}

// `legacyBestKey`: the per-game localStorage key older versions used for a
// best streak, folded in once so nobody loses their record.
export function getLocalStats(slug, legacyBestKey) {
  const all = readAll();
  let stats = all[slug];
  if (!stats && legacyBestKey) {
    let legacy = 0;
    try { legacy = Number(localStorage.getItem(legacyBestKey)) || 0; } catch { /* ignore */ }
    if (legacy) stats = { plays: 0, best: legacy, total: 0, history: [], lastPlayed: null };
  }
  return stats || { plays: 0, best: 0, total: 0, history: [], lastPlayed: null };
}

export function allLocalStats() {
  return readAll();
}

export function recordLocalResult(slug, score, legacyBestKey) {
  const all = readAll();
  const { stats, isNewBest } = foldResult(getLocalStats(slug, legacyBestKey), score);
  all[slug] = stats;
  writeAll(all);
  return { ...stats, isNewBest };
}

// ------------------------------------------------------------ server runs

// A signed-in player's run must be started with the server before a score
// can be submitted (backend/src/routes/games.js checks the score against the
// time actually played). Fire-and-forget: logged out, or if this fails, the
// game still plays - it just can't post a score.
export function startServerRun(slug) {
  const handle = { runId: null, submitted: false };
  if (Auth.get().user) {
    Games.startRun(slug).then((r) => { handle.runId = r.runId; }).catch(() => {});
  }
  handle.submit = (score) => {
    if (handle.submitted || !handle.runId || !Auth.get().user || score <= 0) return;
    handle.submitted = true;
    // The backend only ever raises a recorded best, so posting a non-best
    // score is harmless; a failure isn't worth interrupting game over for.
    Games.submitScore(slug, score, handle.runId).catch(() => {});
  };
  return handle;
}

// ------------------------------------------------------------ challenge links

export function challengeUrl(path, params = {}) {
  const qs = new URLSearchParams({ ...params, seed: params.seed || newSeed() });
  return `${window.location.origin}${window.location.pathname}#${path}?${qs}`;
}

export async function shareOrCopy(text, url) {
  const full = url ? `${text}\n${url}` : text;
  try {
    if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) {
      await navigator.share({ text, url });
      return;
    }
  } catch { /* cancelled - fall through to copy */ }
  try {
    await navigator.clipboard.writeText(full);
    showToast('Copied! Paste it to a friend.');
  } catch {
    showToast('Could not copy — try selecting the text manually.');
  }
}

// ------------------------------------------------------------ game over

// `extra`: trusted HTML the game adds (a recap list, etc).
export function gameOverHTML({
  emoji = '💥', title = 'GAME OVER', score, scoreLabel = 'Final streak', stats, slug,
  leaderboard = true, extra = '', challenge = true,
}) {
  const loggedIn = Boolean(Auth.get().user);
  const avg = stats.plays ? (stats.total / stats.plays).toFixed(1) : '0';
  return `
    <div class="hl-gameover fx-pop-in">
      <div class="hl-gameover-emoji">${emoji}</div>
      <h1 class="section-title">${escapeHtml(title)}</h1>
      <p class="hl-final-streak">${escapeHtml(scoreLabel)}: <strong data-countup="${score}">${score}</strong></p>
      ${stats.isNewBest ? '<p class="hl-new-best fx-bounce-in">🏆 New personal best!</p>' : `<p class="section-sub">Personal best: ${stats.best}</p>`}
      <div class="gameover-stats">
        <span class="stat-pill">🎮 Played ${stats.plays}</span>
        <span class="stat-pill">📊 Avg ${avg}</span>
        <span class="stat-pill">🏆 Best ${stats.best}</span>
      </div>
      ${extra}
      ${leaderboard && !loggedIn ? '<p class="section-sub">🔒 Log in to save your score to the leaderboard.</p>' : ''}
      <div class="hero-actions" style="justify-content:center;margin-top:20px">
        <button class="btn-pow btn-pow--pink" id="play-again">🔄 PLAY AGAIN</button>
        ${challenge ? '<button class="btn-pow btn-pow--blue" id="challenge-friend">⚔️ CHALLENGE A FRIEND</button>' : ''}
        ${leaderboard ? `<a href="#/games/leaderboard/${slug}" class="btn-pow btn-pow--outline">🏆 Leaderboard</a>` : ''}
        <a href="#/games" class="btn-pow btn-pow--outline">🎮 More Games</a>
      </div>
    </div>`;
}

// `challenge`: { text, path, params } to build a share link, or omitted.
export function wireGameOver(root, { onReplay, stats, challenge } = {}) {
  sfx(stats?.isNewBest ? 'fanfare' : 'gameover');
  if (stats?.isNewBest) confetti({ pieces: 120 });
  const scoreEl = root.querySelector('[data-countup]');
  if (scoreEl) countUp(scoreEl, Number(scoreEl.dataset.countup));
  root.querySelector('#play-again')?.addEventListener('click', onReplay);
  root.querySelector('#challenge-friend')?.addEventListener('click', () => {
    if (!challenge) return;
    shareOrCopy(challenge.text, challengeUrl(challenge.path, challenge.params));
  });
}

// A banner for a page opened from someone's challenge link.
export function challengeBannerHTML(seed) {
  return seed
    ? '<div class="challenge-banner">⚔️ Challenge run — same deck as the friend who sent you this link. Beat their score!</div>'
    : '';
}

// Standard game header: title plus stat pills and the sound toggle.
export function gameHeaderHTML(title, pills = [], soundToggle = '') {
  return `
    <div class="hl-header">
      <h1 class="section-title">${title}</h1>
      <div class="hl-stats">${pills.map((p) => `<span class="stat-pill">${p}</span>`).join('')}${soundToggle}</div>
    </div>`;
}

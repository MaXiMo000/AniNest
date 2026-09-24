import { escapeHtml } from '../../lib/ui.js';
import { GAME_CATALOG } from '../../lib/gameCatalog.js';
import { getLocalStats } from '../../lib/gameKit.js';
import { Auth } from '../../lib/authStore.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dailyState(prefix) {
  try {
    const raw = localStorage.getItem(`${prefix}${today()}`);
    if (!raw) return null;
    const r = JSON.parse(raw);
    return r.won ? `✅ Solved in ${r.attempts.length}/4` : '❌ Not solved today';
  } catch {
    return null;
  }
}

function bestOf(game) {
  const legacy = { 'guess-the-anime': 'aninest_gta_best', 'higher-lower': 'aninest_hl_best' };
  return Math.max(0, ...game.local.map((slug) => getLocalStats(slug, legacy[slug]).best));
}

function playsOf(game) {
  return game.local.reduce((sum, slug) => sum + getLocalStats(slug).plays, 0);
}

function cardHTML(game) {
  const done = game.dailyPrefix ? dailyState(game.dailyPrefix) : null;
  const best = game.group === 'streak' ? bestOf(game) : 0;
  const plays = playsOf(game);
  const tag = done ? `<span class="game-tag game-tag--done">${escapeHtml(done)}</span>`
    : game.group === 'daily' ? '<span class="game-tag game-tag--today">TODAY’S PUZZLE</span>'
      : game.isNew ? '<span class="game-tag">NEW!</span>' : '';
  return `
    <a class="game-card" href="${game.href}" style="--game-bg:${game.gradient}">
      <div class="game-card-art" aria-hidden="true"><span>${game.emoji}</span></div>
      ${tag}
      <h3 class="game-card-title">${escapeHtml(game.title)}</h3>
      <p class="game-card-desc">${escapeHtml(game.desc)}</p>
      <div class="game-card-foot">
        ${game.group === 'streak' ? `<span class="game-card-best">🏆 ${best}</span>` : ''}
        ${plays ? `<span class="game-card-plays">🎮 ${plays} played</span>` : ''}
        <span class="btn-pow btn-pow--pink btn-pow--sm">▶ PLAY</span>
      </div>
    </a>`;
}

export function renderGamesHub(root) {
  document.title = 'Game Zone — AniNest';
  const groups = [
    ['daily', '📅 Daily puzzles', 'A new one for everyone every day (UTC). Keep your win streak going.'],
    ['streak', '🔥 Streak games', 'Three lives, how far can you go? Every one has a leaderboard.'],
    ['fun', '🎈 Just for fun', 'No scores, just good recommendations.'],
  ];
  const totalPlays = GAME_CATALOG.reduce((sum, g) => sum + playsOf(g), 0);

  root.innerHTML = `
    <div class="games-hero">
      <div>
        <h1 class="section-title">🎮 Game Zone</h1>
        <p class="section-sub">${GAME_CATALOG.length} anime games built from our own data. No spoilers, no scraped character art.</p>
      </div>
      <div class="games-hero-actions">
        <a class="btn-pow btn-pow--blue" href="#/games/stats">📊 My Game Stats${totalPlays ? ` (${totalPlays})` : ''}</a>
        <a class="btn-pow btn-pow--outline" href="#/games/leaderboard/guess-the-anime">🏆 Leaderboards</a>
      </div>
    </div>
    ${Auth.get().user ? '' : '<p class="games-login-note">🔒 <a href="#/login">Log in</a> to post scores to the leaderboards and earn XP and badges.</p>'}
    ${groups.map(([group, heading, sub]) => `
      <section class="games-section">
        <div class="section-head">
          <h2 class="section-title games-section-title">${heading}</h2>
          <span class="section-sub">${sub}</span>
        </div>
        <div class="games-grid fx-stagger">${GAME_CATALOG.filter((g) => g.group === group).map(cardHTML).join('')}</div>
      </section>`).join('')}
    <div class="games-leaderboard-links">
      <a href="#/leaderboard/xp">⭐ XP Leaderboard</a>
      <a href="#/games/stats">📊 My Game Stats</a>
    </div>
  `;
}

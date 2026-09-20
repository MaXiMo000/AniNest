import { Games } from '../../lib/gamesApi.js';
import { Auth } from '../../lib/authStore.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, emptyHTML } from '../../lib/ui.js';

const GAME_META = {
  'higher-lower': { label: 'Higher or Lower', emoji: '📈' },
  'guess-the-anime': { label: 'Guess the Anime', emoji: '🕵️' },
};

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

function rowHTML(row, index, myUsername) {
  const isMe = myUsername && row.username === myUsername;
  const rank = index + 1;
  return `
    <li class="leaderboard-row ${isMe ? 'is-me' : ''}">
      <span class="leaderboard-rank">${RANK_MEDAL[rank] || `#${rank}`}</span>
      <a class="leaderboard-user" href="#/u/${encodeURIComponent(row.username)}">${escapeHtml(row.username)}</a>
      <span class="leaderboard-streak">🔥 ${row.best_streak}</span>
    </li>`;
}

export async function renderLeaderboard(root, gameSlug) {
  const meta = GAME_META[gameSlug];
  if (!meta) {
    root.innerHTML = emptyHTML('Unknown game.', '🎮');
    return;
  }

  document.title = `${meta.label} Leaderboard — AniNest`;
  root.innerHTML = loadingHTML('TALLYING STREAKS');

  let data;
  try {
    data = await Games.leaderboard(gameSlug);
  } catch {
    root.innerHTML = errorHTML('Couldn’t load the leaderboard — try again shortly!');
    wireRetry(root, () => renderLeaderboard(root, gameSlug));
    return;
  }

  const myUsername = Auth.get().user?.username || null;
  const { leaderboard, myRank, myBest } = data;
  const inTop = myUsername && leaderboard.some((r) => r.username === myUsername);

  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">${meta.emoji} ${escapeHtml(meta.label)} Leaderboard</h1>
      <span class="section-sub">Top streaks across every AniNest player.</span>
    </div>

    ${leaderboard.length ? `<ol class="leaderboard-list">${leaderboard.map((r, i) => rowHTML(r, i, myUsername)).join('')}</ol>` : emptyHTML('No scores yet — be the first!', '🏆')}

    ${myUsername && myRank && !inTop ? `
      <div class="leaderboard-you">
        <span class="leaderboard-rank">#${myRank}</span>
        <span class="leaderboard-user">You</span>
        <span class="leaderboard-streak">🔥 ${myBest}</span>
      </div>` : ''}

    <div class="hero-actions" style="justify-content:center;margin-top:24px">
      <a href="#/games/${gameSlug === 'higher-lower' ? 'higher-lower' : 'guess-the-anime'}" class="btn-pow btn-pow--pink">▶ PLAY</a>
      <a href="#/games" class="btn-pow btn-pow--outline">🎮 More Games</a>
    </div>
  `;
}

import { Games } from '../../lib/gamesApi.js';
import { Auth } from '../../lib/authStore.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, emptyHTML } from '../../lib/ui.js';
import { BOARDS, boardBySlug, playHrefFor } from '../../lib/gameCatalog.js';

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

function rowHTML(row, index, myUsername) {
  const isMe = myUsername && row.username === myUsername;
  const rank = index + 1;
  return `
    <li class="leaderboard-row ${isMe ? 'is-me' : ''} ${rank <= 3 ? `is-podium is-rank-${rank}` : ''}">
      <span class="leaderboard-rank">${RANK_MEDAL[rank] || `#${rank}`}</span>
      <a class="leaderboard-user" href="#/u/${encodeURIComponent(row.username)}">${escapeHtml(row.username)}</a>
      <span class="leaderboard-streak">🔥 ${Number(row.best_streak)}</span>
    </li>`;
}

function pickerHTML(current, period) {
  const q = period === 'week' ? '?period=week' : '';
  return `
    <nav class="board-picker" aria-label="Choose a leaderboard">
      ${BOARDS.map((b) => `<a class="chip ${b.slug === current ? 'active' : ''}" href="#/games/leaderboard/${b.slug}${q}" ${b.slug === current ? 'aria-current="page"' : ''}>${b.game.emoji} ${escapeHtml(b.label)}</a>`).join('')}
    </nav>`;
}

export async function renderLeaderboard(root, gameSlug, params = new URLSearchParams()) {
  const board = boardBySlug(gameSlug);
  if (!board) {
    root.innerHTML = emptyHTML('Unknown game.', '🎮');
    return;
  }
  const period = params.get('period') === 'week' ? 'week' : 'all';

  document.title = `${board.label} Leaderboard — AniNest`;
  root.innerHTML = loadingHTML('TALLYING STREAKS');

  let data;
  try {
    data = await Games.leaderboard(gameSlug, period);
  } catch {
    root.innerHTML = errorHTML('Couldn’t load the leaderboard — try again shortly!');
    wireRetry(root, () => renderLeaderboard(root, gameSlug, params));
    return;
  }

  const myUsername = Auth.get().user?.username || null;
  const { leaderboard, myRank, myBest } = data;
  const inTop = myUsername && leaderboard.some((r) => r.username === myUsername);

  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">${board.game.emoji} ${escapeHtml(board.label)} Leaderboard</h1>
      <span class="section-sub">${period === 'week' ? 'Best scores from the last 7 days.' : 'All-time best scores across every AniNest player.'}</span>
    </div>
    ${pickerHTML(gameSlug, period)}
    <div class="period-tabs" role="tablist">
      <a role="tab" class="mode-tab ${period === 'all' ? 'is-active' : ''}" aria-selected="${period === 'all'}" href="#/games/leaderboard/${gameSlug}">🏛️ All time</a>
      <a role="tab" class="mode-tab ${period === 'week' ? 'is-active' : ''}" aria-selected="${period === 'week'}" href="#/games/leaderboard/${gameSlug}?period=week">📆 This week</a>
    </div>

    ${leaderboard.length ? `<ol class="leaderboard-list fx-stagger">${leaderboard.map((r, i) => rowHTML(r, i, myUsername)).join('')}</ol>` : emptyHTML(period === 'week' ? 'No scores this week yet — take the top spot!' : 'No scores yet — be the first!', '🏆')}

    ${myUsername && myRank && !inTop ? `
      <div class="leaderboard-you">
        <span class="leaderboard-rank">#${myRank}</span>
        <span class="leaderboard-user">You</span>
        <span class="leaderboard-streak">🔥 ${myBest}</span>
      </div>` : ''}

    <div class="hero-actions" style="justify-content:center;margin-top:24px">
      <a href="${playHrefFor(gameSlug)}" class="btn-pow btn-pow--pink">▶ PLAY</a>
      <a href="#/games" class="btn-pow btn-pow--outline">🎮 More Games</a>
    </div>
  `;
}

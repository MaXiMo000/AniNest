import { Users } from '../lib/usersApi.js';
import { Auth } from '../lib/authStore.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, emptyHTML } from '../lib/ui.js';

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Reuses the game leaderboards' row styling (.leaderboard-*) - same list, a
// different number on the right.
function rowHTML(row, index, myUsername) {
  const isMe = myUsername && row.username === myUsername;
  const rank = index + 1;
  return `
    <li class="leaderboard-row ${isMe ? 'is-me' : ''}">
      <span class="leaderboard-rank">${RANK_MEDAL[rank] || `#${rank}`}</span>
      <a class="leaderboard-user" href="#/u/${encodeURIComponent(row.username)}">${escapeHtml(row.username)}</a>
      <span class="leaderboard-level">LV ${row.level} · ${escapeHtml(row.title)}</span>
      <span class="leaderboard-streak">⭐ ${row.xp.toLocaleString()} XP</span>
    </li>`;
}

export async function renderXpLeaderboard(root) {
  document.title = 'XP Leaderboard — AniNest';
  root.innerHTML = loadingHTML('TALLYING XP');

  let data;
  try {
    data = await Users.xpLeaderboard();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load the leaderboard — try again shortly!');
    wireRetry(root, () => renderXpLeaderboard(root));
    return;
  }

  const myUsername = Auth.get().user?.username || null;
  const { leaderboard, myRank, myXp } = data;
  const inTop = myUsername && leaderboard.some((r) => r.username === myUsername);

  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">⭐ XP Leaderboard</h1>
      <span class="section-sub">Favorites, reviews, completions, game streaks, daily challenges and approved free-watch links all add up.</span>
    </div>

    ${leaderboard.length ? `<ol class="leaderboard-list">${leaderboard.map((r, i) => rowHTML(r, i, myUsername)).join('')}</ol>` : emptyHTML('Nobody has earned XP yet — be the first!', '🏆')}

    ${myUsername && myRank && !inTop ? `
      <div class="leaderboard-you">
        <span class="leaderboard-rank">#${myRank}</span>
        <span class="leaderboard-user">You</span>
        <span class="leaderboard-streak">⭐ ${myXp.toLocaleString()} XP</span>
      </div>` : ''}

    <div class="hero-actions" style="justify-content:center;margin-top:24px">
      <a href="#/games" class="btn-pow btn-pow--pink">🎮 EARN XP</a>
      ${myUsername ? `<a href="#/u/${encodeURIComponent(myUsername)}" class="btn-pow btn-pow--outline">👤 My Profile</a>` : '<a href="#/login" class="btn-pow btn-pow--outline">LOG IN</a>'}
    </div>
  `;
}

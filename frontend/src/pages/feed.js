import { Users } from '../lib/usersApi.js';
import { Auth } from '../lib/authStore.js';
import { escapeHtml, errorHTML, wireRetry, emptyHTML, timeAgo, skeletonRows } from '../lib/ui.js';

// Friends' activity: what the people you follow added, finished or rated in
// the last 30 days (backend/src/routes/feed.js).

const STATUS_VERB = {
  completed: ['✅', 'completed'],
  watching: ['👀', 'started watching'],
  dropped: ['❌', 'dropped'],
  plan_to_watch: ['📌', 'plans to watch'],
};

// The emoji and the sentence after the username, as plain text.
export function feedItemText(item) {
  const title = item.title || `Anime #${Number(item.mal_id)}`;
  if (item.kind === 'review') return ['⭐', `rated ${title} ${Number(item.rating)}/10`];
  if (item.kind === 'status' && STATUS_VERB[item.status]) {
    const [emoji, verb] = STATUS_VERB[item.status];
    return [emoji, `${verb} ${title}`];
  }
  return ['💖', `added ${title} to their list`];
}

function itemHTML(item) {
  const [emoji, text] = feedItemText(item);
  const user = escapeHtml(item.username);
  return `
    <div class="notif-row feed-row">
      <a href="#/anime/${Number(item.mal_id)}" class="feed-poster" aria-hidden="true" tabindex="-1">
        ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" />` : `<span class="notif-emoji">${emoji}</span>`}
      </a>
      <span class="notif-text">
        <span class="feed-line">${item.image ? `${emoji} ` : ''}<a href="#/u/${encodeURIComponent(item.username)}"><strong>${user}</strong></a> <a href="#/anime/${Number(item.mal_id)}">${escapeHtml(text)}</a></span>
        ${item.body ? `<span class="feed-quote">“${escapeHtml(item.body)}”</span>` : ''}
      </span>
      <span class="notif-time">${escapeHtml(timeAgo(item.at))}</span>
    </div>`;
}

export async function renderFeed(root) {
  document.title = 'Friends’ Activity — AniNest';
  if (!Auth.get().user) {
    root.innerHTML = `
      <div class="empty-state">
        <span class="big-emoji">👥</span>
        Log in to follow people and see what they’re watching.
        <div class="hero-actions" style="justify-content:center;margin-top:16px">
          <a href="#/login" class="btn-pow btn-pow--pink">LOG IN</a>
        </div>
      </div>`;
    return;
  }

  root.innerHTML = skeletonRows(6, 'Loading activity');
  let data;
  try {
    data = await Users.feed();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load your feed — try again shortly!');
    wireRetry(root, () => renderFeed(root));
    return;
  }

  const following = data.following || [];
  const items = data.items || [];
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">👥 Friends’ Activity</h1>
      <span class="section-sub">What the people you follow added, finished and rated in the last 30 days.</span>
    </div>
    ${following.length ? `
      <div class="feed-following">
        <span class="section-sub">Following ${following.length}:</span>
        ${following.map((f) => `<a class="chip" href="#/u/${encodeURIComponent(f.username)}">${f.private ? '🔒 ' : ''}${escapeHtml(f.username)}</a>`).join('')}
      </div>` : ''}
    ${items.length
      ? `<div class="notif-list">${items.map(itemHTML).join('')}</div>`
      : emptyHTML(following.length
        ? 'Nothing new from the people you follow in the last 30 days.'
        : 'You’re not following anyone yet. Open someone’s profile (try the XP leaderboard) and press Follow.', '👥')}
    ${following.length ? '' : '<div class="hero-actions" style="justify-content:center"><a href="#/leaderboard/xp" class="chip">🏆 XP Leaderboard</a></div>'}
  `;
}

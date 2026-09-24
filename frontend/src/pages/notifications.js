import { Notifications } from '../lib/notificationsApi.js';
import { Auth } from '../lib/authStore.js';
import { escapeHtml, loadingHTML, errorHTML, wireRetry, emptyHTML, showToast } from '../lib/ui.js';

const KIND_META = {
  'anime-episodes': { emoji: '🆓', label: 'Free episodes' },
  'manga-chapter': { emoji: '📖', label: 'New chapter' },
};

function timeAgo(iso) {
  const then = new Date(`${String(iso).replace(' ', 'T')}Z`).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function rowHTML(n) {
  const meta = KIND_META[n.kind] || { emoji: '🔔', label: 'Update' };
  return `
    <a class="notif-row ${n.unread ? 'is-unread' : ''}" href="${escapeHtml(n.link)}" data-id="${n.id}" data-unread="${n.unread ? '1' : '0'}">
      <span class="notif-emoji">${meta.emoji}</span>
      <span class="notif-text">
        <strong>${escapeHtml(n.title)}</strong>
        <span>${escapeHtml(n.message)}</span>
      </span>
      <span class="notif-time">${escapeHtml(timeAgo(n.updatedAt))}</span>
    </a>`;
}

export async function renderNotifications(root) {
  document.title = 'Notifications — AniNest';
  if (!Auth.get().user) {
    root.innerHTML = `
      <div class="empty-state">
        <span class="big-emoji">🔒</span>
        Log in to see alerts for new episodes and chapters.
        <div class="hero-actions" style="justify-content:center;margin-top:16px">
          <a href="#/login" class="btn-pow btn-pow--pink">LOG IN</a>
        </div>
      </div>`;
    return;
  }

  root.innerHTML = loadingHTML('CHECKING FOR NEWS');
  let data;
  try {
    data = await Notifications.list();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load your notifications — try again shortly!');
    wireRetry(root, () => renderNotifications(root));
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🔔 Notifications</h1>
      <span class="section-sub">New free episodes for anime you're following, and new chapters of manga you're reading.</span>
    </div>
    ${data.unread ? '<div class="hero-actions" style="margin-bottom:12px"><button class="btn-pow btn-pow--sm" id="mark-all">✅ Mark all as read</button></div>' : ''}
    ${data.notifications.length
      ? `<div class="notif-list">${data.notifications.map(rowHTML).join('')}</div>`
      : emptyHTML('Nothing new yet. Favorite an anime or add manga to your reading list and you\'ll be told when there\'s more to watch or read.', '🔕')}
  `;

  root.querySelector('#mark-all')?.addEventListener('click', async () => {
    try {
      await Notifications.markAllRead();
      renderNotifications(root);
    } catch {
      showToast('Something went wrong — try again.');
    }
  });

  // Opening one marks it read (fire-and-forget) on the way to the title.
  root.querySelectorAll('.notif-row[data-unread="1"]').forEach((row) => {
    row.addEventListener('click', () => { Notifications.markRead(Number(row.dataset.id)).catch(() => {}); });
  });
}

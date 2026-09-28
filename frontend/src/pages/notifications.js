import { Notifications } from '../lib/notificationsApi.js';
import { Auth } from '../lib/authStore.js';
import { pushState, enablePush, disablePush } from '../lib/push.js';
import { escapeHtml, errorHTML, wireRetry, emptyHTML, showToast, timeAgo, skeletonRows } from '../lib/ui.js';

const KIND_META = {
  'anime-episodes': { emoji: '🆓', label: 'Free episodes' },
  'manga-chapter': { emoji: '📖', label: 'New chapter' },
  predictions: { emoji: '🔮', label: 'Predictions' },
};

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

  root.innerHTML = skeletonRows(5, 'Loading notifications');
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
    <div id="push-slot"></div>
    ${data.unread ? '<div class="hero-actions" style="margin-bottom:12px"><button class="btn-pow btn-pow--sm" id="mark-all">✅ Mark all as read</button></div>' : ''}
    ${data.notifications.length
      ? `<div class="notif-list">${data.notifications.map(rowHTML).join('')}</div>`
      : emptyHTML('Nothing new yet. Favorite an anime or add manga to your reading list and you\'ll be told when there\'s more to watch or read.', '🔕')}
  `;

  loadPushToggle(root);

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

// "Alerts on this device": only drawn when push can actually work here.
async function loadPushToggle(root) {
  const slot = root.querySelector('#push-slot');
  if (!slot) return;
  let state;
  try {
    state = await pushState();
  } catch {
    return;
  }
  if (!state.available || !slot.isConnected) return;
  slot.innerHTML = `
    <div class="push-toggle">
      <span>📲 ${state.subscribed ? 'Alerts are on for this device.' : 'Get these as alerts on this device, even with AniNest closed.'}</span>
      <button class="chip" id="push-btn">${state.subscribed ? 'Turn off' : 'Turn on'}</button>
    </div>`;
  const btn = slot.querySelector('#push-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (state.subscribed) {
        await disablePush(state);
        showToast('Alerts turned off for this device.');
      } else {
        await enablePush(state);
        showToast('Alerts are on 📲');
      }
    } catch (err) {
      showToast(err.message || 'Couldn’t change alerts — try again.');
    }
    loadPushToggle(root);
  });
}

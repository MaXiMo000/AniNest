import { apiGet, apiPost } from './http.js';
import { Auth } from './authStore.js';

const POLL_MS = 2 * 60 * 1000;
let timer = null;

// The header bell's badge lives in the auth area, which is re-rendered
// whenever auth changes - so the badge is looked up fresh each time rather
// than holding a reference to it.
function setBadge(count) {
  const el = document.getElementById('notif-count');
  if (!el) return;
  el.textContent = count > 99 ? '99+' : String(count);
  el.hidden = count === 0;
}

export const Notifications = {
  list: () => apiGet('/api/notifications'),

  async refreshBadge() {
    if (!Auth.get().user) { setBadge(0); return; }
    try {
      const { unread } = await apiGet('/api/notifications/unread-count');
      setBadge(unread);
    } catch { /* a failed poll just leaves the last number in place */ }
  },

  async markRead(id) {
    await apiPost('/api/notifications/read', { id });
    await Notifications.refreshBadge();
  },

  async markAllRead() {
    await apiPost('/api/notifications/read', { all: true });
    await Notifications.refreshBadge();
  },

  // Cheap unread-count poll for the bell; skipped while the tab is hidden and
  // a no-op when logged out.
  startPolling() {
    if (timer) return;
    Notifications.refreshBadge();
    timer = setInterval(() => { if (!document.hidden) Notifications.refreshBadge(); }, POLL_MS);
  },
};

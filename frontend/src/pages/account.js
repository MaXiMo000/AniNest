import { Auth } from '../lib/authStore.js';
import { Favorites } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, showToast } from '../lib/ui.js';

export function renderAccount(root) {
  const { user } = Auth.get();
  if (!user) { navigate('#/login'); return; }

  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : null;

  root.innerHTML = `
    <div class="account-page">
      <div class="account-avatar">${escapeHtml(user.username[0]?.toUpperCase() || '?')}</div>
      <h1 class="detail-title" style="-webkit-text-stroke:0.5px var(--ink)">${escapeHtml(user.username)}</h1>
      <p class="sub">${escapeHtml(user.email)}</p>
      ${joined ? `<p class="section-sub">Member since ${escapeHtml(joined)}</p>` : ''}
      <div class="hero-actions" style="justify-content:center;margin-top:20px">
        <a href="#/favorites" class="btn-pow btn-pow--blue">💖 My Favorites (${Favorites.count()})</a>
        <a href="#/u/${encodeURIComponent(user.username)}" class="btn-pow btn-pow--outline">👤 View Public Profile</a>
        <button id="logout-btn" class="btn-pow btn-pow--outline">🚪 Log Out</button>
      </div>
    </div>
  `;

  root.querySelector('#logout-btn').addEventListener('click', async () => {
    await Auth.logout();
    showToast('Logged out. See you next episode!');
    navigate('#/');
  });
}

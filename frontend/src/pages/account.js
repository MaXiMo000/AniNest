import { Auth } from '../lib/authStore.js';
import { Favorites } from '../lib/store.js';
import { Import } from '../lib/importApi.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, showToast } from '../lib/ui.js';

function importSectionHTML() {
  return `
    <section class="section" style="max-width:520px;margin:24px auto 0">
      <div class="section-head">
        <h2 class="section-title">📥 Import from AniList</h2>
        <span class="section-sub">Pull in your whole anime list by username - matches your AniList statuses to ours.</span>
      </div>
      <form id="import-form" class="hero-actions" style="justify-content:center">
        <input id="import-username" type="text" placeholder="AniList username" maxlength="50" required
          style="flex:1;min-width:180px;padding:12px 14px;border:2.5px solid var(--ink);border-radius:10px;background:var(--bg2);color:var(--text);font-family:var(--font-body);font-weight:600" />
        <button type="submit" class="btn-pow btn-pow--pink">IMPORT</button>
      </form>
      <div id="import-result" style="text-align:center;margin-top:12px"></div>
    </section>`;
}

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
        <a href="#/favorites" class="btn-pow btn-pow--blue" id="fav-count-link">💖 My Favorites (${Favorites.count()})</a>
        <a href="#/u/${encodeURIComponent(user.username)}" class="btn-pow btn-pow--outline">👤 View Public Profile</a>
        <button id="logout-btn" class="btn-pow btn-pow--outline">🚪 Log Out</button>
      </div>
    </div>

    ${importSectionHTML()}
  `;

  root.querySelector('#logout-btn').addEventListener('click', async () => {
    await Auth.logout();
    showToast('Logged out. See you next episode!');
    navigate('#/');
  });

  const importForm = root.querySelector('#import-form');
  const importResult = root.querySelector('#import-result');
  importForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = importForm.querySelector('#import-username').value.trim();
    if (!username) return;
    const submitBtn = importForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'IMPORTING...';
    importResult.innerHTML = '';
    try {
      const { added, updated, skipped, total } = await Import.anilist(username);
      await Favorites.loadFromServer();
      const favLink = root.querySelector('#fav-count-link');
      if (favLink) favLink.textContent = `💖 My Favorites (${Favorites.count()})`;
      if (!total) {
        importResult.innerHTML = `<p class="section-sub">That AniList list looks empty — nothing to import.</p>`;
      } else {
        importResult.innerHTML = `<p class="section-sub">✅ Imported ${added} new, updated ${updated} existing${skipped ? `, skipped ${skipped} (500-favorite limit reached)` : ''}.</p>`;
        showToast(`Imported ${added + updated} anime from AniList!`);
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'IMPORT';
      importForm.reset();
    } catch (err) {
      importResult.innerHTML = `<p class="section-sub">💥 ${escapeHtml(err.message || 'Import failed.')}</p>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'IMPORT';
    }
  });
}

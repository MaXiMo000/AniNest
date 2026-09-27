import { Auth } from '../lib/authStore.js';
import { Favorites } from '../lib/store.js';
import { Import } from '../lib/importApi.js';
import { Users } from '../lib/usersApi.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, showToast, badgesRowHTML, xpCardHTML } from '../lib/ui.js';
import { apiGet, apiPost, API_BASE } from '../lib/http.js';

// Private .ics feed of airing times for everything you're Watching
// (backend/src/lib/calendar.js). The link is only created when asked for.
function calendarSectionHTML() {
  return `
    <section class="section" style="max-width:520px;margin:24px auto 0">
      <div class="section-head">
        <h2 class="section-title">📅 Airing Calendar</h2>
        <span class="section-sub">New episodes of everything you're Watching, right in Google, Apple or Outlook Calendar. It updates itself.</span>
      </div>
      <div id="cal-box" class="hero-actions" style="justify-content:center">
        <button id="cal-get" class="btn-pow btn-pow--blue">GET MY CALENDAR LINK</button>
      </div>
    </section>`;
}

function calendarLinkHTML(url) {
  const webcal = url.replace(/^https?:/, 'webcal:');
  return `
    <input id="cal-url" type="text" readonly value="${escapeHtml(url)}" aria-label="Your private calendar link"
      style="width:100%;padding:12px 14px;border:2.5px solid var(--ink);border-radius:10px;background:var(--bg2);color:var(--text);font-family:var(--font-body);font-weight:600" />
    <a class="btn-pow btn-pow--blue" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}">Google Calendar</a>
    <a class="btn-pow btn-pow--outline" href="${escapeHtml(webcal)}">Apple / Outlook</a>
    <button id="cal-copy" class="chip">📋 Copy link</button>
    <button id="cal-rotate" class="chip">🔄 Reset link</button>
    <p class="section-sub" style="width:100%;text-align:center;margin:0">Keep this link private. Resetting it stops the old one working.</p>`;
}

function wireCalendar(root) {
  const box = root.querySelector('#cal-box');
  const show = (url) => {
    box.innerHTML = calendarLinkHTML(url);
    box.querySelector('#cal-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Calendar link copied!');
      } catch {
        box.querySelector('#cal-url').select();
      }
    });
    box.querySelector('#cal-rotate').addEventListener('click', async () => {
      if (!window.confirm('Make a new link? Calendars using the old one stop updating.')) return;
      try {
        show((await apiPost('/api/calendar/link/rotate')).url);
        showToast('New link made. Re-subscribe with it.');
      } catch {
        showToast('Something went wrong — try again.');
      }
    });
  };
  box.querySelector('#cal-get').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      show((await apiGet('/api/calendar/link')).url);
    } catch {
      e.target.disabled = false;
      showToast('Couldn’t get your calendar link — try again.');
    }
  });
}

const INPUT_STYLE = 'width:100%;padding:12px 14px;border:2.5px solid var(--ink);border-radius:10px;background:var(--bg2);color:var(--text);font-family:var(--font-body);font-weight:600';

// Change password, sign out other devices, download everything, delete.
function securitySectionHTML() {
  return `
    <section class="section" style="max-width:520px;margin:24px auto 0">
      <div class="section-head">
        <h2 class="section-title">🔒 Account & Privacy</h2>
        <span class="section-sub">Changing your password signs out every other device.</span>
      </div>
      <form id="password-form" class="hero-actions" style="justify-content:center" novalidate>
        <input id="current-password" type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password" required style="${INPUT_STYLE}" />
        <input id="new-password" type="password" autocomplete="new-password" placeholder="New password (8+ chars, a letter and a number)" aria-label="New password" required style="${INPUT_STYLE}" />
        <button type="submit" class="btn-pow btn-pow--blue">CHANGE PASSWORD</button>
      </form>
      <div id="password-result" style="text-align:center;margin-top:8px"></div>
      <label class="hero-actions" style="justify-content:center;margin-top:14px;gap:10px;font-weight:700;cursor:pointer">
        <input id="private-toggle" type="checkbox" ${Auth.get().user?.isPrivate ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--pink)" />
        🔒 Private profile: hide my lists and reviews from my public page
      </label>
      <div class="hero-actions" style="justify-content:center;margin-top:14px">
        <button id="logout-others" class="chip">📵 Log out other devices</button>
        <a id="export-data" class="chip" href="${API_BASE}/api/auth/export" download>💾 Download my data</a>
        <button id="delete-account" class="chip">🗑️ Delete my account</button>
      </div>
    </section>`;
}

function wireSecurity(root) {
  const form = root.querySelector('#password-form');
  const result = root.querySelector('#password-result');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    result.innerHTML = '';
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await apiPost('/api/auth/password', {
        currentPassword: form.querySelector('#current-password').value,
        newPassword: form.querySelector('#new-password').value,
      });
      form.reset();
      showToast('Password changed. Other devices are signed out.');
    } catch (err) {
      result.innerHTML = `<p class="section-sub">💥 ${escapeHtml(err.message || 'Couldn’t change your password.')}</p>`;
    }
    btn.disabled = false;
  });

  const privateToggle = root.querySelector('#private-toggle');
  privateToggle.addEventListener('change', async () => {
    const want = privateToggle.checked;
    privateToggle.disabled = true;
    try {
      await Auth.setPrivate(want);
      showToast(want ? 'Your profile is private now.' : 'Your profile is public again.');
    } catch {
      privateToggle.checked = !want;
      privateToggle.disabled = false;
      showToast('Something went wrong — try again.');
    }
  });

  root.querySelector('#logout-others').addEventListener('click', async () => {
    try {
      await apiPost('/api/auth/logout-others');
      showToast('Every other device is signed out.');
    } catch {
      showToast('Something went wrong — try again.');
    }
  });

  root.querySelector('#delete-account').addEventListener('click', async () => {
    const password = window.prompt('This deletes your account, lists, reviews, XP and scores for good. Enter your password to confirm.');
    if (!password) return;
    try {
      await apiPost('/api/auth/delete-account', { password });
      Auth.forget();
      showToast('Your account is deleted. Sayonara!');
      navigate('#/');
    } catch (err) {
      showToast(err.message || 'Couldn’t delete your account.');
    }
  });
}

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
  document.title = 'My Account — AniNest';
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
      <div id="xp-card"></div>
      <div id="badges-row"></div>
      <div class="hero-actions" style="justify-content:center;margin-top:14px"><a href="#/leaderboard/xp" class="chip">🏆 XP Leaderboard</a></div>
    </div>

    ${calendarSectionHTML()}
    ${importSectionHTML()}
    ${securitySectionHTML()}
  `;

  wireCalendar(root);
  wireSecurity(root);

  // Badges reuse the public profile endpoint (same data, same computation
  // - see backend/src/lib/badges.js) rather than a second route just for
  // "my own" badges. Loaded separately from the initial render so opening
  // Account doesn't wait on it.
  Users.profile(user.username)
    .then(({ badges, xp }) => {
      const el = root.querySelector('#badges-row');
      if (el) el.innerHTML = badgesRowHTML(badges);
      const xpEl = root.querySelector('#xp-card');
      if (xpEl) xpEl.innerHTML = xpCardHTML(xp);
    })
    .catch(() => {});

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

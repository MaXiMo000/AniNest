import { route, notFound, startRouter, navigate, currentPath } from './lib/router.js';
import { renderHome } from './pages/home.js';
import { renderBrowse } from './pages/browse.js';
import { renderDetails } from './pages/details.js';
import { renderFavorites } from './pages/favorites.js';
import { renderSchedule } from './pages/schedule.js';
import { renderLogin } from './pages/login.js';
import { renderRegister } from './pages/register.js';
import { renderAccount } from './pages/account.js';
import { renderProfile } from './pages/profile.js';
import { renderStudio } from './pages/studio.js';
import { renderPerson } from './pages/person.js';
import { renderScreenshotSearch } from './pages/screenshotSearch.js';
import { renderTierList } from './pages/tierList.js';
import { renderGamesHub } from './pages/games/hub.js';
import { renderHigherLower } from './pages/games/higherLower.js';
import { renderGuessTheAnime } from './pages/games/guessTheAnime.js';
import { renderQuiz } from './pages/games/quiz.js';
import { renderDailyChallenge, renderMangaDailyChallenge } from './pages/games/dailyChallenge.js';
import { renderLeaderboard } from './pages/games/leaderboard.js';
import { renderCompare } from './pages/compare.js';
import { renderXpLeaderboard } from './pages/xpLeaderboard.js';
import { renderNotifications } from './pages/notifications.js';
import { renderMangaBrowse } from './pages/mangaBrowse.js';
import { renderMangaDetail } from './pages/mangaDetail.js';
import { renderMangaFavorites } from './pages/mangaFavorites.js';
import { renderWatchSourceSubmit } from './pages/watchSourceSubmit.js';
import { renderWatchSourcesAdmin } from './pages/admin/watchSourcesAdmin.js';
import { wireCardEvents, wireMangaCardEvents, updateFavCount, updateMangaFavCount, emptyHTML, escapeHtml, loadingHTML } from './lib/ui.js';
import { Favorites } from './lib/store.js';
import { MangaFavorites } from './lib/mangaStore.js';
import { Auth } from './lib/authStore.js';
import { Notifications } from './lib/notificationsApi.js';
import { installGlobalErrorReporting } from './lib/errorReporter.js';
import { wirePowSelects } from './lib/powSelect.js';

installGlobalErrorReporting();

const app = document.getElementById('app');
const authArea = document.getElementById('auth-area');

function renderAuthArea() {
  const { user } = Auth.get();
  authArea.innerHTML = user
    ? `<a href="#/notifications" class="nav-bell" aria-label="Notifications" title="Notifications">🔔<span id="notif-count" class="fav-count" hidden>0</span></a><a href="#/account" class="user-chip"><span class="user-avatar">${escapeHtml(user.username[0]?.toUpperCase() || '?')}</span><span class="user-name">${escapeHtml(user.username)}</span></a>`
    : `<span class="auth-links"><a href="#/login">Log In</a><a href="#/register" class="btn-pow btn-pow--sm">Sign Up</a></span>`;
  // Drives the [data-admin-only] nav link's visibility (see index.html /
  // style.css) - CSS-gated rather than conditionally rendered HTML, so it's
  // one class toggle here instead of duplicating the auth-render logic.
  document.body.classList.toggle('is-admin', Boolean(user?.isAdmin));
  // The badge element was just re-created, so fill it in again.
  Notifications.refreshBadge();
}

// Single global delegated handler for every anime-card / favorite-heart click,
// across every page. Attaching this once (instead of per-render) avoids
// stacking duplicate listeners on the persistent #app node as the SPA
// re-renders its innerHTML on navigation. wireMangaCardEvents is a separate
// handler (not a branch inside wireCardEvents) keying off disjoint
// selectors (.anime-card/[data-fav-id] vs .manga-card/[data-manga-fav-id]),
// so both listen on the same #app node without conflicting.
wireCardEvents(app);
wireMangaCardEvents(app);
wirePowSelects();

Favorites.subscribe(() => {
  updateFavCount();
  if (currentPath() === '/favorites') renderFavorites(app);
});

MangaFavorites.subscribe(() => {
  updateMangaFavCount();
  if (currentPath() === '/manga-favorites') renderMangaFavorites(app);
});

Auth.subscribe(() => {
  renderAuthArea();
  if (currentPath() === '/account') renderAccount(app);
});

route('/', () => renderHome(app));
route('/browse', ({ params }) => renderBrowse(app, params));
route('/anime/:id', ({ path }) => renderDetails(app, path.id));
route('/favorites', () => renderFavorites(app));
route('/schedule', ({ params }) => renderSchedule(app, params));
route('/login', () => renderLogin(app));
route('/register', () => renderRegister(app));
route('/account', () => renderAccount(app));
route('/u/:username', ({ path }) => renderProfile(app, path.username));
route('/studio/:name', ({ path }) => renderStudio(app, path.name));
route('/person/:name', ({ path }) => renderPerson(app, path.name));
route('/screenshot-search', () => renderScreenshotSearch(app));
route('/tier-list', () => renderTierList(app));
route('/games', () => renderGamesHub(app));
route('/games/daily', () => renderDailyChallenge(app));
route('/games/manga-daily', () => renderMangaDailyChallenge(app));
route('/games/higher-lower', ({ params }) => renderHigherLower(app, params));
route('/games/guess-the-anime', ({ params }) => renderGuessTheAnime(app, params));
route('/games/quiz', () => renderQuiz(app));
route('/games/leaderboard/:game', ({ path }) => renderLeaderboard(app, path.game));
route('/compare', () => renderCompare(app));
route('/leaderboard/xp', () => renderXpLeaderboard(app));
route('/notifications', () => renderNotifications(app));
route('/manga', ({ params }) => renderMangaBrowse(app, params));
route('/manga/:id', ({ path }) => renderMangaDetail(app, path.id));
route('/manga-favorites', () => renderMangaFavorites(app));
route('/anime/:id/submit-watch-link', ({ path }) => renderWatchSourceSubmit(app, path.id));
route('/admin/watch-sources', () => renderWatchSourcesAdmin(app));

notFound(() => {
  app.innerHTML = emptyHTML('This page wandered off into the filler dimension.', '🌀');
});

async function boot() {
  renderAuthArea();
  updateFavCount();
  // Several pages (account.js, login.js, register.js, ...) read
  // Auth.get().user synchronously on their very first render to decide
  // whether to redirect (e.g. bounce a logged-out visitor away from
  // /account) - that's only correct once Auth.init() has actually
  // resolved, so startRouter() can't fire until then. Without this
  // loading state, #app sits completely empty for that whole wait - on a
  // cold Render free-tier backend (documented elsewhere in this repo: a
  // spun-down instance can take 20-60s to wake) that's a long blank page
  // with zero feedback, easy to mistake for the site being broken.
  app.innerHTML = loadingHTML('WAKING UP ANINEST');
  await Auth.init();
  await Favorites.loadFromServer();
  await MangaFavorites.loadFromServer();
  renderAuthArea();
  updateFavCount();
  updateMangaFavCount();
  Notifications.startPolling();
  startRouter();
}
boot();

// Header search box
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  navigate(q ? `#/browse?q=${encodeURIComponent(q)}` : '#/browse');
});

// Mobile nav toggle
document.getElementById('nav-toggle').addEventListener('click', () => {
  document.body.classList.toggle('nav-open');
});

// Header "More"/"Library" dropdowns - click-toggled (not hover-only) so it
// works the same on touch and mouse. Opening one closes any other that's
// already open; clicking outside, pressing Escape, or navigating anywhere
// (a link click inside the menu, or any route change) closes it too.
document.querySelectorAll('.nav-dropdown-toggle').forEach((toggle) => {
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = toggle.closest('.nav-dropdown');
    const wasOpen = dropdown.classList.contains('is-open');
    document.querySelectorAll('.nav-dropdown.is-open').forEach((d) => d.classList.remove('is-open'));
    dropdown.classList.toggle('is-open', !wasOpen);
  });
});
document.addEventListener('click', () => {
  document.querySelectorAll('.nav-dropdown.is-open').forEach((d) => d.classList.remove('is-open'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.nav-dropdown.is-open').forEach((d) => d.classList.remove('is-open'));
});

// PWA install prompt. Chrome suppresses its own mini-infobar far more often
// than it used to, so capturing beforeinstallprompt and offering our own
// button is the reliable way to surface "Add to Home Screen" at all - the
// event only fires when the browser has already decided the site qualifies
// (served over HTTPS/localhost, has a valid manifest + registered SW).
let deferredInstallPrompt = null;
const installBtn = document.getElementById('install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  installBtn.hidden = true;
  await deferredInstallPrompt.prompt();
  deferredInstallPrompt = null;
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; });

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
import { renderGamesHub } from './pages/games/hub.js';
import { renderHigherLower } from './pages/games/higherLower.js';
import { renderGuessTheAnime } from './pages/games/guessTheAnime.js';
import { renderQuiz } from './pages/games/quiz.js';
import { renderDailyChallenge } from './pages/games/dailyChallenge.js';
import { renderLeaderboard } from './pages/games/leaderboard.js';
import { renderCompare } from './pages/compare.js';
import { wireCardEvents, updateFavCount, emptyHTML, escapeHtml } from './lib/ui.js';
import { Favorites } from './lib/store.js';
import { Auth } from './lib/authStore.js';
import { installGlobalErrorReporting } from './lib/errorReporter.js';
import { wirePowSelects } from './lib/powSelect.js';

installGlobalErrorReporting();

const app = document.getElementById('app');
const authArea = document.getElementById('auth-area');

function renderAuthArea() {
  const { user } = Auth.get();
  authArea.innerHTML = user
    ? `<a href="#/account" class="user-chip"><span class="user-avatar">${escapeHtml(user.username[0]?.toUpperCase() || '?')}</span>${escapeHtml(user.username)}</a>`
    : `<span class="auth-links"><a href="#/login">Log In</a><a href="#/register" class="btn-pow btn-pow--sm">Sign Up</a></span>`;
}

// Single global delegated handler for every anime-card / favorite-heart click,
// across every page. Attaching this once (instead of per-render) avoids
// stacking duplicate listeners on the persistent #app node as the SPA
// re-renders its innerHTML on navigation.
wireCardEvents(app);
wirePowSelects();

Favorites.subscribe(() => {
  updateFavCount();
  if (currentPath() === '/favorites') renderFavorites(app);
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
route('/games', () => renderGamesHub(app));
route('/games/daily', () => renderDailyChallenge(app));
route('/games/higher-lower', () => renderHigherLower(app));
route('/games/guess-the-anime', () => renderGuessTheAnime(app));
route('/games/quiz', () => renderQuiz(app));
route('/games/leaderboard/:game', ({ path }) => renderLeaderboard(app, path.game));
route('/compare', () => renderCompare(app));

notFound(() => {
  app.innerHTML = emptyHTML('This page wandered off into the filler dimension.', '🌀');
});

async function boot() {
  renderAuthArea();
  updateFavCount();
  await Auth.init();
  await Favorites.loadFromServer();
  renderAuthArea();
  updateFavCount();
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

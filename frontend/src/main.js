import { route, notFound, startRouter, navigate, currentPath } from './lib/router.js';
import { renderHome } from './pages/home.js';
import { renderFavorites } from './pages/favorites.js';
import { renderAccount } from './pages/account.js';
import { renderMangaFavorites } from './pages/mangaFavorites.js';
import { wireCardEvents, wireMangaCardEvents, updateFavCount, updateMangaFavCount, emptyHTML, escapeHtml, loadingHTML } from './lib/ui.js';
import { Favorites } from './lib/store.js';
import { MangaFavorites } from './lib/mangaStore.js';
import { Auth } from './lib/authStore.js';
import { Notifications } from './lib/notificationsApi.js';
import { installGlobalErrorReporting } from './lib/errorReporter.js';
import { wirePowSelects } from './lib/powSelect.js';
import { wireThemeToggle } from './lib/theme.js';

// Pages load on first visit (each becomes its own chunk), so the first page
// doesn't download the admin tools and eleven games. Home, favorites and
// account stay in the main bundle: they're the landing page or re-rendered
// from store subscriptions below.
// A tab left open across a deploy asks for chunk names that no longer
// exist; reloading once picks up the new build.
async function loadPage(load) {
  try {
    const mod = await load();
    try { sessionStorage.removeItem('aninest-chunk-reload'); } catch { /* storage blocked */ }
    return mod;
  } catch (err) {
    let reloaded = false;
    try { reloaded = sessionStorage.getItem('aninest-chunk-reload') === '1'; sessionStorage.setItem('aninest-chunk-reload', '1'); } catch { reloaded = true; }
    if (!reloaded) window.location.reload();
    throw err;
  }
}
const page = (load, name) => async (...args) => (await loadPage(load))[name](...args);
const load_browse = () => import('./pages/browse.js');
const load_feed = () => import('./pages/feed.js');
const renderFeed = page(load_feed, 'renderFeed');
const load_free = () => import('./pages/free.js');
const renderFree = page(load_free, 'renderFree');
const renderBrowse = page(load_browse, 'renderBrowse');
const load_details = () => import('./pages/details.js');
const renderDetails = page(load_details, 'renderDetails');
const load_franchise = () => import('./pages/franchise.js');
const renderFranchise = page(load_franchise, 'renderFranchise');
const load_vibe = () => import('./pages/vibe.js');
const renderVibe = page(load_vibe, 'renderVibe');
const load_together = () => import('./pages/together.js');
const renderTogether = page(load_together, 'renderTogether');
const renderRoom = page(load_together, 'renderRoom');
const load_tournament = () => import('./pages/tournament.js');
const renderTournament = page(load_tournament, 'renderTournament');
const renderPredictions = page(() => import('./pages/predictions.js'), 'renderPredictions');
const load_wrapped = () => import('./pages/wrapped.js');
const renderWrapped = page(load_wrapped, 'renderWrapped');
const load_schedule = () => import('./pages/schedule.js');
const renderSchedule = page(load_schedule, 'renderSchedule');
const load_login = () => import('./pages/login.js');
const renderLogin = page(load_login, 'renderLogin');
const load_register = () => import('./pages/register.js');
const renderRegister = page(load_register, 'renderRegister');
const load_passwordReset = () => import('./pages/passwordReset.js');
const renderForgotPassword = page(load_passwordReset, 'renderForgotPassword');
const renderResetPassword = page(load_passwordReset, 'renderResetPassword');
const renderUnsubscribe = page(() => import('./pages/unsubscribe.js'), 'renderUnsubscribe');
const load_profile = () => import('./pages/profile.js');
const renderProfile = page(load_profile, 'renderProfile');
const load_studio = () => import('./pages/studio.js');
const renderStudio = page(load_studio, 'renderStudio');
const load_person = () => import('./pages/person.js');
const renderPerson = page(load_person, 'renderPerson');
const load_screenshotSearch = () => import('./pages/screenshotSearch.js');
const renderScreenshotSearch = page(load_screenshotSearch, 'renderScreenshotSearch');
const load_tierList = () => import('./pages/tierList.js');
const renderTierList = page(load_tierList, 'renderTierList');
const load_games_hub = () => import('./pages/games/hub.js');
const renderGamesHub = page(load_games_hub, 'renderGamesHub');
const load_games_higherLower = () => import('./pages/games/higherLower.js');
const renderHigherLower = page(load_games_higherLower, 'renderHigherLower');
const load_games_guessTheAnime = () => import('./pages/games/guessTheAnime.js');
const renderGuessTheAnime = page(load_games_guessTheAnime, 'renderGuessTheAnime');
const load_games_quiz = () => import('./pages/games/quiz.js');
const renderQuiz = page(load_games_quiz, 'renderQuiz');
const load_games_dailyChallenge = () => import('./pages/games/dailyChallenge.js');
const renderDailyChallenge = page(load_games_dailyChallenge, 'renderDailyChallenge');
const renderMangaDailyChallenge = page(load_games_dailyChallenge, 'renderMangaDailyChallenge');
const load_games_leaderboard = () => import('./pages/games/leaderboard.js');
const renderLeaderboard = page(load_games_leaderboard, 'renderLeaderboard');
const load_games_choiceGames = () => import('./pages/games/choiceGames.js');
const renderChoiceGame = page(load_games_choiceGames, 'renderChoiceGame');
const load_games_timeline = () => import('./pages/games/timeline.js');
const renderTimeline = page(load_games_timeline, 'renderTimeline');
const load_games_stats = () => import('./pages/games/stats.js');
const renderGameStats = page(load_games_stats, 'renderGameStats');
const load_compare = () => import('./pages/compare.js');
const renderCompare = page(load_compare, 'renderCompare');
const load_xpLeaderboard = () => import('./pages/xpLeaderboard.js');
const renderXpLeaderboard = page(load_xpLeaderboard, 'renderXpLeaderboard');
const load_notifications = () => import('./pages/notifications.js');
const renderNotifications = page(load_notifications, 'renderNotifications');
const load_mangaBrowse = () => import('./pages/mangaBrowse.js');
const renderMangaBrowse = page(load_mangaBrowse, 'renderMangaBrowse');
const load_mangaDetail = () => import('./pages/mangaDetail.js');
const renderMangaDetail = page(load_mangaDetail, 'renderMangaDetail');
const load_watchSourceSubmit = () => import('./pages/watchSourceSubmit.js');
const renderWatchSourceSubmit = page(load_watchSourceSubmit, 'renderWatchSourceSubmit');
const load_admin_watchSourcesAdmin = () => import('./pages/admin/watchSourcesAdmin.js');
const renderWatchSourcesAdmin = page(load_admin_watchSourcesAdmin, 'renderWatchSourcesAdmin');
const load_admin_reviewReports = () => import('./pages/admin/reviewReports.js');
const renderReviewReportsAdmin = page(load_admin_reviewReports, 'renderReviewReportsAdmin');

installGlobalErrorReporting();
wireThemeToggle(document.getElementById('theme-toggle'));

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

route('/', ({ root }) => renderHome(root));
route('/browse', ({ params, root }) => renderBrowse(root, params));
route('/free', ({ root }) => renderFree(root));
route('/feed', ({ root }) => renderFeed(root));
route('/vibe', ({ params, root }) => renderVibe(root, params));
route('/together', ({ root }) => renderTogether(root));
route('/together/:code', ({ path, root }) => renderRoom(root, path.code));
route('/tournament', ({ params, root }) => renderTournament(root, params));
route('/predictions', ({ params, root }) => renderPredictions(root, params));
route('/wrapped', ({ params, root }) => renderWrapped(root, params));
route('/anime/:id', ({ path, root }) => renderDetails(root, path.id));
route('/franchise/:slug', ({ path, root }) => renderFranchise(root, path.slug));
route('/favorites', ({ root }) => renderFavorites(root));
route('/schedule', ({ params, root }) => renderSchedule(root, params));
route('/login', ({ root }) => renderLogin(root));
route('/register', ({ root }) => renderRegister(root));
route('/account', ({ root }) => renderAccount(root));
route('/forgot-password', ({ root }) => renderForgotPassword(root));
route('/reset-password', ({ params, root }) => renderResetPassword(root, params));
route('/unsubscribe', ({ params, root }) => renderUnsubscribe(root, params));
route('/u/:username', ({ path, root }) => renderProfile(root, path.username));
route('/studio/:name', ({ path, root }) => renderStudio(root, path.name));
route('/person/:name', ({ path, root }) => renderPerson(root, path.name));
route('/screenshot-search', ({ root }) => renderScreenshotSearch(root));
route('/tier-list', ({ root }) => renderTierList(root));
route('/games', ({ root }) => renderGamesHub(root));
route('/games/daily', ({ root }) => renderDailyChallenge(root));
route('/games/manga-daily', ({ root }) => renderMangaDailyChallenge(root));
route('/games/higher-lower', ({ params, root }) => renderHigherLower(root, params));
route('/games/guess-the-anime', ({ params, root }) => renderGuessTheAnime(root, params));
route('/games/quiz', ({ root }) => renderQuiz(root));
route('/games/timeline', ({ params, root }) => renderTimeline(root, params));
for (const slug of ['studio-match', 'source-guess', 'emoji-plot', 'cast-call', 'name-that-opening']) {
  route(`/games/${slug}`, ({ params }) => renderChoiceGame(app, slug, params));
}
route('/games/leaderboard/:game', ({ path, params, root }) => renderLeaderboard(root, path.game, params));
route('/games/stats', ({ root }) => renderGameStats(root));
route('/compare', ({ root }) => renderCompare(root));
route('/leaderboard/xp', ({ root }) => renderXpLeaderboard(root));
route('/notifications', ({ root }) => renderNotifications(root));
route('/manga', ({ params, root }) => renderMangaBrowse(root, params));
route('/manga/:id', ({ path, root }) => renderMangaDetail(root, path.id));
route('/manga-favorites', ({ root }) => renderMangaFavorites(root));
route('/anime/:id/submit-watch-link', ({ path, root }) => renderWatchSourceSubmit(root, path.id));
route('/admin/watch-sources', ({ root }) => renderWatchSourcesAdmin(root));
route('/admin/reviews', ({ root }) => renderReviewReportsAdmin(root));

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
  startRouter(app);
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

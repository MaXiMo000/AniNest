import { route, notFound, startRouter, navigate, currentPath } from './lib/router.js';
import { renderHome } from './pages/home.js';
import { renderBrowse } from './pages/browse.js';
import { renderDetails } from './pages/details.js';
import { renderFavorites } from './pages/favorites.js';
import { renderSchedule } from './pages/schedule.js';
import { renderLogin } from './pages/login.js';
import { renderRegister } from './pages/register.js';
import { renderAccount } from './pages/account.js';
import { wireCardEvents, updateFavCount, emptyHTML, escapeHtml } from './lib/ui.js';
import { Favorites } from './lib/store.js';
import { Auth } from './lib/authStore.js';

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

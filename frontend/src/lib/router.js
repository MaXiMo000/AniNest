// Minimal hash router: '#/browse?q=naruto' -> { path: '/browse', params: URLSearchParams }

const routes = [];
let notFoundHandler = () => {};
const DEFAULT_TITLE = document.title;

export function route(pattern, handler) {
  // pattern like '/anime/:id'
  const paramNames = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:[^/]+/g, (m) => { paramNames.push(m.slice(1)); return '([^/]+)'; }) + '$'
  );
  routes.push({ regex, paramNames, handler });
}

export function notFound(handler) { notFoundHandler = handler; }

function parseHash() {
  let hash = window.location.hash.slice(1) || '/';
  const [path, query = ''] = hash.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

export function currentQuery() {
  return parseHash().params;
}

export function currentPath() {
  return parseHash().path;
}

// Scroll-position memory for the browser's own Back/Forward buttons (not
// for ordinary link clicks, which should still land at the top of a fresh
// page). `restoreHash` is set by the `popstate` listener below - it fires
// before `hashchange` on a real back/forward navigation, and never fires
// for a plain link click or navigate() call.
const scrollPositions = new Map();
let restoreHash = null;

function saveScrollForOldHash(e) {
  try {
    const oldHash = new URL(e.oldURL).hash.slice(1) || '/';
    scrollPositions.set(oldHash, window.scrollY);
  } catch { /* malformed oldURL - nothing worth restoring for */ }
}

async function dispatch() {
  const { path, params } = parseHash();
  const fullHash = window.location.hash.slice(1) || '/';
  const isRestoring = restoreHash === fullHash;
  restoreHash = null;

  if (!isRestoring) {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }
  document.body.classList.remove('nav-open');
  document.querySelectorAll('.nav-dropdown.is-open').forEach((d) => d.classList.remove('is-open'));
  highlightNav(path, params);
  // Pages that name themselves set document.title while rendering; the rest
  // would otherwise keep the previous page's title.
  document.title = DEFAULT_TITLE;

  for (const r of routes) {
    const match = r.regex.exec(path);
    if (match) {
      const namedParams = {};
      r.paramNames.forEach((name, i) => { namedParams[name] = decodeURIComponent(match[i + 1]); });
      await r.handler({ params, path: namedParams });
      if (isRestoring) {
        const savedY = scrollPositions.get(fullHash);
        // Wait a frame so the just-rendered page has its real layout height
        // before we scroll into it (images are still loading async, but a
        // rough restore beats none).
        if (savedY != null) requestAnimationFrame(() => window.scrollTo({ top: savedY, behavior: 'auto' }));
      }
      return;
    }
  }
  notFoundHandler();
}

function highlightNav(path, params) {
  const full = params.toString() ? `${path}?${params.toString()}` : path;
  document.querySelectorAll('.main-nav a[data-route]').forEach((a) => {
    const target = a.getAttribute('data-route');
    const isHome = target === '/' && path === '/';
    a.classList.toggle('active', isHome || target === full || (target === '/browse' && path === '/browse' && !params.toString()));
  });
}

export function startRouter() {
  window.addEventListener('hashchange', saveScrollForOldHash);
  window.addEventListener('popstate', () => {
    restoreHash = window.location.hash.slice(1) || '/';
  });
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

export function navigate(hash) {
  window.location.hash = hash;
}

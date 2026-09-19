// Minimal hash router: '#/browse?q=naruto' -> { path: '/browse', params: URLSearchParams }

const routes = [];
let notFoundHandler = () => {};

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

async function dispatch() {
  const { path, params } = parseHash();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  document.body.classList.remove('nav-open');
  highlightNav(path, params);

  for (const r of routes) {
    const match = r.regex.exec(path);
    if (match) {
      const namedParams = {};
      r.paramNames.forEach((name, i) => { namedParams[name] = decodeURIComponent(match[i + 1]); });
      await r.handler({ params, path: namedParams });
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
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

export function navigate(hash) {
  window.location.hash = hash;
}

import { apiPost } from './http.js';

// Relays uncaught frontend errors to the backend so they land in the same
// log stream as backend errors - one place to look, instead of backend
// logs on Render and frontend errors nowhere at all (browser consoles are
// never actually watched in production). A hard cap guards against an
// error loop (e.g. a render bug that throws on every animation frame)
// spamming the backend/log storage.
const MAX_REPORTS_PER_SESSION = 20;
let reportedCount = 0;

export function reportError(message, stack) {
  if (reportedCount >= MAX_REPORTS_PER_SESSION) return;
  reportedCount += 1;
  apiPost('/api/client-errors', {
    message: String(message || 'Unknown error').slice(0, 500),
    stack: stack ? String(stack).slice(0, 2000) : undefined,
    url: window.location.href.slice(0, 500),
  }).catch(() => { /* best effort - error reporting must never itself throw */ });
}

export function installGlobalErrorReporting() {
  window.addEventListener('error', (e) => {
    reportError(e.message, e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportError(e.reason?.message || String(e.reason), e.reason?.stack);
  });
}

// Thin fetch wrapper for talking to our own backend (not third-party APIs
// directly — see api.js). Always sends cookies (for the session) and, for
// mutating requests, echoes a CSRF token back as a header — the backend's
// double-submit check requires both the cookie (sent automatically by the
// browser) and this header to match.
//
// The token is learned from the x-csrf-token *response* header (captured
// into memory below), not read from the cookie via `document.cookie` — the
// cookie is httpOnly, and in local dev the frontend and backend are
// different origins anyway.
//
// In production API_BASE is the frontend's own origin: Render rewrites
// /api/* to the backend (see render.yaml), so the cookies are first-party.
// Calling the backend's onrender.com URL directly makes them third-party
// cookies, which browsers that block those drop, and every POST then 403s. The backend
// exposes the x-csrf-token header via CORS for the local-dev cross-origin
// case (see backend/src/middleware/csrf.js).

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

let csrfToken = null;

export class ApiError extends Error {
  // `extra` carries any additional JSON fields an error response included
  // beyond `error` itself (e.g. { quotaExceeded: true } or
  // { notConfigured: true } from the watch-sources admin routes) - spread
  // onto the instance so callers can just check err.quotaExceeded etc.,
  // the same way err.status already works for every existing caller.
  constructor(message, status, extra) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const CSRF_ERROR = 'Invalid or missing CSRF token.';

function isMutating(method) {
  return method !== 'GET' && method !== 'HEAD';
}

// The token only ever arrives on a response, so a mutating request sent
// before any response (e.g. login right after a failed /api/auth/me) would
// go out with no header and be rejected. Any GET hands one back; /api/health
// is the cheapest.
async function ensureCsrfToken() {
  if (csrfToken) return;
  try {
    const res = await fetch(API_BASE + '/api/health', { credentials: 'include' });
    const token = res.headers.get('x-csrf-token');
    if (token) csrfToken = token;
  } catch { /* the real request below reports the failure */ }
}

async function send(path, method, body, file, fileType) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  else if (file !== undefined) headers['Content-Type'] = fileType;
  if (isMutating(method) && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    credentials: 'include',
    body: file !== undefined ? file : (body !== undefined ? JSON.stringify(body) : undefined),
  });

  const freshToken = res.headers.get('x-csrf-token');
  if (freshToken) csrfToken = freshToken;

  if (res.status === 204) return { res, json: null };

  let json = null;
  try { json = await res.json(); } catch { /* empty/non-JSON body */ }
  return { res, json };
}

// `file`/`fileType` bypass the JSON encoding entirely - used for a raw
// binary upload (e.g. the screenshot-search endpoint), which sends a File
// object as-is with its own Content-Type rather than a JSON body.
export async function apiFetch(path, { method = 'GET', body, file, fileType } = {}) {
  if (isMutating(method)) await ensureCsrfToken();

  let { res, json } = await send(path, method, body, file, fileType);

  // A stale in-memory token (the cookie expired or was cleared) gets a
  // fresh one on the 403 response itself, so one retry recovers. If the
  // cookie can't be stored at all the retry fails the same way, so there
  // is no loop.
  if (res.status === 403 && json?.error === CSRF_ERROR) {
    ({ res, json } = await send(path, method, body, file, fileType));
  }

  if (res.status === 204) return null;

  if (!res.ok) {
    // Excludes `error`/`message`/`status` specifically (not just `error`) so
    // a response body can never clobber Error's own built-in properties.
    const { error: _error, message: _message, status: _status, ...extra } = json || {};
    throw new ApiError(json?.error || `Request failed (${res.status})`, res.status, extra);
  }
  return json;
}

// Test-only: module state survives between vitest cases.
export function _resetCsrfTokenForTests() {
  csrfToken = null;
}

export const apiGet = (path) => apiFetch(path, { method: 'GET' });
export const apiPost = (path, body) => apiFetch(path, { method: 'POST', body: body ?? {} });
export const apiDelete = (path) => apiFetch(path, { method: 'DELETE' });
export const apiPostFile = (path, file) => apiFetch(path, { method: 'POST', file, fileType: file.type });

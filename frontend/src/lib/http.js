// Thin fetch wrapper for talking to our own backend (not third-party APIs
// directly — see api.js). Always sends cookies (for the session) and, for
// mutating requests, echoes a CSRF token back as a header — the backend's
// double-submit check requires both the cookie (sent automatically by the
// browser) and this header to match.
//
// The token is learned from the x-csrf-token *response* header (captured
// into memory below), not read from the cookie via `document.cookie` — the
// frontend and backend are different hostnames in production, and a cookie
// the backend sets is invisible to frontend-origin JS no matter how it's
// flagged. The backend explicitly exposes this header via CORS for exactly
// this reason (see backend/src/middleware/csrf.js).

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

// `file`/`fileType` bypass the JSON encoding entirely - used for a raw
// binary upload (e.g. the screenshot-search endpoint), which sends a File
// object as-is with its own Content-Type rather than a JSON body.
export async function apiFetch(path, { method = 'GET', body, file, fileType } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  else if (file !== undefined) headers['Content-Type'] = fileType;
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
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

  if (res.status === 204) return null;

  let json = null;
  try { json = await res.json(); } catch { /* empty/non-JSON body */ }

  if (!res.ok) {
    // Excludes `error`/`message`/`status` specifically (not just `error`) so
    // a response body can never clobber Error's own built-in properties.
    const { error: _error, message: _message, status: _status, ...extra } = json || {};
    throw new ApiError(json?.error || `Request failed (${res.status})`, res.status, extra);
  }
  return json;
}

export const apiGet = (path) => apiFetch(path, { method: 'GET' });
export const apiPost = (path, body) => apiFetch(path, { method: 'POST', body: body ?? {} });
export const apiDelete = (path) => apiFetch(path, { method: 'DELETE' });
export const apiPostFile = (path, file) => apiFetch(path, { method: 'POST', file, fileType: file.type });

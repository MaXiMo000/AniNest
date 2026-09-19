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
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const freshToken = res.headers.get('x-csrf-token');
  if (freshToken) csrfToken = freshToken;

  if (res.status === 204) return null;

  let json = null;
  try { json = await res.json(); } catch { /* empty/non-JSON body */ }

  if (!res.ok) {
    throw new ApiError(json?.error || `Request failed (${res.status})`, res.status);
  }
  return json;
}

export const apiGet = (path) => apiFetch(path, { method: 'GET' });
export const apiPost = (path, body) => apiFetch(path, { method: 'POST', body: body ?? {} });
export const apiDelete = (path) => apiFetch(path, { method: 'DELETE' });

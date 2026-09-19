// Thin fetch wrapper for talking to our own backend (not third-party APIs
// directly — see api.js). Always sends cookies (for the session) and, for
// mutating requests, echoes the readable CSRF cookie back as a header —
// the backend's double-submit check requires both to match.

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = getCookie('aninest_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiPost, apiGet, _resetCsrfTokenForTests } from '../src/lib/http.js';

const CSRF_ERROR = 'Invalid or missing CSRF token.';

function response(status, body, token) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('x-csrf-token', token);
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

describe('apiFetch CSRF handling', () => {
  let fetchMock;

  beforeEach(() => {
    _resetCsrfTokenForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fetches a token before the first POST instead of sending none', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { ok: true }, 'tok-1'))
      .mockResolvedValueOnce(response(200, { user: { id: 1 } }, 'tok-1'));

    await apiPost('/api/auth/login', { identifier: 'a', password: 'b' });

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/health$/);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toMatch(/\/api\/auth\/login$/);
    expect(init.headers['x-csrf-token']).toBe('tok-1');
    expect(init.credentials).toBe('include');
  });

  it('reuses the token from an earlier GET without an extra request', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { user: null }, 'tok-me'))
      .mockResolvedValueOnce(response(200, { user: { id: 1 } }, 'tok-me'));

    await apiGet('/api/auth/me');
    await apiPost('/api/auth/login', {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers['x-csrf-token']).toBe('tok-me');
  });

  it('retries once with the fresh token after a CSRF 403', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { user: null }, 'stale'))
      .mockResolvedValueOnce(response(403, { error: CSRF_ERROR }, 'fresh'))
      .mockResolvedValueOnce(response(200, { user: { id: 1 } }, 'fresh'));

    await apiGet('/api/auth/me');
    const result = await apiPost('/api/auth/login', {});

    expect(result).toEqual({ user: { id: 1 } });
    expect(fetchMock.mock.calls[1][1].headers['x-csrf-token']).toBe('stale');
    expect(fetchMock.mock.calls[2][1].headers['x-csrf-token']).toBe('fresh');
  });

  it('does not loop when the cookie can never be stored', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { user: null }, 'a'))
      .mockResolvedValueOnce(response(403, { error: CSRF_ERROR }, 'b'))
      .mockResolvedValueOnce(response(403, { error: CSRF_ERROR }, 'c'));

    await apiGet('/api/auth/me');
    await expect(apiPost('/api/auth/login', {})).rejects.toMatchObject({ status: 403, message: CSRF_ERROR });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry other 403s', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { user: null }, 'a'))
      .mockResolvedValueOnce(response(403, { error: 'Admins only.' }, 'a'));

    await apiGet('/api/auth/me');
    await expect(apiPost('/api/admin/x', {})).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

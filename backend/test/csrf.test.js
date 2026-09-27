// Regression tests for the production login 403 ("Invalid or missing CSRF
// token."). The cause was deployment shape, not the check itself: the
// frontend called aninest-backend.onrender.com directly, so the CSRF cookie
// was a third-party cookie, browsers that block those dropped it, and every
// POST arrived with a header token but no cookie. The fix routes /api/* through
// the frontend's own origin (render.yaml rewrite), so these tests pin both
// the double-submit behavior the frontend relies on and that config.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `aninest-csrf-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.AUTH_RATE_LIMIT = '1000';
process.env.RATE_LIMIT = '1000';
process.env.FRONTEND_ORIGIN = 'https://frontend.test';

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/lib/db.js');

const CSRF_ERROR = 'Invalid or missing CSRF token.';
let server;
let baseUrl;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(process.env.DB_PATH + suffix, { force: true }); } catch { /* best effort */ }
  }
});

function csrfCookie(res) {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('aninest_csrf='));
  return raw?.split(';')[0].split('=')[1];
}

async function login({ cookie, header } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = `aninest_csrf=${cookie}`;
  if (header) headers['x-csrf-token'] = header;
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ identifier: 'nobody@test.local', password: 'wrong-password' }),
  });
  return { res, json: await res.json().catch(() => null) };
}

async function freshToken() {
  const res = await fetch(`${baseUrl}/api/health`);
  return { cookie: csrfCookie(res), header: res.headers.get('x-csrf-token') };
}

test('login with a matching cookie and header passes the CSRF check', async () => {
  const { cookie, header } = await freshToken();
  const { res, json } = await login({ cookie, header });
  // Wrong credentials, so 401 — the point is that it is not the CSRF 403.
  assert.equal(res.status, 401);
  assert.notEqual(json?.error, CSRF_ERROR);
});

test('login with the header but no cookie is rejected (blocked third-party cookie)', async () => {
  const { header } = await freshToken();
  const { res, json } = await login({ header });
  assert.equal(res.status, 403);
  assert.equal(json.error, CSRF_ERROR);
});

test('a client whose cookie never sticks gets a new token every time, so its header never matches', async () => {
  // Exactly what the browser did in production: each response minted a new
  // token because the previous cookie was never stored.
  const first = await freshToken();
  const second = await freshToken();
  assert.notEqual(first.header, second.header);
  const { res } = await login({ cookie: second.cookie, header: first.header });
  assert.equal(res.status, 403);
});

test('login with the cookie but no header is rejected', async () => {
  const { cookie } = await freshToken();
  const { res, json } = await login({ cookie });
  assert.equal(res.status, 403);
  assert.equal(json.error, CSRF_ERROR);
});

test('a CSRF 403 still hands back the current token so the client can retry once', async () => {
  const { cookie } = await freshToken();
  const { res } = await login({ cookie, header: 'stale-token' });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('x-csrf-token'), cookie);
  const retry = await login({ cookie, header: res.headers.get('x-csrf-token') });
  assert.equal(retry.res.status, 401);
});

test('the CSRF cookie is httpOnly and scoped to the whole API', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('aninest_csrf='));
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /Path=\//);
});

test('CORS exposes the token header to the allowed origin only', async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://frontend.test' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://frontend.test');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  assert.match(allowed.headers.get('access-control-expose-headers') || '', /x-csrf-token/i);

  const evil = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://evil.test' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('CORS preflight allows the x-csrf-token request header', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://frontend.test',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token',
    },
  });
  assert.ok(res.status === 204 || res.status === 200);
  assert.match(res.headers.get('access-control-allow-headers') || '', /x-csrf-token/i);
});

// Deployment guard: the production frontend must call the API on its own
// origin and proxy /api/* to the backend, or the cookies become third-party
// again and logins 403 in any browser that blocks those.
test('render.yaml keeps the API same-origin with the frontend', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const yaml = fs.readFileSync(path.join(here, '..', '..', 'render.yaml'), 'utf8');

  const frontendBlock = yaml.slice(yaml.indexOf('- name: aninest-frontend'));
  const backendBlock = yaml.slice(yaml.indexOf('- name: aninest-backend'), yaml.indexOf('- name: aninest-frontend'));

  const apiUrl = frontendBlock.match(/key: VITE_API_URL\s+value:\s*(\S+)/)?.[1];
  const frontendOrigin = backendBlock.match(/key: FRONTEND_ORIGIN\s+value:\s*(\S+)/)?.[1];
  assert.ok(apiUrl, 'VITE_API_URL missing from the frontend service');
  assert.equal(apiUrl, frontendOrigin, 'VITE_API_URL must be the frontend origin, not the backend URL');

  const rules = [...frontendBlock.matchAll(/type: rewrite\s+source:\s*(\S+)\s+destination:\s*(\S+)/g)]
    .map(([, source, destination]) => ({ source, destination }));
  const apiRule = rules.findIndex((r) => r.source === '/api/*');
  const spaRule = rules.findIndex((r) => r.source === '/*');
  assert.notEqual(apiRule, -1, 'missing /api/* rewrite on the frontend');
  assert.match(rules[apiRule].destination, /^https:\/\/aninest-backend\.onrender\.com\/api\/\*$/);
  assert.ok(spaRule === -1 || apiRule < spaRule, '/api/* rewrite must come before the SPA catch-all');
});

// Integration tests against a real (ephemeral) instance of the Express app,
// using Node's built-in test runner and fetch — no extra test dependencies.
//
// Deliberately NOT covered here: the /api/anime/* proxy routes' actual data.
// Those hit live third-party APIs (Jikan/AniList); asserting on their real
// responses would make this suite flaky and burn shared rate-limit budget on
// every run. We only test the input-validation edge of those routes, which
// doesn't require the upstream call to succeed.
//
// Run with: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `aninest-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-production';
// Many tests below legitimately call /api/auth/* in the same process, all
// sharing one IP-keyed rate-limit bucket (127.0.0.1) — raise the ceiling so
// they don't trip each other's limit. The limiter's actual behavior (does it
// return 429 once exceeded?) is verified separately below with its own
// tightly-scoped limit.
process.env.AUTH_RATE_LIMIT = '1000';

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/lib/db.js');

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  // On Windows, the native libSQL binding can hold its file handle open for
  // a moment after close() returns — deleting the temp DB is disposable
  // best-effort cleanup (the OS temp dir sweeps it eventually regardless),
  // so a lingering lock here shouldn't fail the whole test run.
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(process.env.DB_PATH + suffix, { force: true }); } catch { /* best effort */ }
  }
});

// Minimal cookie jar so requests behave like a real browser session across
// calls (needed for the session cookie + CSRF double-submit cookie).
//
// Deliberately mirrors the frontend's actual mechanism, not the simplest
// thing that would pass: the CSRF token is captured from the x-csrf-token
// *response header* (csrfToken below), not read out of the cookie jar. In
// production, frontend and backend are different hostnames, so frontend JS
// can never read a cookie the backend set (real same-origin-policy
// behavior, not a bug) — the header is the only channel that actually
// works there, so it's the only channel this suite trusts too.
function makeAgent() {
  const jar = new Map();
  let csrfToken = null;

  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function storeCookies(res) {
    const raw = res.headers.getSetCookie?.() || [];
    for (const cookieStr of raw) {
      const [pair] = cookieStr.split(';');
      const eq = pair.indexOf('=');
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const headerToken = res.headers.get('x-csrf-token');
    if (headerToken) csrfToken = headerToken;
  }

  async function request(method, path, { body, headers = {}, csrf = false } = {}) {
    const finalHeaders = { ...headers };
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    if (cookieHeader()) finalHeaders.Cookie = cookieHeader();
    if (csrf) finalHeaders['x-csrf-token'] = csrfToken || '';

    const res = await fetch(baseUrl + path, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    storeCookies(res);
    let json = null;
    try { json = await res.json(); } catch { /* no/invalid JSON body */ }
    return { status: res.status, json, headers: res.headers };
  }

  return {
    get: (p, opts) => request('GET', p, opts),
    post: (p, opts) => request('POST', p, opts),
    delete: (p, opts) => request('DELETE', p, opts),
    jar,
    getCsrfToken: () => csrfToken,
  };
}

let uniqueSuffix = 0;
function uniqueUser() {
  uniqueSuffix += 1;
  const n = `${Date.now()}${uniqueSuffix}`.slice(-10);
  return { username: `u${n}`, email: `u${n}@test.local`, password: 'correcthorse123' };
}

test('health check', async () => {
  const agent = makeAgent();
  const res = await agent.get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test('GET sets a CSRF cookie and exposes the matching token via response header', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  assert.ok(agent.jar.get('aninest_csrf'), 'expected aninest_csrf cookie to be set');
  // These must be the same token — the frontend only ever sees the header
  // (the cookie is httpOnly and, in production, a different hostname's
  // cookie besides), and the server's later check compares against the
  // cookie, so a mismatch here would silently break every mutating request.
  assert.equal(agent.getCsrfToken(), agent.jar.get('aninest_csrf'));
});

test('mutating request without CSRF header is rejected', async () => {
  const agent = makeAgent();
  await agent.get('/api/health'); // picks up the CSRF cookie, but we won't send it back
  const user = uniqueUser();
  const res = await agent.post('/api/auth/register', { body: user }); // csrf: false
  assert.equal(res.status, 403);
});

test('mutating request with a WRONG CSRF header is rejected', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  const res = await agent.post('/api/auth/register', { body: user, headers: { 'x-csrf-token': 'not-the-real-token' } });
  assert.equal(res.status, 403);
});

test('registration rejects a weak password', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const res = await agent.post('/api/auth/register', {
    csrf: true,
    body: { username: 'weakpwuser', email: 'weak@test.local', password: 'alllowercase' }, // no digit
  });
  assert.equal(res.status, 400);
});

test('registration rejects an invalid email', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const res = await agent.post('/api/auth/register', {
    csrf: true,
    body: { username: 'bademailuser', email: 'not-an-email', password: 'correcthorse123' },
  });
  assert.equal(res.status, 400);
});

test('registration rejects a username with invalid characters', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const res = await agent.post('/api/auth/register', {
    csrf: true,
    body: { username: '<script>x</script>', email: 'xss@test.local', password: 'correcthorse123' },
  });
  assert.equal(res.status, 400);
});

test('full auth lifecycle: register -> me -> logout -> me -> login -> me', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();

  const reg = await agent.post('/api/auth/register', { csrf: true, body: user });
  assert.equal(reg.status, 201);
  assert.equal(reg.json.user.username, user.username);
  assert.equal(reg.json.user.password_hash, undefined, 'password hash must never be returned');

  const me1 = await agent.get('/api/auth/me');
  assert.equal(me1.json.user.username, user.username);

  const logout = await agent.post('/api/auth/logout', { csrf: true });
  assert.equal(logout.status, 204);

  const me2 = await agent.get('/api/auth/me');
  assert.equal(me2.json.user, null);

  const login = await agent.post('/api/auth/login', { csrf: true, body: { identifier: user.email, password: user.password } });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.username, user.username);

  const me3 = await agent.get('/api/auth/me');
  assert.equal(me3.json.user.username, user.username);
});

test('duplicate registration is rejected', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  const first = await agent.post('/api/auth/register', { csrf: true, body: user });
  assert.equal(first.status, 201);

  const agent2 = makeAgent();
  await agent2.get('/api/health');
  const second = await agent2.post('/api/auth/register', { csrf: true, body: user });
  assert.equal(second.status, 409);
});

test('login gives the same generic error for a wrong password and a nonexistent user', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const wrongPassword = await agent.post('/api/auth/login', { csrf: true, body: { identifier: user.email, password: 'wrongpassword1' } });
  const noSuchUser = await agent.post('/api/auth/login', { csrf: true, body: { identifier: 'nobody-here@test.local', password: 'wrongpassword1' } });

  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(wrongPassword.json.error, noSuchUser.json.error, 'error message must not leak whether the account exists');
});

test('favorites routes require auth', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const get = await agent.get('/api/favorites');
  const post = await agent.post('/api/favorites', { csrf: true, body: { mal_id: 1, title: 'x' } });
  const del = await agent.delete('/api/favorites/1', { csrf: true });
  assert.equal(get.status, 401);
  assert.equal(post.status, 401);
  assert.equal(del.status, 401);
});

test('favorites CRUD lifecycle for a logged-in user', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const add = await agent.post('/api/favorites', {
    csrf: true,
    body: { mal_id: 16498, title: 'Attack on Titan', image: 'https://cdn.myanimelist.net/images/anime/10/47347.jpg', score: 8.5, type: 'TV' },
  });
  assert.equal(add.status, 201);

  const list = await agent.get('/api/favorites');
  assert.equal(list.status, 200);
  assert.equal(list.json.favorites.length, 1);
  assert.equal(list.json.favorites[0].title, 'Attack on Titan');

  // Adding the same mal_id again must not create a duplicate row.
  await agent.post('/api/favorites', { csrf: true, body: { mal_id: 16498, title: 'Attack on Titan' } });
  const listAgain = await agent.get('/api/favorites');
  assert.equal(listAgain.json.favorites.length, 1);

  const del = await agent.delete('/api/favorites/16498', { csrf: true });
  assert.equal(del.status, 204);
  const listAfterDelete = await agent.get('/api/favorites');
  assert.equal(listAfterDelete.json.favorites.length, 0);
});

test('favorites rejects a javascript: URL for the image field', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const res = await agent.post('/api/favorites', {
    csrf: true,
    body: { mal_id: 999, title: 'Malicious', image: 'javascript:alert(1)' },
  });
  assert.equal(res.status, 400);
});

test('favorites normalizes a URL that contains a raw quote instead of storing it verbatim', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const maliciousUrl = 'http://evil.example/"onerror="alert(1)';
  const add = await agent.post('/api/favorites', { csrf: true, body: { mal_id: 42, title: 'Test', image: maliciousUrl } });
  assert.equal(add.status, 201);

  const list = await agent.get('/api/favorites');
  const stored = list.json.favorites[0].image;
  assert.ok(!stored.includes('"'), `stored image URL must not contain a raw quote, got: ${stored}`);
});

test('anime routes validate the id param without needing the upstream API', async () => {
  const agent = makeAgent();
  const res = await agent.get('/api/anime/not-a-number/full');
  assert.equal(res.status, 400);
});

// This process's authLimiter was created with AUTH_RATE_LIMIT=1000 (see top
// of file) so the many other tests above don't trip each other's shared
// 127.0.0.1 bucket. That means we can't cheaply prove "the 11th request
// gets a 429" here without a second, isolated process — express-rate-limit
// itself is a well-tested library; what we actually need to verify is that
// *our app* wires it up correctly. The RateLimit-* headers decrementing on
// every request is exactly that proof, without disrupting every other test.
test('auth endpoints report a decrementing rate-limit budget', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const attempt = () => agent.post('/api/auth/login', { csrf: true, body: { identifier: 'nobody@test.local', password: 'wrong' } });

  const first = await attempt();
  const second = await attempt();
  const remaining1 = Number(first.headers.get('ratelimit-remaining'));
  const remaining2 = Number(second.headers.get('ratelimit-remaining'));

  assert.ok(Number.isFinite(remaining1), 'expected a RateLimit-Remaining header');
  assert.equal(remaining2, remaining1 - 1, 'remaining budget should decrement by exactly 1 per request');
});

// A real end-to-end 429 check. This mounts a fresh express-rate-limit
// instance (same library, same config shape as rateLimits.js) at a tiny
// limit on a throwaway route of its own tiny app/server, instead of reusing
// the shared authLimiter singleton — that singleton is already locked in at
// AUTH_RATE_LIMIT=1000 for this process and can't be reconfigured at
// runtime, and lowering it would just reintroduce the cross-test pollution
// this file works around above.
test('express-rate-limit actually returns 429 once its limit is exceeded', async () => {
  const [{ default: express }, { default: rateLimit }] = await Promise.all([
    import('express'),
    import('express-rate-limit'),
  ]);
  const probeApp = express();
  probeApp.use(rateLimit({ windowMs: 60_000, limit: 3, standardHeaders: true, legacyHeaders: false }));
  probeApp.get('/probe', (_req, res) => res.json({ ok: true }));

  const probeServer = await new Promise((resolve) => {
    const s = probeApp.listen(0, () => resolve(s));
  });
  try {
    const probeUrl = `http://127.0.0.1:${probeServer.address().port}/probe`;
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(probeUrl);
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  } finally {
    await new Promise((resolve) => probeServer.close(resolve));
  }
});

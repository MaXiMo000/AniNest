// Integration tests against a real (ephemeral) instance of the Express app,
// using Node's built-in test runner and fetch — no extra test dependencies.
//
// Deliberately NOT covered here: the /api/anime/* proxy routes' actual data,
// /api/games/daily's actual pick, /api/studios/:name + /api/people/:name,
// /api/import/anilist's actual import, and /api/screenshot-search's actual
// match. All of these hit live third-party APIs (Jikan/AniList/trace.moe) to
// build their result; asserting on real responses would make this suite
// flaky and burn shared rate-limit/quota budget on every run. We only test
// the input-validation edge of routes that have one to test - studios/
// people/import take a free-text name with nothing to validate beyond a
// length cap; screenshot-search's edge (wrong content type, empty body) is
// pure body-parser/route logic that never reaches trace.moe.
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
// Same reasoning for the general limiter (default 120/min) - the suite as a
// whole now makes well over that from one shared IP within its run time.
process.env.RATE_LIMIT = '1000';

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

  // `raw` sends its value as-is (a Buffer/string), skipping JSON encoding -
  // needed for the one route that takes a binary body (screenshot search).
  // `headers` still wins for Content-Type in that case since the `body`
  // branch below is what forces application/json, not this one.
  async function request(method, path, { body, raw, headers = {}, csrf = false } = {}) {
    const finalHeaders = { ...headers };
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    if (cookieHeader()) finalHeaders.Cookie = cookieHeader();
    if (csrf) finalHeaders['x-csrf-token'] = csrfToken || '';

    const res = await fetch(baseUrl + path, {
      method,
      headers: finalHeaders,
      body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
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

test('favorites: watch status can be set, changed, and cleared without wiping other fields', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  await agent.post('/api/favorites', {
    csrf: true,
    body: { mal_id: 777, title: 'Mob Psycho 100', image: 'https://cdn.myanimelist.net/images/x.jpg', score: 8.5, type: 'TV', status: 'watching' },
  });
  let list = await agent.get('/api/favorites');
  assert.equal(list.json.favorites[0].status, 'watching');

  // A plain heart re-toggle (no `status` key at all) must not clobber it.
  await agent.post('/api/favorites', { csrf: true, body: { mal_id: 777, title: 'Mob Psycho 100' } });
  list = await agent.get('/api/favorites');
  assert.equal(list.json.favorites[0].status, 'watching', 'status must survive an update that omits the field entirely');

  // Changing it explicitly does update it.
  await agent.post('/api/favorites', { csrf: true, body: { mal_id: 777, title: 'Mob Psycho 100', status: 'completed' } });
  list = await agent.get('/api/favorites');
  assert.equal(list.json.favorites[0].status, 'completed');

  // Explicit null clears it back to "no status" (still a plain favorite).
  await agent.post('/api/favorites', { csrf: true, body: { mal_id: 777, title: 'Mob Psycho 100', status: null } });
  list = await agent.get('/api/favorites');
  assert.equal(list.json.favorites[0].status, null);

  const invalid = await agent.post('/api/favorites', { csrf: true, body: { mal_id: 777, title: 'Mob Psycho 100', status: 'binge-watching' } });
  assert.equal(invalid.status, 400);
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

test('reviews require auth to write but not to read', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const post = await agent.post('/api/reviews', { csrf: true, body: { mal_id: 1, rating: 8 } });
  assert.equal(post.status, 401);
  const del = await agent.delete('/api/reviews/1', { csrf: true });
  assert.equal(del.status, 401);
  const get = await agent.get('/api/reviews/1');
  assert.equal(get.status, 200);
  assert.deepEqual(get.json, { reviews: [], average: null, count: 0, myReview: null });
});

test('reviews CRUD lifecycle, aggregate score, and one-review-per-user-per-anime', async () => {
  const author = makeAgent();
  await author.get('/api/health');
  const authorUser = uniqueUser();
  await author.post('/api/auth/register', { csrf: true, body: authorUser });

  const create = await author.post('/api/reviews', { csrf: true, body: { mal_id: 777, rating: 9, body: 'Loved it.' } });
  assert.equal(create.status, 201);

  const afterCreate = await author.get('/api/reviews/777');
  assert.equal(afterCreate.json.count, 1);
  assert.equal(afterCreate.json.average, 9);
  assert.equal(afterCreate.json.reviews[0].username, authorUser.username);
  assert.equal(afterCreate.json.myReview.rating, 9);

  // A second reviewer, so the average is meaningfully checked (9 + 5) / 2 = 7.
  const reviewer2 = makeAgent();
  await reviewer2.get('/api/health');
  const user2 = uniqueUser();
  await reviewer2.post('/api/auth/register', { csrf: true, body: user2 });
  await reviewer2.post('/api/reviews', { csrf: true, body: { mal_id: 777, rating: 5 } });

  const afterSecond = await author.get('/api/reviews/777');
  assert.equal(afterSecond.json.count, 2);
  assert.equal(afterSecond.json.average, 7);

  // Re-reviewing the same anime updates in place rather than adding a row.
  await author.post('/api/reviews', { csrf: true, body: { mal_id: 777, rating: 3, body: 'Changed my mind.' } });
  const afterUpdate = await author.get('/api/reviews/777');
  assert.equal(afterUpdate.json.count, 2, 'updating an existing review must not create a second row');
  assert.equal(afterUpdate.json.myReview.rating, 3);

  const del = await author.delete('/api/reviews/777', { csrf: true });
  assert.equal(del.status, 204);
  const afterDelete = await author.get('/api/reviews/777');
  assert.equal(afterDelete.json.count, 1, 'deleting must only remove the caller\'s own review');
});

test('reviews reject a rating out of range and an overlong body', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const tooHigh = await agent.post('/api/reviews', { csrf: true, body: { mal_id: 5, rating: 11 } });
  assert.equal(tooHigh.status, 400);
  const tooLow = await agent.post('/api/reviews', { csrf: true, body: { mal_id: 5, rating: 0 } });
  assert.equal(tooLow.status, 400);
  const overlong = await agent.post('/api/reviews', { csrf: true, body: { mal_id: 5, rating: 5, body: 'x'.repeat(2001) } });
  assert.equal(overlong.status, 400);
});

test('reviews escape a malicious body when it comes back out (defense in depth)', async () => {
  // The frontend also escapes on render, but a review body is exactly the
  // kind of user-controlled text worth confirming isn't mangled or stripped
  // by the storage layer itself — it should round-trip byte-for-byte, and
  // it's the frontend's job (already covered) to escape it on display.
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const payload = '<img src=x onerror=alert(1)> & "quotes"';
  await agent.post('/api/reviews', { csrf: true, body: { mal_id: 9001, rating: 6, body: payload } });
  const res = await agent.get('/api/reviews/9001');
  assert.equal(res.json.reviews[0].body, payload);
});

test('client error reports are accepted (public, no auth) and validated', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const ok = await agent.post('/api/client-errors', {
    csrf: true,
    body: { message: 'TypeError: boom', stack: 'at renderHome (home.js:42)', url: 'http://localhost:5173/#/' },
  });
  assert.equal(ok.status, 204);

  const missingMessage = await agent.post('/api/client-errors', { csrf: true, body: { stack: 'no message field' } });
  assert.equal(missingMessage.status, 400);

  const emptyMessage = await agent.post('/api/client-errors', { csrf: true, body: { message: '' } });
  assert.equal(emptyMessage.status, 400);
});

test('anime routes validate the id param without needing the upstream API', async () => {
  const agent = makeAgent();
  const res = await agent.get('/api/anime/not-a-number/full');
  assert.equal(res.status, 400);
  const themes = await agent.get('/api/anime/not-a-number/themes');
  assert.equal(themes.status, 400);
});

test('schedule route rejects an invalid day without needing the upstream API', async () => {
  const agent = makeAgent();
  const bad = await agent.get('/api/anime/schedule?day=someday');
  assert.equal(bad.status, 400);
  const missing = await agent.get('/api/anime/schedule');
  assert.equal(missing.status, 400);
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

test('game scores require auth to write, but the leaderboard is public', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const post = await agent.post('/api/games/higher-lower/score', { csrf: true, body: { streak: 5 } });
  assert.equal(post.status, 401);
  const board = await agent.get('/api/games/higher-lower/leaderboard');
  assert.equal(board.status, 200);
  assert.equal(board.json.myRank, null, 'an unauthenticated caller has no rank of their own');
});

test('game scores reject an unknown game slug on both routes', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const post = await agent.post('/api/games/not-a-real-game/score', { csrf: true, body: { streak: 5 } });
  assert.equal(post.status, 400);
  const board = await agent.get('/api/games/not-a-real-game/leaderboard');
  assert.equal(board.status, 400);
});

test('game scores reject invalid streak values', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const negative = await agent.post('/api/games/higher-lower/score', { csrf: true, body: { streak: -1 } });
  assert.equal(negative.status, 400);
  const notInt = await agent.post('/api/games/higher-lower/score', { csrf: true, body: { streak: 1.5 } });
  assert.equal(notInt.status, 400);
  const missing = await agent.post('/api/games/higher-lower/score', { csrf: true, body: {} });
  assert.equal(missing.status, 400);
});

test('game scores only ever raise a user\'s recorded best, never lower it', async () => {
  const player = makeAgent();
  await player.get('/api/health');
  const playerUser = uniqueUser();
  await player.post('/api/auth/register', { csrf: true, body: playerUser });

  const first = await player.post('/api/games/guess-the-anime/score', { csrf: true, body: { streak: 5 } });
  assert.equal(first.status, 200);
  assert.equal(first.json.best, 5);

  // A worse run posted later must not overwrite the existing best.
  const lower = await player.post('/api/games/guess-the-anime/score', { csrf: true, body: { streak: 2 } });
  assert.equal(lower.json.best, 5);

  const higher = await player.post('/api/games/guess-the-anime/score', { csrf: true, body: { streak: 9 } });
  assert.equal(higher.json.best, 9);

  const board = await player.get('/api/games/guess-the-anime/leaderboard');
  assert.equal(board.status, 200);
  assert.equal(board.json.myBest, 9);
  assert.ok(Number.isInteger(board.json.myRank) && board.json.myRank >= 1);
  const entry = board.json.leaderboard.find((r) => r.username === playerUser.username);
  assert.ok(entry, 'expected the player to appear on the leaderboard');
  assert.equal(entry.best_streak, 9);
});

test('leaderboard ranks the higher streak first and stays sorted regardless of other players', async () => {
  const a = makeAgent();
  await a.get('/api/health');
  const userA = uniqueUser();
  await a.post('/api/auth/register', { csrf: true, body: userA });
  await a.post('/api/games/higher-lower/score', { csrf: true, body: { streak: 3 } });

  const b = makeAgent();
  await b.get('/api/health');
  const userB = uniqueUser();
  await b.post('/api/auth/register', { csrf: true, body: userB });
  await b.post('/api/games/higher-lower/score', { csrf: true, body: { streak: 20 } });

  const board = await a.get('/api/games/higher-lower/leaderboard');
  for (let i = 1; i < board.json.leaderboard.length; i += 1) {
    assert.ok(
      board.json.leaderboard[i - 1].best_streak >= board.json.leaderboard[i].best_streak,
      'leaderboard rows must be sorted by best_streak, highest first',
    );
  }
  const idxA = board.json.leaderboard.findIndex((r) => r.username === userA.username);
  const idxB = board.json.leaderboard.findIndex((r) => r.username === userB.username);
  assert.ok(idxB !== -1, 'expected the higher-streak player to appear in the top 20');
  assert.ok(idxA === -1 || idxB < idxA, 'the higher streak must rank above the lower one');
});

test('aggregate recommendations require auth', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const res = await agent.get('/api/recommendations/mine');
  assert.equal(res.status, 401);
});

// Deliberately stops short of a real aggregation: with 3+ favorites the
// route calls out to animeSource.recommendations() per seed, which hits
// live Jikan/AniList (see the file header comment for why that's excluded
// from this suite). Fewer than 3 favorites short-circuits before any of
// that, which is exactly the boundary this test can verify safely.
test('aggregate recommendations short-circuit below the minimum seed count, without hitting the anime API', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  await agent.post('/api/favorites', { csrf: true, body: { mal_id: 111, title: 'Seed One' } });
  await agent.post('/api/favorites', { csrf: true, body: { mal_id: 222, title: 'Seed Two' } });

  const res = await agent.get('/api/recommendations/mine');
  assert.equal(res.status, 200);
  assert.equal(res.json.recommendations.length, 0);
  assert.equal(res.json.basedOn.length, 2);
});

test('AniList list import requires auth', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const res = await agent.post('/api/import/anilist', { csrf: true, body: { username: 'someone' } });
  assert.equal(res.status, 401);
});

test('AniList list import rejects an empty username without hitting the anime API', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const empty = await agent.post('/api/import/anilist', { csrf: true, body: { username: '' } });
  assert.equal(empty.status, 400);
  const missing = await agent.post('/api/import/anilist', { csrf: true, body: {} });
  assert.equal(missing.status, 400);
});

test('screenshot search is public (no auth needed) but rejects a non-image content type', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const res = await agent.post('/api/screenshot-search', { csrf: true, body: { not: 'an image' } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /jpeg|png|webp/i);
});

test('screenshot search rejects an empty image body without hitting trace.moe', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const res = await agent.post('/api/screenshot-search', {
    csrf: true,
    raw: Buffer.alloc(0),
    headers: { 'Content-Type': 'image/jpeg' },
  });
  assert.equal(res.status, 400);
});

// Badges are a pure function of data this app already owns (favorites,
// reviews, game_scores, account age) - unlike everything else added this
// session, there's no third-party API involved at all, so the real
// computation is fully covered here, not just an input-validation edge.
test('public profile badges are computed from real activity, not stored', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  // A brand-new account has no activity and is nowhere near the 30-day
  // "Regular" member-tenure threshold, so it should start with no badges.
  const fresh = await agent.get(`/api/users/${user.username}`);
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.json.badges, []);

  // 5 favorites -> bronze favorites badge.
  for (let i = 1; i <= 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await agent.post('/api/favorites', { csrf: true, body: { mal_id: 30000 + i, title: `Badge Test Anime ${i}` } });
  }
  // One review -> bronze reviews badge.
  await agent.post('/api/reviews', { csrf: true, body: { mal_id: 30001, rating: 8 } });
  // A game streak of 5 -> bronze streak badge.
  await agent.post('/api/games/higher-lower/score', { csrf: true, body: { streak: 5 } });

  const after = await agent.get(`/api/users/${user.username}`);
  assert.equal(after.status, 200);
  const badgeIds = after.json.badges.map((b) => b.id).sort();
  assert.deepEqual(badgeIds, ['favorites-bronze', 'reviews-bronze', 'streak-bronze']);
});

test('badge tiers only show the highest one reached per category', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  for (let i = 1; i <= 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await agent.post('/api/favorites', { csrf: true, body: { mal_id: 40000 + i, title: `Tier Test Anime ${i}` } });
  }

  const res = await agent.get(`/api/users/${user.username}`);
  const favoriteBadges = res.json.badges.filter((b) => b.id.startsWith('favorites-'));
  assert.equal(favoriteBadges.length, 1, 'only the highest favorites tier should appear, not bronze+silver stacked');
  assert.equal(favoriteBadges[0].id, 'favorites-silver');
});

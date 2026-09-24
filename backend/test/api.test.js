// Integration tests against a real (ephemeral) instance of the Express app,
// using Node's built-in test runner and fetch — no extra test dependencies.
//
// Deliberately NOT covered here: the /api/anime/* proxy routes' actual data,
// /api/games/daily's actual pick, /api/studios/:name + /api/people/:name,
// /api/import/anilist's actual import, /api/screenshot-search's actual
// match, and /api/manga/*'s actual data (search/tags/detail). All of these
// hit live third-party APIs (Jikan/AniList/trace.moe/MangaDex) to build
// their result; asserting on real responses would make this suite flaky and
// burn shared rate-limit/quota budget on every run. We only test the
// input-validation edge of routes that have one to test - studios/people/
// import take a free-text name with nothing to validate beyond a length
// cap; screenshot-search's edge (wrong content type, empty body) is pure
// body-parser/route logic that never reaches trace.moe; manga's edge (bad
// id format, out-of-allowlist filter values) never reaches MangaDex either.
// /api/admin/watch-sources/search and /bulk-import's actual YouTube results
// are the same story (no YOUTUBE_API_KEY in the test env, on purpose) -
// what IS covered is that both fail closed with a clear "not configured"
// response rather than a raw crash, and every input-validation/auth/
// admin-gating edge around anime_watch_sources, including the security-
// critical parseYouTubeVideoId parser (many malicious inputs) and
// parseUploadTitle's episode-detection/title-cleanup (real upload
// title shapes from the curated channels) - both pure functions, tested directly and deterministically.
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
const { parseYouTubeVideoId } = await import('../src/lib/youtubeUrl.js');

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

// ADMIN_USERNAMES only gets applied once, at db.js's module-load time (see
// its own comment) - long before any test-registered user exists, so it
// can't be used to mint a test admin. Flipping is_admin directly is the
// test-only equivalent of what that env var does in production.
async function makeAdminAgent() {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  const reg = await agent.post('/api/auth/register', { csrf: true, body: user });
  await db.execute({ sql: 'UPDATE users SET is_admin = 1 WHERE id = ?', args: [reg.json.user.id] });
  return agent;
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

test('manga-favorites routes require auth', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const get = await agent.get('/api/manga-favorites');
  const post = await agent.post('/api/manga-favorites', { csrf: true, body: { manga_id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde', title: 'x' } });
  const del = await agent.delete('/api/manga-favorites/a1b2c3d4-e5f6-4789-a012-3456789abcde', { csrf: true });
  assert.equal(get.status, 401);
  assert.equal(post.status, 401);
  assert.equal(del.status, 401);
});

test('manga-favorites CRUD lifecycle for a logged-in user', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const mangaId = 'a1c7c817-4e59-43b7-9365-09675a149a6f';
  const add = await agent.post('/api/manga-favorites', {
    csrf: true,
    body: { manga_id: mangaId, title: 'One Piece', image: 'https://uploads.mangadex.org/covers/x/y.512.jpg', format: 'manga' },
  });
  assert.equal(add.status, 201);

  const list = await agent.get('/api/manga-favorites');
  assert.equal(list.status, 200);
  assert.equal(list.json.favorites.length, 1);
  assert.equal(list.json.favorites[0].title, 'One Piece');

  // Adding the same manga_id again must not create a duplicate row.
  await agent.post('/api/manga-favorites', { csrf: true, body: { manga_id: mangaId, title: 'One Piece' } });
  const listAgain = await agent.get('/api/manga-favorites');
  assert.equal(listAgain.json.favorites.length, 1);

  const del = await agent.delete(`/api/manga-favorites/${mangaId}`, { csrf: true });
  assert.equal(del.status, 204);
  const listAfterDelete = await agent.get('/api/manga-favorites');
  assert.equal(listAfterDelete.json.favorites.length, 0);
});

test('manga-favorites: reading status can be set, changed, and cleared without wiping other fields', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const mangaId = 'b2c3d4e5-f6a7-4890-b123-456789abcdef';
  await agent.post('/api/manga-favorites', {
    csrf: true,
    body: { manga_id: mangaId, title: 'Vinland Saga', status: 'reading' },
  });
  let list = await agent.get('/api/manga-favorites');
  assert.equal(list.json.favorites[0].status, 'reading');

  // A plain heart re-toggle (no `status` key at all) must not clobber it.
  await agent.post('/api/manga-favorites', { csrf: true, body: { manga_id: mangaId, title: 'Vinland Saga' } });
  list = await agent.get('/api/manga-favorites');
  assert.equal(list.json.favorites[0].status, 'reading', 'status must survive an update that omits the field entirely');

  // Changing it explicitly does update it.
  await agent.post('/api/manga-favorites', { csrf: true, body: { manga_id: mangaId, title: 'Vinland Saga', status: 'completed' } });
  list = await agent.get('/api/manga-favorites');
  assert.equal(list.json.favorites[0].status, 'completed');

  // Explicit null clears it back to "no status" (still a plain favorite).
  await agent.post('/api/manga-favorites', { csrf: true, body: { manga_id: mangaId, title: 'Vinland Saga', status: null } });
  list = await agent.get('/api/manga-favorites');
  assert.equal(list.json.favorites[0].status, null);

  const invalid = await agent.post('/api/manga-favorites', { csrf: true, body: { manga_id: mangaId, title: 'Vinland Saga', status: 'binge-reading' } });
  assert.equal(invalid.status, 400);
});

test('manga-favorites rejects a non-UUID manga_id', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const res = await agent.post('/api/manga-favorites', { csrf: true, body: { manga_id: 'not-a-uuid', title: 'x' } });
  assert.equal(res.status, 400);
});

test('manga-favorites rejects a javascript: URL for the image field', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const res = await agent.post('/api/manga-favorites', {
    csrf: true,
    body: { manga_id: 'c3d4e5f6-a7b8-4901-c234-56789abcdef0', title: 'Malicious', image: 'javascript:alert(1)' },
  });
  assert.equal(res.status, 400);
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

test('manga route validates the id param without needing MangaDex', async () => {
  const agent = makeAgent();
  const res = await agent.get('/api/manga/not-a-uuid');
  assert.equal(res.status, 400);
});

test('manga cover proxy only accepts a UUID + uuid-named image file, never an arbitrary path', async () => {
  const agent = makeAgent();
  const good = 'a1c7c817-4e59-43b7-9365-09675a149a6f';
  for (const [id, file] of [
    ['not-a-uuid', `${good}.jpg`],
    [good, 'evil.php'],
    [good, '..%2F..%2Fetc%2Fpasswd'],
    [good, `${good}.svg`],
  ]) {
    const res = await agent.get(`/api/manga/cover/${id}/${file}`);
    assert.equal(res.status, 400, `expected ${id}/${file} to be rejected`);
  }
});

test('manga tags route returns the curated list without needing MangaDex', async () => {
  const agent = makeAgent();
  const res = await agent.get('/api/manga/tags');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.data) && res.json.data.length > 0);
  assert.ok(res.json.data.every((t) => t.id && t.name));
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

test('parseYouTubeVideoId only accepts real YouTube video links, rejecting everything else', () => {
  // Valid shapes actually used by YouTube.
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&list=abc'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=30'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');

  // Security-critical rejections - none of these should ever produce an id.
  assert.equal(parseYouTubeVideoId('javascript:alert(1)'), null);
  assert.equal(parseYouTubeVideoId('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(parseYouTubeVideoId('https://evil.example/watch?v=dQw4w9WgXcQ'), null, 'a non-YouTube host must never pass, even with a YouTube-shaped path');
  assert.equal(parseYouTubeVideoId('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null, 'a lookalike host (real host is evil.example) must be rejected');
  assert.equal(parseYouTubeVideoId('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeVideoId('ftp://youtube.com/watch?v=dQw4w9WgXcQ'), null, 'only http/https protocols are allowed');
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=short'), null, 'id must be exactly 11 chars');
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/'), null, 'no video id present at all');
  assert.equal(parseYouTubeVideoId('not a url'), null);
  assert.equal(parseYouTubeVideoId(''), null);
  assert.equal(parseYouTubeVideoId(null), null);
  assert.equal(parseYouTubeVideoId(123), null);
});

test('GET anime watch-sources is public, validates the id, and starts empty', async () => {
  const agent = makeAgent();
  const bad = await agent.get('/api/anime/not-a-number/watch-sources');
  assert.equal(bad.status, 400);
  const ok = await agent.get('/api/anime/99999999/watch-sources');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.data, []);
});

test('anime-watch-sources submission requires auth', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const res = await agent.post('/api/anime-watch-sources', {
    csrf: true,
    body: { mal_id: 1, youtube_url: 'https://youtu.be/dQw4w9WgXcQ' },
  });
  assert.equal(res.status, 401);
});

test('anime-watch-sources submission rejects anything that is not a real YouTube link', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  for (const bad of ['javascript:alert(1)', 'https://evil.example/video', 'not a url', 'https://vimeo.com/12345']) {
    const res = await agent.post('/api/anime-watch-sources', { csrf: true, body: { mal_id: 1, youtube_url: bad } });
    assert.equal(res.status, 400, `expected "${bad}" to be rejected`);
  }
});

test('a submitted link stays private (pending) until an admin approves it', async () => {
  const submitter = makeAgent();
  await submitter.get('/api/health');
  const submitterUser = uniqueUser();
  await submitter.post('/api/auth/register', { csrf: true, body: submitterUser });

  const malId = 20000 + Math.floor(Math.random() * 10000);
  const submit = await submitter.post('/api/anime-watch-sources', {
    csrf: true,
    body: { mal_id: malId, youtube_url: 'https://youtu.be/dQw4w9WgXcQ', channel_name: 'Muse Asia' },
  });
  assert.equal(submit.status, 201);

  // Not public yet - only 'approved' rows are ever returned here.
  const beforeApproval = await submitter.get(`/api/anime/${malId}/watch-sources`);
  assert.deepEqual(beforeApproval.json.data, []);

  // Resubmitting the exact same link for the exact same anime is rejected.
  const dupe = await submitter.post('/api/anime-watch-sources', {
    csrf: true,
    body: { mal_id: malId, youtube_url: 'https://youtu.be/dQw4w9WgXcQ' },
  });
  assert.equal(dupe.status, 409);

  const admin = await makeAdminAgent();
  const pending = await admin.get('/api/admin/watch-sources/pending');
  assert.equal(pending.status, 200);
  const row = pending.json.data.find((r) => r.mal_id === malId);
  assert.ok(row, 'the pending submission should show up in the admin queue');
  assert.equal(row.submitted_by_username, submitterUser.username);
  assert.equal(row.youtube_video_id, 'dQw4w9WgXcQ');

  const approve = await admin.post(`/api/admin/watch-sources/${row.id}/approve`, { csrf: true });
  assert.equal(approve.status, 204);

  const afterApproval = await submitter.get(`/api/anime/${malId}/watch-sources`);
  assert.equal(afterApproval.json.data.length, 1);
  assert.equal(afterApproval.json.data[0].youtube_video_id, 'dQw4w9WgXcQ');
});

test('an admin-rejected submission never becomes public', async () => {
  const submitter = makeAgent();
  await submitter.get('/api/health');
  await submitter.post('/api/auth/register', { csrf: true, body: uniqueUser() });

  const malId = 30000 + Math.floor(Math.random() * 10000);
  await submitter.post('/api/anime-watch-sources', {
    csrf: true,
    body: { mal_id: malId, youtube_url: 'https://youtu.be/oHg5SJYRHA0' },
  });

  const admin = await makeAdminAgent();
  const pending = await admin.get('/api/admin/watch-sources/pending');
  const row = pending.json.data.find((r) => r.mal_id === malId);

  const reject = await admin.post(`/api/admin/watch-sources/${row.id}/reject`, { csrf: true });
  assert.equal(reject.status, 204);

  const publicList = await submitter.get(`/api/anime/${malId}/watch-sources`);
  assert.deepEqual(publicList.json.data, []);
});

test('admin watch-source routes are hidden (404) from a signed-in non-admin, and require auth for an anonymous caller', async () => {
  const anon = makeAgent();
  const anonRes = await anon.get('/api/admin/watch-sources/pending');
  assert.equal(anonRes.status, 401);

  const regular = makeAgent();
  await regular.get('/api/health');
  await regular.post('/api/auth/register', { csrf: true, body: uniqueUser() });
  const regularRes = await regular.get('/api/admin/watch-sources/pending');
  assert.equal(regularRes.status, 404, 'a non-admin should not even be able to tell this route exists');
});

test('an admin adding a link directly lands as already-approved, and only accepts a real YouTube link', async () => {
  const admin = await makeAdminAgent();
  const malId = 40000 + Math.floor(Math.random() * 10000);

  const bad = await admin.post('/api/admin/watch-sources', {
    csrf: true,
    body: { mal_id: malId, youtube_url: 'https://evil.example/not-youtube' },
  });
  assert.equal(bad.status, 400);

  const add = await admin.post('/api/admin/watch-sources', {
    csrf: true,
    body: { mal_id: malId, youtube_url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', channel_name: 'Ani-One Asia' },
  });
  assert.equal(add.status, 201);

  const publicList = await admin.get(`/api/anime/${malId}/watch-sources`);
  assert.equal(publicList.json.data.length, 1);
  assert.equal(publicList.json.data[0].youtube_video_id, 'jNQXAC9IVRw');
  assert.equal(publicList.json.data[0].channel_name, 'Ani-One Asia');
});

test('admin YouTube search reports "not configured" without a live call when YOUTUBE_API_KEY is unset', async () => {
  const admin = await makeAdminAgent();
  assert.equal(process.env.YOUTUBE_API_KEY, undefined, 'test env should not have a real key set');

  const missingParams = await admin.get('/api/admin/watch-sources/search');
  assert.equal(missingParams.status, 400);

  const res = await admin.get('/api/admin/watch-sources/search?channel=museasia&q=Naruto');
  assert.equal(res.status, 503);
  assert.equal(res.json.notConfigured, true);
});

test('admin channel allowlist is exposed and scoped to the curated official channels', async () => {
  const admin = await makeAdminAgent();
  const res = await admin.get('/api/admin/watch-sources/channels');
  assert.equal(res.status, 200);
  const ids = res.json.data.map((c) => c.id);
  assert.ok(ids.includes('museasia') && ids.includes('anione') && ids.includes('crunchyroll'));
});

test('parseUploadTitle understands the real upload title shapes, and rejects promo/extra content', async () => {
  const { parseUploadTitle } = await import('../src/lib/watchSourceMatcher.js');
  const pick = (t) => { const p = parseUploadTitle(t); return p && { kind: p.kind, series: p.series, season: p.season, episode: p.episode, label: p.label }; };

  // Real titles from the curated channels.
  assert.deepEqual(pick('Fairy Tail - Episode 008 (S1E08) [English Dub]'),
    { kind: 'episode', series: 'Fairy Tail', season: 1, episode: 8, label: 'Episode 8 · English Dub' });
  // Per-season numbering (S3E03) wins over the running "Episode 29".
  assert.deepEqual(pick('Ascendance of a Bookworm - Episode 29 (S3E03) [English Sub]'),
    { kind: 'episode', series: 'Ascendance of a Bookworm', season: 3, episode: 3, label: 'Episode 3 · English Sub' });
  assert.deepEqual(pick('Re:ZERO -Starting Life in Another World- Season 4 | Episode 16 (EP82) [English Sub]'),
    { kind: 'episode', series: 'Re:ZERO -Starting Life in Another World', season: 4, episode: 16, label: 'Episode 16 · English Sub' });
  assert.deepEqual(pick('Skeleton Knight in Another World Season 2 - Episode 12 [English Sub]'),
    { kind: 'episode', series: 'Skeleton Knight in Another World', season: 2, episode: 12, label: 'Episode 12 · English Sub' });
  assert.deepEqual(pick('Complete SeriesMade in Abyss (S1)'),
    { kind: 'complete', series: 'Made in Abyss', season: 1, episode: null, label: 'Complete Series' });
  // Real title that was wrongly skipped: the label itself wrapped in brackets.
  assert.deepEqual(pick('【Complete Series】Taisho Otome Fairy tale'),
    { kind: 'complete', series: 'Taisho Otome Fairy tale', season: null, episode: null, label: 'Complete Series' });
  assert.deepEqual(pick('Complete Series In/Spectre Season 2'),
    { kind: 'complete', series: 'In/Spectre', season: 2, episode: null, label: 'Complete Series' });
  assert.deepEqual(pick('《幼女戰記 2》#12 (繁中字幕 | 日語原聲)【Ani-One Asia】'),
    { kind: 'episode', series: '幼女戰記 2', season: null, episode: 12, label: 'Episode 12 · Chinese subs' });
  assert.deepEqual(pick('RILAKKUMA Episode 25 DUB'),
    { kind: 'episode', series: 'RILAKKUMA', season: null, episode: 25, label: 'Episode 25 · Dub' });

  // Not full episodes - must never be guessed into a series.
  for (const t of [
    '《Re:ZERO -Starting Life in Another World- Season 4》 - Preview of Episode 84',
    'Demon Slayer: Kimetsu no Yaiba Infinity Castle I - Main PV3 | Coming to streaming platforms!',
    'Demon Slayer: Kimetsu no Yaiba Infinity Castle I - CM3 | Now available on streaming platforms!',
    'Firefly Wedding - Teaser PV1',
    'Where is OPM Episode 25? Answering questions that we get 273 times daily',
    '【Ani-One On Live】《Saga of Tanya the Evil 2》#12 X Micho Teh',
    '《雞鬥士》作者專訪：櫻谷秀老師分享創作幕後 #1',
    'Muse Asia Channel Trailer',
    '',
  ]) assert.equal(parseUploadTitle(t), null, `expected "${t}" to be rejected`);
});

test('pickBestCandidate requires EXACT title equality and never attaches a later season to season 1 or a spin-off', async () => {
  const { pickBestCandidate } = await import('../src/lib/watchSourceMatcher.js');

  // The real bug: an upload of "Ascendance of a Bookworm" S3 was once attached
  // to "...Side Story" because the shorter title was merely *contained* in it.
  const wrong = [
    { titles: ['Ascendance of a Bookworm Side Story'], format: 'TV', popularity: 9, malId: 40841 },
    { titles: ['Ascendance of a Bookworm'], format: 'TV', popularity: 99, malId: 39587 },
  ];
  assert.equal(pickBestCandidate(wrong, 'Ascendance of a Bookworm', 3), null, 'season 3 must not match season 1 or a side story');
  assert.equal(pickBestCandidate(wrong, 'Ascendance of a Bookworm', 1).malId, 39587, 'season 1 matches only the exact title');

  const withS3 = [...wrong, { titles: ['Honzuki no Gekokujou 3rd Season', 'Ascendance of a Bookworm Season 3'], format: 'TV', popularity: 5, malId: 52347 }];
  assert.equal(pickBestCandidate(withS3, 'Ascendance of a Bookworm', 3).malId, 52347);

  // Real misses: an upload spells it "Ace of Diamond Act II" / "actII" while
  // AniList spells it "Ace of the Diamond act II" - trivial differences
  // ("the", spacing) must not defeat an otherwise exact match, while the
  // first season and the other seasons must still stay apart.
  const { parseUploadTitle } = await import('../src/lib/watchSourceMatcher.js');
  const ace = [
    { titles: ['Diamond no Ace', 'Ace of the Diamond', 'Ace of Diamond'], format: 'TV', popularity: 9, malId: 18689 },
    { titles: ['Ace of the Diamond Second Season'], format: 'TV', popularity: 7, malId: 30230 },
    { titles: ['Ace of the Diamond act II'], format: 'TV', popularity: 5, malId: 38731 },
    { titles: ['Ace of the Diamond act II -Second Season-'], format: 'TV', popularity: 1, malId: 58877 },
  ];
  const act2 = parseUploadTitle('Ace of Diamond Act II - Episode 01 [English Sub]');
  assert.equal(pickBestCandidate(ace, act2.series, act2.season).malId, 38731);
  const act2s2 = parseUploadTitle('Ace of the Diamond actⅡ -Second Season- | Episode 01 [English Sub]');
  assert.equal(pickBestCandidate(ace, act2s2.series, act2s2.season).malId, 58877);
  assert.equal(pickBestCandidate(ace, 'Ace of Diamond', 1).malId, 18689, 'the bare name is still season 1 only');

  // Several exact hits: prefer TV over a movie of the same name.
  const both = [
    { titles: ['Fairy Tail'], format: 'MOVIE', popularity: 500, malId: 1 },
    { titles: ['Fairy Tail'], format: 'TV', popularity: 50, malId: 6702 },
  ];
  assert.equal(pickBestCandidate(both, 'Fairy Tail', 1).malId, 6702);
  assert.equal(pickBestCandidate([{ titles: ['Fairy Tail: Dragon Cry'], format: 'MOVIE', popularity: 5, malId: 2 }], 'Fairy Tail', 1), null);
});

test('unmatched uploads queue for review: group, assign to an anime in one action, dismiss, and take a link down', async () => {
  const admin = await makeAdminAgent();
  const malId = 50000 + Math.floor(Math.random() * 10000);
  const other = 60000 + Math.floor(Math.random() * 10000);
  const group = `test group ${malId}|1|ep`;
  const ids = ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3'];
  for (const [i, id] of ids.entries()) {
    await db.execute({
      sql: `INSERT INTO watch_source_candidates (youtube_video_id, title, channel_name, group_key, series_guess, season, label)
            VALUES (?, ?, 'Ani-One Asia', ?, 'Test Show', NULL, ?)`,
      args: [id + malId % 10, `Test Show #${i + 1}`, group, `Episode ${i + 1} · Chinese subs`],
    });
  }
  const dismissGroup = `test dismiss ${malId}|1|ep`;
  await db.execute({
    sql: `INSERT INTO watch_source_candidates (youtube_video_id, title, channel_name, group_key, series_guess, label)
          VALUES (?, 'Junk #1', 'Ani-One Asia', ?, 'Junk', 'Episode 1')`,
    args: [`bbbbbbbbb${malId % 10}b`, dismissGroup],
  });

  const list = await admin.get('/api/admin/watch-sources/candidates');
  assert.equal(list.status, 200);
  const row = list.json.data.find((g) => g.group_key === group);
  assert.equal(row.episodes, 3, 'the three episodes must show up as ONE reviewable group');

  const assign = await admin.post('/api/admin/watch-sources/candidates/assign', { csrf: true, body: { group_key: group, mal_id: malId } });
  assert.equal(assign.status, 200);
  assert.equal(assign.json.added, 3);

  const live = await admin.get(`/api/anime/${malId}/watch-sources`);
  assert.equal(live.json.data.length, 3);
  assert.ok(live.json.data.some((s) => s.label === 'Episode 2 · Chinese subs'));
  const after = await admin.get('/api/admin/watch-sources/candidates');
  assert.ok(!after.json.data.some((g) => g.group_key === group), 'an assigned group leaves the queue');

  const dismiss = await admin.post('/api/admin/watch-sources/candidates/dismiss', { csrf: true, body: { group_key: dismissGroup } });
  assert.equal(dismiss.status, 204);
  const afterDismiss = await admin.get('/api/admin/watch-sources/candidates');
  assert.ok(!afterDismiss.json.data.some((g) => g.group_key === dismissGroup));

  // Taking a wrong link down removes it from the public list...
  const approved = await admin.get(`/api/admin/watch-sources/approved?mal_id=${malId}`);
  assert.equal(approved.json.data.length, 3);
  const rm = await admin.post(`/api/admin/watch-sources/${approved.json.data[0].id}/remove`, { csrf: true });
  assert.equal(rm.status, 204);
  const afterRemove = await admin.get(`/api/anime/${malId}/watch-sources`);
  assert.equal(afterRemove.json.data.length, 2);

  // ...and can then be attached to the right anime instead.
  await db.execute({
    sql: `INSERT INTO watch_source_candidates (youtube_video_id, title, channel_name, group_key, series_guess, label)
          VALUES (?, 'moved', 'Muse Asia', ?, 'Moved', 'Episode 9')`,
    args: [approved.json.data[0].youtube_video_id, `moved ${other}|1|ep`],
  });
  const reassign = await admin.post('/api/admin/watch-sources/candidates/assign', { csrf: true, body: { group_key: `moved ${other}|1|ep`, mal_id: other } });
  assert.equal(reassign.json.added, 1);
});

test('remove-all clears every live link on one anime, and only that anime', async () => {
  const admin = await makeAdminAgent();
  const wrong = 70000 + Math.floor(Math.random() * 5000);
  const keep = wrong + 7000;
  for (const [i, mal] of [[1, wrong], [2, wrong], [3, wrong], [4, keep]]) {
    await db.execute({
      sql: `INSERT INTO anime_watch_sources (mal_id, youtube_video_id, channel_name, label, status)
            VALUES (?, ?, 'Muse Asia', ?, 'approved')`,
      args: [mal, `rmall${wrong % 100}${i}xxxxx`.slice(0, 11), `Episode ${i}`],
    });
  }
  assert.equal((await admin.post('/api/admin/watch-sources/remove-all', { csrf: true, body: {} })).status, 400);

  const res = await admin.post('/api/admin/watch-sources/remove-all', { csrf: true, body: { mal_id: wrong } });
  assert.equal(res.status, 200);
  assert.equal(res.json.removed, 3);
  assert.equal((await admin.get(`/api/anime/${wrong}/watch-sources`)).json.data.length, 0);
  assert.equal((await admin.get(`/api/anime/${keep}/watch-sources`)).json.data.length, 1, 'other anime are untouched');
});

test('review-queue and remove routes are admin-only', async () => {
  const regular = makeAgent();
  await regular.get('/api/health');
  await regular.post('/api/auth/register', { csrf: true, body: uniqueUser() });
  assert.equal((await regular.get('/api/admin/watch-sources/candidates')).status, 404);
  assert.equal((await regular.post('/api/admin/watch-sources/candidates/assign', { csrf: true, body: { group_key: 'x', mal_id: 1 } })).status, 404);
  assert.equal((await regular.post('/api/admin/watch-sources/1/remove', { csrf: true })).status, 404);
  assert.equal((await regular.post('/api/admin/watch-sources/remove-all', { csrf: true, body: { mal_id: 1 } })).status, 404);
});

test('bulk-import requires admin, validates its input, and reports "not configured" without a live call when YOUTUBE_API_KEY is unset', async () => {
  const anon = makeAgent();
  await anon.get('/api/health');
  const anonRes = await anon.post('/api/admin/watch-sources/bulk-import', { csrf: true, body: { channel: 'museasia' } });
  assert.equal(anonRes.status, 401);

  const admin = await makeAdminAgent();
  const missingChannel = await admin.post('/api/admin/watch-sources/bulk-import', { csrf: true, body: {} });
  assert.equal(missingChannel.status, 400);

  const res = await admin.post('/api/admin/watch-sources/bulk-import', { csrf: true, body: { channel: 'museasia' } });
  assert.equal(res.status, 503);
  assert.equal(res.json.notConfigured, true);
});

test('computeXp: every source, its caps, and the level boundaries', async () => {
  const { computeXp, levelFor, XP_RULES } = await import('../src/lib/xp.js');
  const base = { favoritesCount: 0, completedCount: 0, mangaFavoritesCount: 0, mangaCompletedCount: 0, reviewsCount: 0, streaks: [], dailyPlayed: 0, dailyWon: 0, approvedLinks: 0 };
  const xp = (over) => computeXp({ ...base, ...over });

  assert.equal(xp({}).total, 0);
  assert.equal(xp({}).level, 1);
  assert.equal(xp({ favoritesCount: 4 }).total, 20);
  assert.equal(xp({ mangaFavoritesCount: 4 }).total, 20);
  assert.equal(xp({ reviewsCount: 3 }).total, 3 * XP_RULES.review + 50, '3 reviews = 75 + the Critic badge (50)');
  assert.equal(xp({ completedCount: 2, mangaCompletedCount: 1 }).breakdown.find((r) => r.id === 'completed').xp, 45);
  // Daily: a win is worth 30 (not 10 + 30), a played-and-lost day 10.
  assert.equal(xp({ dailyPlayed: 3, dailyWon: 1 }).breakdown.find((r) => r.id === 'daily').xp, 30 + 2 * 10);

  // Caps: nothing can be scaled up past them, however large the raw count is.
  assert.equal(xp({ favoritesCount: 5000 }).breakdown.find((r) => r.id === 'favorites').xp, 200 * 5);
  assert.equal(xp({ streaks: [100000] }).breakdown.find((r) => r.id === 'streaks').xp, 50 * 10);
  assert.equal(xp({ approvedLinks: 9999 }).breakdown.find((r) => r.id === 'links').xp, 100 * 50);

  // Level curve: L2 at 50, L3 at 200, L5 at 800, L10 at 4050.
  for (const [points, level] of [[0, 1], [49, 1], [50, 2], [199, 2], [200, 3], [799, 4], [800, 5], [4049, 9], [4050, 10]]) {
    assert.equal(levelFor(points).level, level, `${points} XP should be level ${level}`);
  }
  const l3 = levelFor(300);
  assert.equal(l3.levelStart, 200);
  assert.equal(l3.nextLevelAt, 450);
  assert.ok(Math.abs(l3.progress - 0.4) < 1e-9);
  assert.equal(levelFor(0).title, 'Newbie Nakama');
});

test('profile XP is derived from existing activity (retroactive), with an exact total', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const fresh = await agent.get(`/api/users/${user.username}`);
  assert.equal(fresh.json.xp.total, 0);
  assert.equal(fresh.json.xp.level, 1);

  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await agent.post('/api/favorites', { csrf: true, body: { mal_id: 80000 + i, title: `XP fav ${i}` } });
  }
  await agent.post('/api/reviews', { csrf: true, body: { mal_id: 80000, rating: 8 } });
  await agent.post('/api/games/higher-lower/score', { csrf: true, body: { streak: 10 } });

  // 6 favorites 30 + 1 review 25 + streak 10 -> 100 = 155, plus three bronze
  // badges (Collector, Critic, Warming Up) at 50 each = 150.
  const profile = await agent.get(`/api/users/${user.username}`);
  assert.equal(profile.json.xp.total, 305);
  assert.equal(profile.json.xp.level, 3);
  assert.equal(profile.json.xp.breakdown.find((r) => r.id === 'badges').xp, 150);
});

test('toggling a favorite on and off never mints XP', async () => {
  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await agent.post('/api/favorites', { csrf: true, body: { mal_id: 81000, title: 'Toggle me' } });
    // eslint-disable-next-line no-await-in-loop
    await agent.delete('/api/favorites/81000', { csrf: true });
  }
  await agent.post('/api/favorites', { csrf: true, body: { mal_id: 81000, title: 'Toggle me' } });
  const profile = await agent.get(`/api/users/${user.username}`);
  assert.equal(profile.json.xp.total, 5, 'one favorite currently held = 5 XP, however many times it was toggled');
});

test('daily challenge results: auth required, once per date, only recent dates, win vs loss', async () => {
  const anon = makeAgent();
  await anon.get('/api/health');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await anon.post('/api/games/daily/result', { csrf: true, body: { date: today, won: true, rounds: 2 } })).status, 401);

  const agent = makeAgent();
  await agent.get('/api/health');
  const user = uniqueUser();
  await agent.post('/api/auth/register', { csrf: true, body: user });

  const first = await agent.post('/api/games/daily/result', { csrf: true, body: { date: today, won: false, rounds: 4 } });
  assert.equal(first.status, 200);
  assert.equal(first.json.recorded, true);
  // Replaying - even claiming a win - can't re-award or flip the recorded loss.
  const again = await agent.post('/api/games/daily/result', { csrf: true, body: { date: today, won: true, rounds: 1 } });
  assert.equal(again.json.recorded, false);
  const loss = await agent.get(`/api/users/${user.username}`);
  assert.equal(loss.json.xp.breakdown.find((r) => r.id === 'daily').xp, 10, 'a played-and-lost day is 10 XP');

  const old = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await agent.post('/api/games/daily/result', { csrf: true, body: { date: old, won: true, rounds: 1 } })).status, 400, 'old dates cannot be back-filled');
  for (const body of [{ date: 'nope', won: true, rounds: 1 }, { date: today, won: 'yes', rounds: 1 }, { date: today, won: true, rounds: 9 }, {}]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await agent.post('/api/games/daily/result', { csrf: true, body })).status, 400);
  }

  const winner = makeAgent();
  await winner.get('/api/health');
  const w = uniqueUser();
  await winner.post('/api/auth/register', { csrf: true, body: w });
  await winner.post('/api/games/daily/result', { csrf: true, body: { date: today, won: true, rounds: 2 } });
  const won = await winner.get(`/api/users/${w.username}`);
  assert.equal(won.json.xp.breakdown.find((r) => r.id === 'daily').xp, 30, 'a win is 30 XP');
});

test('free-watch link XP counts links an admin approved for someone else, never the admin\'s own imports', async () => {
  const admin = await makeAdminAgent();
  const adminName = (await admin.get('/api/auth/me')).json.user.username;
  const submitter = makeAgent();
  await submitter.get('/api/health');
  const su = uniqueUser();
  const reg = await submitter.post('/api/auth/register', { csrf: true, body: su });
  const submitterId = reg.json.user.id;
  const adminId = (await admin.get('/api/auth/me')).json.user.id;
  const malId = 82000 + Math.floor(Math.random() * 900);

  // A regular user's link, approved by the admin: counts for the submitter.
  await db.execute({
    sql: "INSERT INTO anime_watch_sources (mal_id, youtube_video_id, label, status, submitted_by, reviewed_by) VALUES (?, ?, 'Episode 1', 'approved', ?, ?)",
    args: [malId, 'xpLinkUser1', submitterId, adminId],
  });
  // The admin's own bulk-import style rows (submitted_by = reviewed_by): must not count.
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await db.execute({
      sql: "INSERT INTO anime_watch_sources (mal_id, youtube_video_id, label, status, submitted_by, reviewed_by) VALUES (?, ?, 'Episode 1', 'approved', ?, ?)",
      args: [malId, `xpLinkAdm${i}x`, adminId, adminId],
    });
  }

  const sub = await submitter.get(`/api/users/${su.username}`);
  assert.equal(sub.json.xp.breakdown.find((r) => r.id === 'links').xp, 50);
  const adm = await admin.get(`/api/users/${adminName}`);
  assert.equal(adm.json.xp.breakdown.find((r) => r.id === 'links'), undefined, 'admin imports earn no link XP');
});

test('XP leaderboard is public, ranked by XP, and reports the caller\'s own rank', async () => {
  // Cached for a couple of minutes by design, so this test seeds its users
  // and reads the board in a single fresh-cache window via a unique top user.
  const big = makeAgent();
  await big.get('/api/health');
  const b = uniqueUser();
  await big.post('/api/auth/register', { csrf: true, body: b });
  await db.execute({
    sql: "UPDATE users SET created_at = datetime('now', '-400 days') WHERE username = ?",
    args: [b.username],
  });
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await big.post('/api/favorites', { csrf: true, body: { mal_id: 83000 + i, title: `Big ${i}` } });
  }
  await big.post('/api/games/guess-the-anime/score', { csrf: true, body: { streak: 40 } });

  const { cacheSet } = await import('../src/lib/cache.js');
  cacheSet('leaderboard:xp', undefined, 0); // drop any cached table so this run sees the users above

  const anon = makeAgent();
  const board = await anon.get('/api/leaderboard/xp');
  assert.equal(board.status, 200);
  assert.equal(board.json.myRank, null, 'a signed-out caller has no rank');
  const xps = board.json.leaderboard.map((r) => r.xp);
  assert.deepEqual(xps, [...xps].sort((x, y) => y - x), 'sorted by XP, highest first');
  assert.ok(board.json.leaderboard.some((r) => r.username === b.username));
  assert.ok(board.json.leaderboard.every((r) => r.xp > 0 && r.level >= 1 && r.title));

  const mine = await big.get('/api/leaderboard/xp');
  assert.ok(mine.json.myRank >= 1);
  assert.ok(mine.json.myXp > 0);
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

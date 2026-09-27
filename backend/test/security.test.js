// Tests for the 2026-09-27 audit fixes: per-visitor rate limits behind the
// Render proxies, account management, case-insensitive usernames, cookie
// flags, per-account login backoff and the smaller hardening items.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `aninest-security-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.AUTH_RATE_LIMIT = '1000';
process.env.RATE_LIMIT = '1000';
// Production shape: the frontend's /api rewrite plus Render's load balancer.
process.env.TRUST_PROXY = '2';
process.env.LOGIN_MAX_FAILURES = '3';

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/lib/db.js');
const { setMailSender } = await import('../src/lib/mailer.js');

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

let clientN = 0;
// Each agent is its own visitor: a distinct client IP in X-Forwarded-For
// (followed by the rewrite proxy's address, as Render sends it), plus its
// own cookie jar.
function makeAgent(ip) {
  clientN += 1;
  const clientIp = ip || `203.0.113.${clientN}`;
  const jar = new Map();
  let csrfToken = null;
  async function request(method, p, { body, csrf = true, headers = {} } = {}) {
    const h = { 'x-forwarded-for': `${clientIp}, 10.0.0.9`, ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (csrf && csrfToken) h['x-csrf-token'] = csrfToken;
    const res = await fetch(baseUrl + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      const value = pair.slice(eq + 1);
      if (value) jar.set(pair.slice(0, eq), value); else jar.delete(pair.slice(0, eq));
    }
    if (res.headers.get('x-csrf-token')) csrfToken = res.headers.get('x-csrf-token');
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  }
  return {
    ip: clientIp,
    jar,
    get: (p, o) => request('GET', p, o),
    post: (p, o) => request('POST', p, o),
    delete: (p, o) => request('DELETE', p, o),
    async ready() { await request('GET', '/api/health'); return this; },
  };
}

let userN = 0;
function newUser() {
  userN += 1;
  const n = `${Date.now()}${userN}`.slice(-9);
  return { username: `s${n}`, email: `s${n}@test.local`, password: 'correcthorse123' };
}

async function registered() {
  const agent = await makeAgent().ready();
  const user = newUser();
  const res = await agent.post('/api/auth/register', { body: user });
  assert.equal(res.status, 201);
  return { agent, user, id: res.json.user.id };
}

test('rate limits key on the visitor behind two proxies, not on the proxy', async () => {
  const a = makeAgent();
  const b = makeAgent();
  const a1 = await a.get('/api/health');
  const a2 = await a.get('/api/health');
  const b1 = await b.get('/api/health');
  const remaining = (r) => Number(r.headers.get('ratelimit-remaining'));
  assert.equal(remaining(a2), remaining(a1) - 1, 'the same visitor spends one budget');
  assert.equal(remaining(b1), remaining(a1), 'a different visitor has a fresh budget');
});

test('change password: needs the current one, then signs out other devices only', async () => {
  const { agent, user } = await registered();
  const other = await makeAgent().ready();
  assert.equal((await other.post('/api/auth/login', { body: { identifier: user.username, password: user.password } })).status, 200);

  const wrong = await agent.post('/api/auth/password', { body: { currentPassword: 'nope', newPassword: 'newhorse456' } });
  assert.equal(wrong.status, 401);
  const weak = await agent.post('/api/auth/password', { body: { currentPassword: user.password, newPassword: 'short' } });
  assert.equal(weak.status, 400);
  const ok = await agent.post('/api/auth/password', { body: { currentPassword: user.password, newPassword: 'newhorse456' } });
  assert.equal(ok.status, 204);

  assert.ok((await agent.get('/api/auth/me')).json.user, 'this device stays signed in');
  assert.equal((await other.get('/api/auth/me')).json.user, null, 'the other device is signed out');
  const fresh = await makeAgent().ready();
  assert.equal((await fresh.post('/api/auth/login', { body: { identifier: user.username, password: user.password } })).status, 401);
  assert.equal((await fresh.post('/api/auth/login', { body: { identifier: user.username, password: 'newhorse456' } })).status, 200);
});

test('log out other devices keeps the current one', async () => {
  const { agent, user } = await registered();
  const other = await makeAgent().ready();
  await other.post('/api/auth/login', { body: { identifier: user.email, password: user.password } });
  assert.equal((await agent.post('/api/auth/logout-others')).status, 204);
  assert.ok((await agent.get('/api/auth/me')).json.user);
  assert.equal((await other.get('/api/auth/me')).json.user, null);
});

test('export returns only the caller\'s own data, without internal ids', async () => {
  const { agent, user } = await registered();
  const someoneElse = await registered();
  await agent.post('/api/favorites', { body: { mal_id: 5114, title: 'FMA:B' } });
  await someoneElse.agent.post('/api/favorites', { body: { mal_id: 1, title: 'Bebop' } });
  const res = await agent.get('/api/auth/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.equal(res.json.account.username, user.username);
  assert.deepEqual(res.json.favorites.map((f) => Number(f.mal_id)), [5114]);
  assert.equal(res.json.favorites[0].user_id, undefined);
  assert.equal((await makeAgent().get('/api/auth/export')).status, 401);
});

test('delete account: needs the password, removes the user and their data', async () => {
  const { agent, user, id } = await registered();
  await agent.post('/api/favorites', { body: { mal_id: 20, title: 'Naruto' } });
  await agent.post('/api/rooms', { body: {} });
  assert.equal((await agent.post('/api/auth/delete-account', { body: { password: 'wrong' } })).status, 401);
  assert.equal((await agent.post('/api/auth/delete-account', { body: { password: user.password } })).status, 204);

  assert.equal((await agent.get('/api/auth/me')).json.user, null);
  for (const table of ['users', 'favorites', 'sessions', 'watch_rooms']) {
    const col = table === 'users' ? 'id' : table === 'watch_rooms' ? 'created_by' : 'user_id';
    // eslint-disable-next-line no-await-in-loop
    const left = await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, args: [id] });
    assert.equal(Number(left.rows[0].n), 0, `${table} should be empty for the deleted user`);
  }
  const again = await makeAgent().ready();
  assert.equal((await again.post('/api/auth/register', { body: user })).status, 201, 'the name and email are free again');
});

test('password reset: generic answer, single-use link, signs everything out, lifts the lock', async () => {
  const sent = [];
  let release;
  const mailServer = new Promise((resolve) => { release = resolve; });
  setMailSender(async (mail) => { await mailServer; sent.push(mail); });
  try {
    const { agent, user } = await registered();
    const anon = await makeAgent().ready();
    const unknown = await anon.post('/api/auth/forgot', { body: { email: 'nobody-here@test.local' } });
    assert.equal(unknown.status, 200, 'an unknown email gets the same answer');

    // Answers before the (still stalled) mail server does, so timing can't tell.
    assert.equal((await anon.post('/api/auth/forgot', { body: { email: user.email.toUpperCase() } })).status, 200);
    assert.equal(sent.length, 0);
    release();
    for (let i = 0; i < 100 && !sent.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 10); });
    }
    assert.equal(sent.length, 1, 'only the registered email gets mail');

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await anon.post('/api/auth/login', { body: { identifier: user.username, password: 'wrong' } });
    }
    assert.equal((await anon.post('/api/auth/login', { body: { identifier: user.username, password: user.password } })).status, 429);
    assert.equal(sent[0].to, user.email);
    const token = /token=([0-9a-f]{64})/.exec(sent[0].text)[1];

    assert.equal((await anon.post('/api/auth/reset', { body: { token, password: 'weak' } })).status, 400);
    assert.equal((await anon.post('/api/auth/reset', { body: { token, password: 'resethorse789' } })).status, 204);
    assert.equal((await anon.post('/api/auth/reset', { body: { token, password: 'resethorse789' } })).status, 400, 'the link works once');
    assert.equal((await agent.get('/api/auth/me')).json.user, null, 'existing sessions are signed out');
    assert.equal((await anon.post('/api/auth/login', { body: { identifier: user.username, password: 'resethorse789' } })).status, 200);
  } finally {
    setMailSender(null);
  }
});

test('password reset reports itself as off when no mail service is configured', async () => {
  const anon = await makeAgent().ready();
  assert.equal((await anon.post('/api/auth/forgot', { body: { email: 'a@test.local' } })).status, 503);
});

test('usernames are unique regardless of case, and case doesn\'t matter to find or log in', async () => {
  const { user } = await registered();
  const lookAlike = { ...newUser(), username: user.username.toUpperCase() };
  const anon = await makeAgent().ready();
  assert.equal((await anon.post('/api/auth/register', { body: lookAlike })).status, 409);

  const profile = await anon.get(`/api/users/${user.username.toUpperCase()}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.json.user.username, user.username, 'shows the real spelling');
  assert.equal((await anon.post('/api/auth/login', { body: { identifier: user.username.toUpperCase(), password: user.password } })).status, 200);
});

test('the database itself refuses a look-alike username', async () => {
  const { user } = await registered();
  await assert.rejects(db.execute({
    sql: 'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
    args: [user.username.toUpperCase(), `x${user.email}`, 'x'],
  }), /UNIQUE/);
});

test('session and CSRF cookies are SameSite=Lax and httpOnly', async () => {
  const anon = makeAgent();
  const user = newUser();
  const first = await fetch(`${baseUrl}/api/health`);
  const csrfRaw = first.headers.getSetCookie().find((c) => c.startsWith('aninest_csrf='));
  assert.match(csrfRaw, /SameSite=Lax/i);
  await anon.ready();
  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: [...anon.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': anon.jar.get('aninest_csrf'), 'x-forwarded-for': '198.51.100.7, 10.0.0.9' },
    body: JSON.stringify(user),
  });
  const sidRaw = reg.headers.getSetCookie().find((c) => c.startsWith('aninest_sid='));
  assert.match(sidRaw, /SameSite=Lax/i);
  assert.match(sidRaw, /HttpOnly/i);
});

test('the deployed CSP only lets the page talk to its own origin', () => {
  const yaml = fs.readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');
  const csp = /name: Content-Security-Policy\s+value: "([^"]+)"/.exec(yaml)[1];
  assert.match(csp, /connect-src 'self';/);
  assert.doesNotMatch(csp, /onrender\.com/);
});

test('an account locks after repeated wrong passwords, from any IP, and unknown names behave the same', async () => {
  const { user } = await registered();
  const tryLogin = (password) => makeAgent().ready().then((a) => a.post('/api/auth/login', { body: { identifier: user.username, password } }));
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await tryLogin('wrong')).status, 401);
  }
  const locked = await tryLogin(user.password);
  assert.equal(locked.status, 429, 'even the right password waits out the lock');
  assert.match(locked.json.error, /Try again in 15 minutes/);

  const ghost = `ghost${Date.now()}`;
  const tryGhost = () => makeAgent().ready().then((a) => a.post('/api/auth/login', { body: { identifier: ghost, password: 'x' } }));
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await tryGhost()).status, 401);
  }
  assert.equal((await tryGhost()).status, 429, 'a name with no account locks the same way');
});

test('a successful login clears earlier failures', async () => {
  const { user } = await registered();
  const agent = await makeAgent().ready();
  const login = (password) => agent.post('/api/auth/login', { body: { identifier: user.email, password } });
  await login('wrong');
  await login('wrong');
  assert.equal((await login(user.password)).status, 200);
  await login('wrong');
  await login('wrong');
  assert.equal((await login(user.password)).status, 200, 'the count started over after the success');
});

test('the cache drops the least recently used entries past its cap and shares one load per key', async () => {
  const { cacheSet, cacheGet, cacheSize, cached } = await import('../src/lib/cache.js');
  for (let i = 0; i < 5100; i += 1) cacheSet(`cap-test:${i}`, i, 60_000);
  assert.ok(cacheSize() <= 5000);
  assert.equal(cacheGet('cap-test:0'), undefined, 'the oldest entry went first');
  assert.equal(cacheGet('cap-test:5099'), 5099);

  let calls = 0;
  const load = () => new Promise((resolve) => { calls += 1; setTimeout(() => resolve('v'), 20); });
  const results = await Promise.all(Array.from({ length: 5 }, () => cached('dedupe-test', 60_000, load)));
  assert.deepEqual(results, ['v', 'v', 'v', 'v', 'v']);
  assert.equal(calls, 1);
});

test('screenshot search has its own small per-visitor limit', async () => {
  const agent = await makeAgent().ready();
  const statuses = [];
  for (let i = 0; i < 7; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await agent.post('/api/screenshot-search', { headers: { 'Content-Type': 'text/plain' } });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 400, 429]);
});

test('health check reports the database as reachable', async () => {
  const res = await makeAgent().get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test('review reports: anyone signed in can report, an admin hides or dismisses', async () => {
  const author = await registered();
  const reporter = await registered();
  const admin = await registered();
  await db.execute({ sql: 'UPDATE users SET is_admin = 1 WHERE id = ?', args: [admin.id] });
  const malId = 900000 + (Date.now() % 1000);
  await author.agent.post('/api/reviews', { body: { mal_id: malId, rating: 1, body: 'spam spam spam' } });
  const list = await reporter.agent.get(`/api/reviews/${malId}`);
  const reviewId = Number(list.json.reviews[0].id);

  assert.equal((await makeAgent().ready().then((a) => a.post('/api/review-reports', { body: { kind: 'anime', reviewId } }))).status, 401);
  assert.equal((await author.agent.post('/api/review-reports', { body: { kind: 'anime', reviewId } })).status, 400, 'not your own');
  assert.equal((await reporter.agent.post('/api/review-reports', { body: { kind: 'anime', reviewId, reason: 'spam' } })).status, 201);
  assert.equal((await reporter.agent.post('/api/review-reports', { body: { kind: 'anime', reviewId } })).status, 201, 'twice is fine');

  assert.equal((await reporter.agent.get('/api/admin/review-reports')).status, 404, 'queue is admin-only');
  const queue = await admin.agent.get('/api/admin/review-reports');
  const item = queue.json.reports.find((r) => r.reviewId === reviewId);
  assert.equal(item.reports, 1);
  assert.equal(item.body, 'spam spam spam');

  assert.equal((await admin.agent.post(`/api/admin/review-reports/anime/${reviewId}/hide`)).status, 200);
  assert.equal((await reporter.agent.get(`/api/reviews/${malId}`)).json.reviews.length, 0, 'gone from the public list');
  assert.equal((await reporter.agent.get(`/api/users/${author.user.username}`)).json.reviews.length, 0, 'and from the profile');
  assert.ok((await author.agent.get(`/api/reviews/${malId}`)).json.myReview, 'the author still sees their own');
  assert.ok(!(await admin.agent.get('/api/admin/review-reports')).json.reports.some((r) => r.reviewId === reviewId));
});

test('profile share links carry their own preview tags and redirect to the page', async () => {
  const { user } = await registered();
  const res = await makeAgent().get(`/api/share/u/${user.username.toUpperCase()}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.json, new RegExp(`<meta property="og:title" content="${user.username} on AniNest">`));
  assert.match(res.json, new RegExp(`http-equiv="refresh" content="0; url=http://localhost:5173/#/u/${user.username}"`));
  assert.equal((await makeAgent().get('/api/share/u/bad<name>')).status, 404);
});

test('a private profile hides lists and reviews from others, not from its owner', async () => {
  const owner = await registered();
  const viewer = await registered();
  await owner.agent.post('/api/favorites', { body: { mal_id: 5114, title: 'FMA:B' } });
  const on = await owner.agent.post('/api/auth/privacy', { body: { private: true } });
  assert.deepEqual(on.json, { isPrivate: true });
  assert.equal((await owner.agent.get('/api/auth/me')).json.user.isPrivate, true);

  const seen = await viewer.agent.get(`/api/users/${owner.user.username}`);
  assert.equal(seen.json.private, true);
  assert.deepEqual(seen.json.favorites, []);
  assert.ok(seen.json.xp, 'level still shows');
  const anon = await makeAgent().get(`/api/users/${owner.user.username}`);
  assert.deepEqual(anon.json.favorites, []);
  assert.equal((await owner.agent.get(`/api/users/${owner.user.username}`)).json.favorites.length, 1, 'the owner sees everything');
  const match = await viewer.agent.get(`/api/users/${owner.user.username}/taste-match`);
  assert.equal(match.json.private, true);
  assert.equal(match.json.match, null);

  await owner.agent.post('/api/auth/privacy', { body: { private: false } });
  assert.equal((await viewer.agent.get(`/api/users/${owner.user.username}`)).json.favorites.length, 1);
});

test('free in my country: only uploads that play there, titles filled in the background', async () => {
  const { setTitleFetcher, backfillTitles } = await import('../src/lib/animeTitles.js');
  const fetched = [];
  setTitleFetcher(async (id) => { fetched.push(id); return { title: `Show ${id}`, score: id === 93001 ? 8.5 : 7, type: 'TV', episodes: 12, images: { jpg: { image_url: 'https://cdn.myanimelist.net/x.jpg' } } }; });
  try {
    const add = (mal, vid, allowed, blocked) => db.execute({
      sql: "INSERT INTO anime_watch_sources (mal_id, youtube_video_id, status, allowed_regions, blocked_regions) VALUES (?, ?, 'approved', ?, ?)",
      args: [mal, vid, allowed ? JSON.stringify(allowed) : null, blocked ? JSON.stringify(blocked) : null],
    });
    await add(93001, 'aaaaaaaaaa1', null, null);
    await add(93001, 'aaaaaaaaaa2', ['IN', 'PH'], null);
    await add(93002, 'aaaaaaaaaa3', null, ['IN']);
    await db.execute({ sql: "INSERT INTO anime_watch_sources (mal_id, youtube_video_id, status) VALUES (93003, 'aaaaaaaaaa4', 'pending')", args: [] });

    const anon = makeAgent();
    const first = await anon.get('/api/free?country=in');
    assert.equal(first.json.country, 'IN');
    assert.ok(first.json.pending >= 1, 'titles not known yet');
    await backfillTitles([93001, 93002]);
    const inIndia = (await anon.get('/api/free?country=IN')).json;
    const mine = inIndia.data.filter((d) => d.mal_id >= 93000 && d.mal_id < 93100);
    assert.deepEqual(mine.map((d) => [d.mal_id, d.uploads]), [[93001, 2]], 'blocked in India, and the pending one never shows');
    const inUs = (await anon.get('/api/free?country=US')).json.data.filter((d) => d.mal_id >= 93000 && d.mal_id < 93100);
    assert.deepEqual(inUs.map((d) => [d.mal_id, d.uploads]), [[93001, 1], [93002, 1]], 'best score first; the IN/PH-only upload is out');
    assert.equal(inUs[0].title, 'Show 93001');
    assert.equal((await anon.get('/api/free?country=<x>')).json.country, null);
  } finally {
    setTitleFetcher(null);
  }
});

test('episode flags: filler and recap across pages, and a quiet fallback when Jikan is down', async () => {
  const { setEpisodePageFetcher } = await import('../src/lib/episodeFlags.js');
  const pages = [];
  setEpisodePageFetcher(async (malId, page) => {
    pages.push([malId, page]);
    if (malId === 93102) throw Object.assign(new Error('Jikan error 504'), { status: 504 });
    const base = (page - 1) * 100;
    return {
      pagination: { has_next_page: page < 2 },
      data: Array.from({ length: page < 2 ? 100 : 20 }, (_, i) => ({ mal_id: base + i + 1, filler: [26, 105, 106].includes(base + i + 1), recap: base + i + 1 === 50 })),
    };
  });
  try {
    const anon = makeAgent();
    const ok = (await anon.get('/api/episode-guide/93101/flags')).json;
    assert.deepEqual(ok, { available: true, filler: [26, 105, 106], recap: [50] });
    assert.deepEqual(pages.filter(([id]) => id === 93101).map(([, p]) => p), [1, 2], 'stops when there is no next page');
    await anon.get('/api/episode-guide/93101/flags');
    assert.equal(pages.filter(([id]) => id === 93101).length, 2, 'cached after the first load');
    assert.deepEqual((await anon.get('/api/episode-guide/93102/flags')).json, { available: false, filler: [], recap: [] });
    assert.equal((await anon.get('/api/episode-guide/abc/flags')).status, 400);
  } finally {
    setEpisodePageFetcher(null);
  }
});

test('follows and the activity feed: what followed people added, finished and rated', async () => {
  const me = await registered();
  const alex = await registered();
  const hidden = await registered();
  const alexName = alex.user.username;

  assert.equal((await me.agent.post(`/api/users/${me.user.username}/follow`)).status, 400, 'no following yourself');
  assert.equal((await (await makeAgent().ready()).post(`/api/users/${alexName}/follow`)).status, 401);
  assert.equal((await me.agent.post('/api/users/nobody_here_x/follow')).status, 404);
  assert.deepEqual((await me.agent.get('/api/feed')).json, { following: [], items: [] });

  const followed = await me.agent.post(`/api/users/${alexName.toUpperCase()}/follow`);
  assert.deepEqual(followed.json, { followers: 1, following: 0, isFollowing: true });
  assert.equal((await me.agent.post(`/api/users/${alexName}/follow`)).json.followers, 1, 'following twice is a no-op');
  await me.agent.post(`/api/users/${hidden.user.username}/follow`);
  const profile = await me.agent.get(`/api/users/${alexName}`);
  assert.deepEqual(profile.json.follows, { followers: 1, following: 0, isFollowing: true });
  assert.equal((await makeAgent().get(`/api/users/${alexName}`)).json.follows.isFollowing, false);

  await alex.agent.post('/api/favorites', { body: { mal_id: 52991, title: 'Frieren', status: 'plan_to_watch' } });
  await alex.agent.post('/api/favorites', { body: { mal_id: 5114, title: 'FMA:B' } });
  // Backdate the status so the completion below is a clear change.
  await db.execute({ sql: "UPDATE favorites SET added_at = datetime('now', '-2 days'), status_at = datetime('now', '-2 days') WHERE mal_id = 52991" });
  await alex.agent.post('/api/favorites/52991/progress', { body: { episodes_watched: 28, episodes: 28 } });
  await alex.agent.post('/api/reviews', { body: { mal_id: 52991, rating: 9, body: 'Quietly perfect.' } });
  await hidden.agent.post('/api/favorites', { body: { mal_id: 1, title: 'Cowboy Bebop' } });
  await hidden.agent.post('/api/auth/privacy', { body: { private: true } });

  const feed = (await me.agent.get('/api/feed')).json;
  assert.deepEqual(feed.following.map((f) => f.private), feed.following.map((f) => f.username === hidden.user.username));
  const kinds = feed.items.map((i) => `${i.kind}:${i.mal_id}`).sort();
  assert.deepEqual(kinds, ['added:5114', 'review:52991', 'status:52991']);
  const done = feed.items.find((i) => i.kind === 'status');
  assert.equal(done.status, 'completed');
  assert.equal(done.username, alexName);
  const review = feed.items.find((i) => i.kind === 'review');
  assert.equal(review.rating, 9);
  assert.equal(review.title, 'Frieren');
  assert.ok(!feed.items.some((i) => i.username === hidden.user.username), 'private accounts stay out');

  const unfollowed = await me.agent.delete(`/api/users/${alexName}/follow`);
  assert.equal(unfollowed.json.isFollowing, false);
  assert.equal((await me.agent.get('/api/feed')).json.items.length, 0);

  // Deleting an account removes its follows both ways.
  await alex.agent.post(`/api/users/${me.user.username}/follow`);
  assert.equal((await me.agent.post('/api/auth/delete-account', { body: { password: me.user.password } })).status, 204);
  const left = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM follows WHERE follower_id = ? OR followee_id = ?', args: [me.id, me.id] });
  assert.equal(Number(left.rows[0].n), 0);
});

test('web push: off without keys, then subscriptions get pushes and dead ones are dropped', async () => {
  const { setPushSender, isPushEndpoint } = await import('../src/lib/push.js');
  const { notifyNewEpisodes } = await import('../src/lib/notifications.js');
  const { agent, id } = await registered();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
  const body = { endpoint, keys: { p256dh: 'BPk', auth: 'xyz' } };

  assert.deepEqual((await agent.get('/api/notifications/push/key')).json, { enabled: false, publicKey: null });
  assert.equal((await agent.post('/api/notifications/push/subscribe', { body })).status, 404);

  const sent = [];
  let fail = null;
  setPushSender(async (sub, payload) => {
    if (fail) { const err = new Error('gone'); err.statusCode = fail; throw err; }
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  });
  try {
    assert.equal(isPushEndpoint('https://evil.example/push'), false);
    assert.equal(isPushEndpoint('http://fcm.googleapis.com/x'), false);
    assert.equal(isPushEndpoint('https://fcm.googleapis.com.evil.example/x'), false);
    assert.equal(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=1'), true);
    const bad = await agent.post('/api/notifications/push/subscribe', { body: { ...body, endpoint: 'https://127.0.0.1/x' } });
    assert.equal(bad.status, 400);
    assert.equal((await agent.post('/api/notifications/push/subscribe', { body })).status, 201);
    assert.equal((await agent.post('/api/notifications/push/subscribe', { body })).status, 201, 'subscribing again is fine');

    await agent.post('/api/favorites', { body: { mal_id: 777001, title: 'Push Test Show' } });
    await notifyNewEpisodes(777001, 2);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload, { title: 'Push Test Show', body: '2 new free episodes available', url: '#/anime/777001' });

    fail = 410;
    await notifyNewEpisodes(777001, 1);
    await new Promise((r) => setTimeout(r, 50));
    const left = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', args: [id] });
    assert.equal(Number(left.rows[0].n), 0, 'a subscription the browser dropped is forgotten');

    fail = null;
    await agent.post('/api/notifications/push/subscribe', { body });
    assert.equal((await agent.post('/api/notifications/push/unsubscribe', { body: { endpoint } })).status, 204);
    const after = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', args: [id] });
    assert.equal(Number(after.rows[0].n), 0);
  } finally {
    setPushSender(null);
  }
});

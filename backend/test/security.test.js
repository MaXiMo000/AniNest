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

test('password reset: generic answer, single-use link, signs everything out', async () => {
  const sent = [];
  setMailSender(async (mail) => { sent.push(mail); });
  try {
    const { agent, user } = await registered();
    const anon = await makeAgent().ready();
    const unknown = await anon.post('/api/auth/forgot', { body: { email: 'nobody-here@test.local' } });
    assert.equal(unknown.status, 200, 'an unknown email gets the same answer');
    assert.equal(sent.length, 0);

    assert.equal((await anon.post('/api/auth/forgot', { body: { email: user.email.toUpperCase() } })).status, 200);
    assert.equal(sent.length, 1);
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

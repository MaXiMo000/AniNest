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

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/lib/db.js');

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

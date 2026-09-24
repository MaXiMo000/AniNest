// Tidewatch metrics add-on (src/lib/tidewatch-metrics.js): window math, p95, auth, and that
// nothing identifying (paths, query strings, bodies) ever reaches the output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { Series, recordDep, snapshot, tidewatchMetrics, track } from '../src/lib/tidewatch-metrics.js';

const TOKEN = 'test-token-not-a-secret-0123456789';

async function serve(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('rolling 60 s window: old seconds drop out, slots are reused', () => {
  const s = new Series();
  const t = 1_000_000_000_000;
  s.record(10, true, t);
  s.record(10, false, t + 30_000);
  assert.deepEqual([s.totals(t + 30_000).count, s.totals(t + 30_000).errors], [2, 1]);
  assert.equal(s.totals(t + 61_000).count, 1); // the first second has left the window
  s.record(10, true, t + 60_000); // same slot as t, one minute later: reset, not added
  assert.equal(s.totals(t + 60_000).count, 2);
  assert.deepEqual(s.totals(t + 200_000), { count: 0, errors: 0, p95_ms: 0 });
});

test('p95 comes from the log-spaced histogram (within one bucket, ~1.43x)', () => {
  const t = 1_000_000_000_000;
  const fast = new Series();
  for (let i = 0; i < 95; i++) fast.record(10, true, t);
  for (let i = 0; i < 5; i++) fast.record(5000, true, t);
  const p95 = fast.totals(t).p95_ms;
  assert.ok(p95 >= 10 && p95 < 14.5, `p95 ${p95}`);

  const slow = new Series();
  for (let i = 0; i < 94; i++) slow.record(10, true, t);
  for (let i = 0; i < 6; i++) slow.record(5000, true, t);
  const p95slow = slow.totals(t).p95_ms;
  assert.ok(p95slow >= 5000 && p95slow < 7200, `p95 ${p95slow}`);

  const extremes = new Series();
  extremes.record(0, true, t);
  extremes.record(10 * 60_000, true, t); // beyond the top bucket: clamped, not lost
  assert.equal(extremes.totals(t).count, 2);
  assert.equal(extremes.totals(t).p95_ms, 60_000);
});

test('dependencies: track() times calls, errors on throw or 5xx, max 8 fixed ids', async () => {
  await track('db', 'database', async () => 'ok');
  await assert.rejects(track('db', 'database', async () => { throw new Error('boom'); }));
  await track('anime-api', 'service', async () => ({ status: 503 }));
  await track('anime-api', 'service', async () => ({ status: 404 }));
  recordDep('Bad Id!', 'service', 1, true);
  recordDep('x', 'gateway', 1, true);
  for (let i = 0; i < 20; i++) recordDep(`extra-${i}`, 'cache', 1, true);
  const deps = snapshot().deps;
  assert.equal(deps.length, 8);
  const byId = Object.fromEntries(deps.map((d) => [d.id, d]));
  assert.deepEqual([byId.db.count, byId.db.errors, byId.db.kind], [2, 1, 'database']);
  assert.deepEqual([byId['anime-api'].count, byId['anime-api'].errors], [2, 1]);
  assert.equal(byId['bad id!'], undefined);
  assert.equal(byId.x, undefined);
});

test('the route does not exist without a token', async () => {
  const app = express();
  assert.equal(tidewatchMetrics(app, { token: '' }), false);
  const { base, close } = await serve(app);
  try {
    assert.equal((await fetch(`${base}/tidewatch/metrics`)).status, 404);
  } finally {
    close();
  }
});

test('auth, no-store, 5xx-only errors, and nothing identifying in the output', async () => {
  const app = express();
  assert.equal(tidewatchMetrics(app, { token: TOKEN }), true);
  app.get('/api/users/:name', (req, res) => res.status(req.query.fail ? 500 : 404).json({}));
  const { base, close } = await serve(app);
  try {
    const url = `${base}/tidewatch/metrics`;
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: TOKEN }]) {
      const res = await fetch(url, { headers });
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    await fetch(`${base}/api/users/alice-secret?email=alice%40example.com`); // 404
    await fetch(`${base}/api/users/bob?fail=1`); // 500
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body), ['v', 'window_s', 'uptime_s', 'http', 'deps']);
    assert.deepEqual(Object.keys(body.http), ['count', 'errors', 'p95_ms']);
    // Polls of the metrics route are never counted; the two app requests are.
    assert.equal(body.http.count, 2);
    assert.equal(body.http.errors, 1);
    for (const leak of ['alice', 'bob', 'example.com', '/api', 'users', TOKEN]) {
      assert.ok(!text.includes(leak), `output contains ${leak}`);
    }
  } finally {
    close();
  }
});

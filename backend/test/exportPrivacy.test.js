// List export (routes/export.js, lib/listExport.js), extra tables in the
// JSON data export, and private profiles' reviews on anime pages. Own file and own temp database; same approach
// as api.test.js: a real app on a random port, driven with fetch.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `aninest-export-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.AUTH_RATE_LIMIT = '1000';
process.env.RATE_LIMIT = '1000';

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/lib/db.js');
const { toCsv, toMalXml, csvCell, cdata, malStatus } = await import('../src/lib/listExport.js');

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(process.env.DB_PATH + suffix, { force: true }); } catch { /* best effort */ }
  }
});

function makeAgent() {
  const jar = new Map();
  let csrf = '';
  async function request(method, p, body) {
    const headers = {};
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = csrf;
    const res = await fetch(baseUrl + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    csrf = res.headers.get('x-csrf-token') || csrf;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, json };
  }
  return {
    get: (p) => request('GET', p),
    post: (p, body = {}) => request('POST', p, body),
  };
}

let n = 0;
async function signedIn() {
  n += 1;
  const id = `${Date.now()}${n}`.slice(-10);
  const agent = makeAgent();
  await agent.get('/api/health');
  const reg = await agent.post('/api/auth/register', { username: `x${id}`, email: `x${id}@test.local`, password: 'correcthorse123' });
  assert.equal(reg.status, 201);
  return { agent, username: `x${id}`, id: reg.json.user.id };
}

// ---- pure formatters ----

test('csvCell quotes, doubles quotes and defuses spreadsheet formulas', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(9), '9');
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a, b'), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@cmd'), "'@cmd");
});

test('toCsv writes a header row, one line per entry and a UTF-8 BOM', () => {
  const csv = toCsv([{ mal_id: 1, title: 'Cowboy Bebop', type: 'TV', status: 'completed', episodes_watched: 26, episodes: 26, my_rating: 10, my_review: 'Great, really', added_at: '2026-01-01 00:00:00' }]);
  assert.ok(csv.startsWith('﻿mal_id,title,type,status,episodes_watched,episodes,my_rating,my_review,added_at\r\n'));
  assert.ok(csv.includes('1,Cowboy Bebop,TV,completed,26,26,10,"Great, really",2026-01-01 00:00:00\r\n'));
});

test('malStatus maps our statuses and gives unstatused favorites one MAL accepts', () => {
  assert.equal(malStatus({ status: 'plan_to_watch' }), 'Plan to Watch');
  assert.equal(malStatus({ status: 'dropped' }), 'Dropped');
  assert.equal(malStatus({ status: null, episodes_watched: 0 }), 'Plan to Watch');
  assert.equal(malStatus({ status: null, episodes_watched: 3 }), 'Watching');
});

test('cdata survives a "]]>" inside the text', () => {
  assert.equal(cdata('a]]>b'), '<![CDATA[a]]]]><![CDATA[>b]]>');
});

test('toMalXml produces MAL import XML with totals, scores and escaped text', () => {
  const xml = toMalXml([
    { mal_id: 1, title: 'Cowboy <Bebop>', type: 'TV', status: 'completed', episodes: 26, episodes_watched: 26, my_rating: 9, my_review: 'Bang]]>' },
    { mal_id: 5114, title: 'FMA:B', type: 'TV', status: 'watching', episodes: 64, episodes_watched: 10, my_rating: null },
    { mal_id: 0, title: 'no MAL id, skipped' },
  ], { username: 'amy<3' });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" ?>'));
  assert.ok(xml.includes('<user_name>amy&lt;3</user_name>'));
  assert.ok(xml.includes('<user_total_anime>2</user_total_anime>'));
  assert.ok(xml.includes('<user_total_completed>1</user_total_completed>'));
  assert.ok(xml.includes('<user_total_watching>1</user_total_watching>'));
  assert.ok(xml.includes('<series_title><![CDATA[Cowboy <Bebop>]]></series_title>'));
  assert.ok(xml.includes('<my_score>9</my_score>'));
  assert.ok(xml.includes('<my_score>0</my_score>'), 'unrated entries score 0');
  assert.ok(xml.includes('<my_comments><![CDATA[Bang]]]]><![CDATA[>]]></my_comments>'));
  assert.ok(!xml.includes('no MAL id'));
  assert.equal((xml.match(/<anime>/g) || []).length, 2);
});

// ---- export routes ----

test('export routes need an account', async () => {
  const agent = makeAgent();
  for (const f of ['csv', 'mal']) {
    assert.equal((await agent.get(`/api/export/${f}`)).status, 401);
  }
});

test('export downloads the signed-in user\'s own list in all three formats', async () => {
  const me = await signedIn();
  const other = await signedIn();
  await me.agent.post('/api/favorites', { mal_id: 1, title: 'Cowboy Bebop', type: 'TV', status: 'completed', episodes: 26 });
  await me.agent.post('/api/favorites', { mal_id: 20, title: 'Naruto', type: 'TV' });
  await me.agent.post('/api/reviews', { mal_id: 1, rating: 10, body: 'See you, space cowboy' });
  await other.agent.post('/api/favorites', { mal_id: 30, title: 'Someone else\'s show', type: 'TV' });

  const json = await me.agent.get('/api/auth/export');
  assert.equal(json.status, 200);
  assert.equal(json.json.account.is_private, 0);
  assert.ok(Array.isArray(json.json.game_score_log));
  assert.ok(Array.isArray(json.json.it_clicked));

  const csv = await me.agent.get('/api/export/csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  const lines = csv.text.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('1,Cowboy Bebop,TV,completed,0,26,10,'), 'rows sort by title and carry the review');

  const mal = await me.agent.get('/api/export/mal');
  assert.equal(mal.status, 200);
  assert.match(mal.headers.get('content-type'), /^application\/xml/);
  assert.ok(mal.text.includes('<series_animedb_id>1</series_animedb_id>'));
  assert.ok(mal.text.includes('<my_score>10</my_score>'));
  assert.ok(mal.text.includes('<my_status>Plan to Watch</my_status>'), 'the unstatused Naruto');
  assert.ok(!mal.text.includes('Someone else'));
});

// ---- private profile ----

test('a private profile\'s reviews drop out of the anime page list but still count', async () => {
  const owner = await signedIn();
  const viewer = await signedIn();
  await owner.agent.post('/api/reviews', { mal_id: 4242, rating: 8, body: 'secret opinion' });
  await viewer.agent.post('/api/reviews', { mal_id: 4242, rating: 4 });
  assert.equal((await viewer.agent.get('/api/reviews/4242')).json.reviews.length, 2);

  assert.equal((await owner.agent.post('/api/auth/privacy', { private: true })).status, 200);
  const reviews = await viewer.agent.get('/api/reviews/4242');
  assert.deepEqual(reviews.json.reviews.map((r) => r.username), [viewer.username]);
  assert.equal(reviews.json.count, 2, 'the rating still counts in the anonymous aggregate');
  assert.equal(reviews.json.average, 6);
  const mine = await owner.agent.get('/api/reviews/4242');
  assert.equal(mine.json.myReview.body, 'secret opinion', 'the owner still gets their own review back to edit');

  await owner.agent.post('/api/auth/privacy', { private: false });
  assert.equal((await viewer.agent.get('/api/reviews/4242')).json.reviews.length, 2);
});

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/session.js';
import { cached } from '../lib/cache.js';
import { persistentCached } from '../lib/persistentCache.js';
import { anilistNovelSearch, anilistNovelById } from '../lib/anilist.js';
import { GENRE_NAMES } from '../lib/vibeParser.js';
import { httpUrl } from './favorites.js';
import { catalogEntry, getBook } from '../lib/classics.js';
import { searchCatalog, catalogBook } from '../lib/classicsCatalog.js';
import { readingDay, streakFrom } from '../lib/readingStreak.js';

// Light novels: catalog from AniList (format NOVEL, ids are AniList ids),
// a reading list with volume progress, reviews, and public-domain classics
// from Project Gutenberg (through the free Gutendex API). Light novels are
// always a link-out to official sources, same line the manga section holds:
// no fan-translation sites. Only out-of-copyright classics are read in-app.
export const novelsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const idOf = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id < 1e9 ? id : null;
};

let sources = { search: anilistNovelSearch, byId: anilistNovelById, gutendex: (url) => fetch(url, { signal: AbortSignal.timeout(15000) }), librivox: (url) => fetch(url, { signal: AbortSignal.timeout(15000) }) };
// Test hook: the suite never calls AniList or Gutendex.
export function setNovelSources(s) {
  sources = s ? { ...sources, ...s } : { search: anilistNovelSearch, byId: anilistNovelById, gutendex: (url) => fetch(url, { signal: AbortSignal.timeout(15000) }), librivox: (url) => fetch(url, { signal: AbortSignal.timeout(15000) }) };
}

const SORTS = { popular: 'POPULARITY_DESC', score: 'SCORE_DESC', trending: 'TRENDING_DESC', newest: 'START_DATE_DESC' };
const STATUSES = { ongoing: 'RELEASING', completed: 'FINISHED', hiatus: 'HIATUS' };

novelsRouter.get('/search', asyncRoute(async (req, res) => {
  const page = Math.min(50, Math.max(1, Number(req.query.page) || 1));
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const genre = GENRE_NAMES.includes(req.query.genre) ? req.query.genre : '';
  const status = STATUSES[req.query.status] || '';
  const sort = SORTS[req.query.sort] || SORTS.popular;
  const key = `novels:search:${q.toLowerCase()}:${genre}:${status}:${sort}:${page}`;
  res.json(await cached(key, 10 * 60 * 1000, () => sources.search({ q, genre, status, sort, page })));
}));

novelsRouter.get('/genres', (_req, res) => res.json({ data: GENRE_NAMES }));

// Public-domain classics, searched in AniNest's own copy of the Project
// Gutenberg catalog (lib/classicsCatalog.js). Until that has loaded, Gutendex
// answers instead. Each result opens in the reader (#/read/:id), which checks
// the book's copyright status before serving it.
const CLASSIC_TOPICS = {
  adventure: 'adventure', scifi: 'science fiction', fantasy: 'fantasy', mystery: 'detective', horror: 'horror',
  romance: 'love stories', children: 'children', humor: 'humor', poetry: 'poetry', gothic: 'gothic',
};
const CLASSIC_ERAS = {
  before1800: { author_year_end: 1799 },
  '1800s': { author_year_start: 1800, author_year_end: 1899 },
  '1900s': { author_year_start: 1900 },
};
const CLASSIC_LANGS = ['en', 'fr', 'de', 'es', 'it', 'pt', 'ja'];

novelsRouter.get('/classics', asyncRoute(async (req, res) => {
  const page = Math.min(50, Math.max(1, Number(req.query.page) || 1));
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const topic = CLASSIC_TOPICS[req.query.topic] ? req.query.topic : '';
  const era = CLASSIC_ERAS[req.query.era] ? req.query.era : '';
  const lang = CLASSIC_LANGS.includes(req.query.lang) ? req.query.lang : 'en';
  const params = new URLSearchParams({ languages: lang, copyright: 'false', mime_type: 'text/plain', page: String(page) });
  if (q) params.set('search', q);
  if (topic) params.set('topic', CLASSIC_TOPICS[topic]);
  for (const [k, v] of Object.entries(CLASSIC_ERAS[era] || {})) params.set(k, String(v));
  const local = searchCatalog({
    q, lang, page, topic: CLASSIC_TOPICS[topic] || '',
    yearStart: CLASSIC_ERAS[era]?.author_year_start ?? null,
    yearEnd: CLASSIC_ERAS[era]?.author_year_end ?? null,
  });
  if (local) {
    res.set('Cache-Control', 'public, max-age=600');
    return res.json({ ...local, data: local.data.map((b) => ({ ...b, readUrl: b.sourceUrl })) });
  }
  const data = await cached(`novels:classics:${q.toLowerCase()}:${topic}:${era}:${lang}:${page}`, 60 * 60 * 1000, async () => {
    const upstream = await sources.gutendex(`https://gutendex.com/books/?${params}`);
    if (!upstream.ok) throw Object.assign(new Error('Gutendex unavailable'), { status: 502 });
    const json = await upstream.json();
    return {
      hasNext: Boolean(json.next),
      count: Number(json.count) || 0,
      data: (json.results || []).map((b) => {
        const entry = catalogEntry(b);
        return { ...entry, readUrl: entry.sourceUrl };
      }).filter((b) => Number.isInteger(b.id) && b.readable),
    };
  });
  res.json(data);
}));

// Books you've opened in the reader, most recent first (the "continue
// reading" shelf), plus how many you've finished.
novelsRouter.get('/classics/reading', requireAuth, asyncRoute(async (req, res) => {
  const rows = await db.execute({
    sql: 'SELECT book_id, title, authors, image, part, max_part, parts, finished_at, updated_at FROM classic_reads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100',
    args: [req.user.id],
  });
  const list = rows.rows.map((r) => ({
    id: Number(r.book_id), title: r.title, authors: r.authors ? r.authors.split('|') : [], image: r.image,
    part: Number(r.part), maxPart: Number(r.max_part), parts: Number(r.parts), finishedAt: r.finished_at, updatedAt: r.updated_at,
  }));
  res.json({ list, finished: list.filter((b) => b.finishedAt).length, streak: await streakOf(req.user.id, readingDay(req.query.day)) });
}));

async function streakOf(userId, today) {
  const rows = await db.execute({ sql: 'SELECT day FROM classic_days WHERE user_id = ? ORDER BY day DESC LIMIT 400', args: [userId] });
  return streakFrom(rows.rows.map((r) => r.day), today);
}

const bookId = (raw) => {
  const id = idOf(raw);
  return id && id < 1e7 ? id : null;
};

async function myRead(userId, id) {
  if (!userId) return null;
  const row = (await db.execute({ sql: 'SELECT part, max_part, finished_at FROM classic_reads WHERE user_id = ? AND book_id = ?', args: [userId, id] })).rows[0];
  return row ? { part: Number(row.part), maxPart: Number(row.max_part), finishedAt: row.finished_at } : null;
}

// One book: its catalog details and table of contents (no text).
novelsRouter.get('/classics/:id', asyncRoute(async (req, res) => {
  const id = bookId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid book id.' });
  const { meta, parts } = await getBook(id);
  const totalWords = parts.reduce((s, p) => s + p.words, 0);
  res.json({
    data: { ...meta, words: totalWords, parts: parts.map((p) => ({ title: p.title, words: p.words })) },
    mine: await myRead(req.user?.id, id),
  });
}));

// One part's text, as plain paragraphs (the page escapes them).
novelsRouter.get('/classics/:id/parts/:n', asyncRoute(async (req, res) => {
  const id = bookId(req.params.id);
  const n = Number(req.params.n);
  if (!id || !Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'Invalid book or part.' });
  const { parts } = await getBook(id);
  if (n >= parts.length) return res.status(404).json({ error: 'No such part.' });
  res.set('Cache-Control', 'public, max-age=86400');
  res.json({ index: n, title: parts[n].title, words: parts[n].words, paragraphs: parts[n].paragraphs });
}));

const progressSchema = z.object({ part: z.number().int().min(0).max(5000), day: z.string().max(10).optional() });

// Saves where you are. max_part moves forward only one part at a time, and
// the book counts as finished when that reaches the last part.
novelsRouter.post('/classics/:id/progress', requireAuth, asyncRoute(async (req, res) => {
  const id = bookId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid book id.' });
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid part.' });
  const { meta, parts } = await getBook(id);
  const part = Math.min(parsed.data.part, parts.length - 1);
  const prev = await myRead(req.user.id, id);
  const maxPart = prev ? (part === prev.maxPart + 1 ? part : prev.maxPart) : (part === 0 ? 0 : -1);
  const finishedAt = prev?.finishedAt || (maxPart >= parts.length - 1 ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null);
  await db.execute({
    sql: `INSERT INTO classic_reads (user_id, book_id, title, authors, image, part, max_part, parts, finished_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, book_id) DO UPDATE SET part = excluded.part, max_part = excluded.max_part, parts = excluded.parts,
            finished_at = excluded.finished_at, updated_at = datetime('now')`,
    args: [req.user.id, id, meta.title.slice(0, 300), meta.authors.join('|').slice(0, 300), meta.image, part, maxPart, parts.length, finishedAt],
  });
  const today = readingDay(parsed.data.day);
  const fresh = await db.execute({ sql: 'INSERT OR IGNORE INTO classic_days (user_id, day) VALUES (?, ?)', args: [req.user.id, today] });
  res.json({
    mine: { part, maxPart, finishedAt },
    justFinished: Boolean(finishedAt && !prev?.finishedAt),
    streak: await streakOf(req.user.id, today),
    firstToday: fresh.rowsAffected > 0,
  });
}));

// A free LibriVox audiobook recorded from this exact Gutenberg edition
// (LibriVox records which text each reading used). Audio streams from
// archive.org; null when there is no matching recording.
const GUTENBERG_SOURCE = /gutenberg\.org\/(?:ebooks|etext|files)\/(\d+)(?:\D|$)/;
const ARCHIVE_AUDIO = /^https:\/\/(?:www\.)?archive\.org\/download\/[^?#]+\.mp3$/i;

novelsRouter.get('/classics/:id/audio', asyncRoute(async (req, res) => {
  const id = bookId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid book id.' });
  const data = await cached(`novels:classics:audio:${id}`, 24 * 60 * 60 * 1000, async () => {
    const title = catalogBook(id)?.title || (await getBook(id)).meta.title;
    const lead = title.split(/[;:,(]/)[0].trim();
    if (!lead) return null;
    const params = new URLSearchParams({ title: `^${lead}`, format: 'json', extended: '1', limit: '50' });
    const upstream = await sources.librivox(`https://librivox.org/api/feed/audiobooks/?${params}`);
    if (upstream.status === 404) return null; // LibriVox's answer for "no matches"
    if (!upstream.ok) throw Object.assign(new Error('LibriVox unavailable'), { status: 502 });
    const match = ((await upstream.json()).books || []).find((b) => Number(GUTENBERG_SOURCE.exec(b.url_text_source || '')?.[1]) === id);
    if (!match) return null;
    const sections = (match.sections || [])
      .map((s) => ({ title: String(s.title || '').slice(0, 200), url: String(s.listen_url || '').replace(/^http:/, 'https:'), seconds: Number(s.playtime) || 0 }))
      .filter((s) => ARCHIVE_AUDIO.test(s.url));
    if (!sections.length) return null;
    return { librivoxUrl: match.url_librivox, totalTime: match.totaltime || null, sections };
  });
  res.set('Cache-Control', 'public, max-age=86400');
  res.json({ data });
}));

novelsRouter.delete('/classics/:id/progress', requireAuth, asyncRoute(async (req, res) => {
  const id = bookId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid book id.' });
  await db.execute({ sql: 'DELETE FROM classic_reads WHERE user_id = ? AND book_id = ?', args: [req.user.id, id] });
  res.status(204).end();
}));

// ---- Reading list (signed in) ----

const READ_STATUSES = ['reading', 'plan_to_read', 'completed', 'dropped'];
const MAX_LIST = 500;

novelsRouter.get('/list', requireAuth, asyncRoute(async (req, res) => {
  const rows = await db.execute({
    sql: 'SELECT novel_id, title, image, status, volumes_read, volumes, added_at FROM novel_favorites WHERE user_id = ? ORDER BY added_at DESC',
    args: [req.user.id],
  });
  res.json({ list: rows.rows.map((r) => ({ ...r, novel_id: Number(r.novel_id), volumes_read: Number(r.volumes_read), volumes: r.volumes == null ? null : Number(r.volumes) })) });
}));

const listSchema = z.object({
  novel_id: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  image: httpUrl.optional().or(z.literal('')),
  status: z.enum(READ_STATUSES).nullable().optional(),
  volumes_read: z.number().int().min(0).max(500).optional(),
  volumes: z.number().int().min(1).max(500).nullable().optional(),
});

// Adds or updates an entry. Only the fields sent are changed on an update.
novelsRouter.post('/list', requireAuth, asyncRoute(async (req, res) => {
  const parsed = listSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  const d = parsed.data;
  const existing = await db.execute({ sql: 'SELECT status, volumes_read, volumes FROM novel_favorites WHERE user_id = ? AND novel_id = ?', args: [req.user.id, d.novel_id] });
  const prev = existing.rows[0];
  if (!prev) {
    const count = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM novel_favorites WHERE user_id = ?', args: [req.user.id] });
    if (Number(count.rows[0].n) >= MAX_LIST) return res.status(429).json({ error: `You've hit the ${MAX_LIST}-novel limit.` });
  }
  const volumes = d.volumes !== undefined ? d.volumes : (prev?.volumes ?? null);
  let volumesRead = d.volumes_read ?? Number(prev?.volumes_read || 0);
  if (volumes) volumesRead = Math.min(volumesRead, Number(volumes));
  let status = 'status' in d ? d.status : (prev?.status ?? null);
  // Progress implies reading; reaching the last volume means finished.
  if (d.volumes_read !== undefined && volumesRead > 0 && (!status || status === 'plan_to_read')) status = 'reading';
  if (d.volumes_read !== undefined && volumes && volumesRead >= Number(volumes)) status = 'completed';
  await db.execute({
    sql: `INSERT INTO novel_favorites (user_id, novel_id, title, image, status, volumes_read, volumes) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, novel_id) DO UPDATE SET title = excluded.title, image = COALESCE(excluded.image, novel_favorites.image),
            status = excluded.status, volumes_read = excluded.volumes_read, volumes = excluded.volumes`,
    args: [req.user.id, d.novel_id, d.title, d.image || null, status, volumesRead, volumes],
  });
  res.json({ mine: { status, volumes_read: volumesRead, volumes } });
}));

novelsRouter.delete('/list/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid novel id.' });
  await db.execute({ sql: 'DELETE FROM novel_favorites WHERE user_id = ? AND novel_id = ?', args: [req.user.id, id] });
  res.status(204).end();
}));

// ---- Reviews: same behaviour as manga reviews ----

novelsRouter.get('/:id/reviews', asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid novel id.' });
  const [list, agg, mine] = await Promise.all([
    db.execute({
      sql: `SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.username
            FROM novel_reviews r JOIN users u ON u.id = r.user_id
            WHERE r.novel_id = ? AND r.hidden = 0 AND u.is_private = 0 ORDER BY r.updated_at DESC LIMIT 100`,
      args: [id],
    }),
    db.execute({ sql: 'SELECT AVG(rating) AS avg, COUNT(*) AS count FROM novel_reviews WHERE novel_id = ?', args: [id] }),
    req.user
      ? db.execute({ sql: 'SELECT rating, body FROM novel_reviews WHERE novel_id = ? AND user_id = ?', args: [id, req.user.id] })
      : { rows: [] },
  ]);
  const a = agg.rows[0];
  res.json({
    reviews: list.rows,
    average: a.avg != null ? Math.round(Number(a.avg) * 10) / 10 : null,
    count: Number(a.count),
    myReview: mine.rows[0] || null,
  });
}));

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(10),
  body: z.string().trim().max(2000).optional().or(z.literal('')),
});

novelsRouter.post('/:id/reviews', requireAuth, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid novel id.' });
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
  await db.execute({
    sql: `INSERT INTO novel_reviews (user_id, novel_id, rating, body, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, novel_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, updated_at = datetime('now')`,
    args: [req.user.id, id, parsed.data.rating, parsed.data.body || null],
  });
  res.status(201).json({ ok: true });
}));

novelsRouter.delete('/:id/reviews', requireAuth, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid novel id.' });
  await db.execute({ sql: 'DELETE FROM novel_reviews WHERE user_id = ? AND novel_id = ?', args: [req.user.id, id] });
  res.status(204).end();
}));

// ---- One novel, plus your own list entry when signed in ----

novelsRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid novel id.' });
  const novel = await cached(`novel:full:${id}`, 30 * 60 * 1000, () => persistentCached(`novel:full:v1:${id}`, 24 * 60 * 60 * 1000, async () => {
    const found = await sources.byId(id);
    // Thrown, not returned, so a missing or adult title is never stored or
    // served from an old copy (persistentCache treats a 404 as definitive).
    if (!found) throw Object.assign(new Error('Novel not found.'), { status: 404 });
    return found;
  }));
  let mine = null;
  if (req.user) {
    const row = (await db.execute({ sql: 'SELECT status, volumes_read, volumes FROM novel_favorites WHERE user_id = ? AND novel_id = ?', args: [req.user.id, id] })).rows[0];
    if (row) mine = { status: row.status || null, volumes_read: Number(row.volumes_read), volumes: row.volumes == null ? null : Number(row.volumes) };
  }
  res.json({ data: novel, mine });
}));

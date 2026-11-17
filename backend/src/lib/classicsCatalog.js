import { gunzipSync } from 'node:zlib';
import { logger } from './logger.js';

// AniNest's own copy of the Project Gutenberg catalog, so classics search
// and filters don't depend on a third-party API. Project Gutenberg publishes
// the whole catalog as one CSV file (refreshed weekly); it is downloaded at
// startup and once a day, and searched in memory.
// The whole catalog is kept in memory (~75k rows, tens of MB); it can move
// into SQLite with full-text search if the instance gets tight on memory.

const CATALOG_URL = 'https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz';
const TOP_URL = 'https://www.gutenberg.org/browse/scores/top';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const PAGE_SIZE = 32;
// Bookshelves that mark well-known works; they rank right after the current
// most-downloaded books.
const NOTABLE = /classics of literature|best books ever|harvard classics/i;

let catalog = null; // { books, loadedAt }

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines.
// Calls onRow(fields) for each row instead of building one big array.
export function parseCsv(text, onRow) {
  let row = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    let field;
    if (text[i] === '"') {
      let j = i + 1;
      for (;;) {
        j = text.indexOf('"', j);
        if (j < 0) { j = n; break; }
        if (text[j + 1] === '"') { j += 2; continue; }
        break;
      }
      field = text.slice(i + 1, j).replace(/""/g, '"');
      i = j + 1;
    } else {
      let j = i;
      while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    onRow(row);
    row = [];
  }
}

// A fresh copy of a substring, so the books don't keep the whole downloaded
// file alive through V8's sliced strings.
const own = (s) => Buffer.from(s, 'utf8').toString('utf8');

// "Shelley, Mary Wollstonecraft, 1797-1851" -> { name, born, died }.
// Illustrators, translators and editors ("... [Illustrator]") are left out.
function parseAuthor(s) {
  if (/\[[^\]]+\]\s*$/.test(s)) return null;
  const m = s.match(/^(.*?),\s*(\d{1,4})?\??(\s*BCE)?\s*-\s*(\d{1,4})?\??(\s*BCE)?$/);
  if (!m) return { name: s.trim(), born: null, died: null };
  const year = (v, bce) => (v ? Number(v) * (bce ? -1 : 1) : null);
  return { name: m[1].trim(), born: year(m[2], m[3]), died: year(m[4], m[5]) };
}

// CSV text -> books, ranked: the current top 100 first, then notable works,
// then the rest, each by ebook number.
export function buildCatalog(csvText, topIds = []) {
  const top = new Map(topIds.map((id, i) => [id, i]));
  const books = [];
  let col = null;
  parseCsv(csvText, (r) => {
    if (!col) { col = Object.fromEntries(r.map((h, i) => [h.trim(), i])); return; }
    if (r[col.Type] !== 'Text') return;
    const id = Number(r[col['Text#']]);
    if (!Number.isInteger(id) || id <= 0) return;
    const title = own((r[col.Title] || '').replace(/\s*\n\s*/g, ': ').trim());
    const authors = (r[col.Authors] || '').split(/;\s*/).filter(Boolean).map(parseAuthor).filter(Boolean)
      .map((a) => ({ ...a, name: own(a.name) }));
    const subjects = r[col.Subjects] || '';
    const shelves = r[col.Bookshelves] || '';
    books.push({
      id,
      title,
      authors,
      subjects: subjects.split(/;\s*/).map((s) => s.split(' -- ')[0]).filter((s, i, a) => s && a.indexOf(s) === i).slice(0, 6).map(own),
      langs: (r[col.Language] || '').split(/;\s*/).map(own),
      rank: top.has(id) ? top.get(id) : NOTABLE.test(shelves) ? 1000 : 2000,
      key: own(`${title} ${authors.map((a) => a.name).join(' ')}`.toLowerCase()),
      topics: own(`${subjects} ${shelves}`.toLowerCase()),
    });
  });
  books.sort((a, b) => a.rank - b.rank || a.id - b.id);
  return books;
}

// The same shape the Gutendex list produced (see catalogEntry in classics.js).
function cardEntry(b) {
  return {
    id: b.id,
    title: b.title,
    authors: b.authors.map((a) => a.name),
    years: b.authors.map((a) => [a.born, a.died].filter((y) => y != null).join('–')).filter(Boolean),
    image: `https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}.cover.medium.jpg`,
    summary: null,
    subjects: b.subjects,
    downloads: 0,
    readable: true,
    sourceUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
  };
}

// Same meaning as Gutendex's filters: every word of `q` in the title or an
// author's name; `topic` in a subject or bookshelf; an author alive at some
// point between `yearStart` and `yearEnd`. Returns null until the catalog
// has loaded.
export function searchCatalog({ q = '', topic = '', yearStart = null, yearEnd = null, lang = 'en', page = 1 }) {
  if (!catalog) return null;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const alive = (a) => (a.born != null || a.died != null)
    && (yearEnd == null || (a.born ?? a.died) <= yearEnd)
    && (yearStart == null || (a.died ?? a.born) >= yearStart);
  const hits = catalog.books.filter((b) => b.langs.includes(lang)
    && terms.every((t) => b.key.includes(t))
    && (!topic || b.topics.includes(topic))
    && (yearStart == null && yearEnd == null ? true : b.authors.some(alive)));
  const start = (page - 1) * PAGE_SIZE;
  return {
    count: hits.length,
    hasNext: start + PAGE_SIZE < hits.length,
    data: hits.slice(start, start + PAGE_SIZE).map(cardEntry),
  };
}

// One book's list entry, or null (not in the catalog, or not loaded yet).
export function catalogBook(id) {
  const b = catalog?.books.find((x) => x.id === Number(id));
  return b ? cardEntry(b) : null;
}

export function setCatalog(csvText, topIds) {
  catalog = csvText == null ? null : { books: buildCatalog(csvText, topIds), loadedAt: Date.now() };
}

export function catalogStatus() {
  return catalog ? { books: catalog.books.length, loadedAt: catalog.loadedAt } : null;
}

const get = (url) => fetch(url, {
  headers: { 'User-Agent': 'AniNest/1.0 (+https://github.com/MaXiMo000/AniNest)' },
  signal: AbortSignal.timeout(120000),
});

async function topIds() {
  try {
    const html = await (await get(TOP_URL)).text();
    const section = html.split('id="books-last30"')[1]?.split('<h2')[0] || '';
    return [...new Set([...section.matchAll(/href="\/ebooks\/(\d+)"/g)].map((m) => Number(m[1])))];
  } catch {
    return []; // ranking only; the catalog works without it
  }
}

export async function refreshCatalog() {
  const res = await get(CATALOG_URL);
  if (!res.ok) throw new Error(`catalog download failed: ${res.status}`);
  const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  setCatalog(csv, await topIds());
  logger.info({ books: catalog.books.length }, 'classics catalog loaded');
}

// Load now and then daily; a failed load keeps the previous copy, and until
// the first load finishes the classics route falls back to Gutendex. A failed
// load is retried after RETRY_MS, since gutenberg.org has maintenance windows.
export function startCatalog() {
  let timer;
  const run = () => refreshCatalog()
    .then(() => { timer = setTimeout(run, REFRESH_MS); })
    .catch((err) => {
      logger.warn({ err }, 'classics catalog load failed');
      timer = setTimeout(run, RETRY_MS);
    })
    .finally(() => timer?.unref());
  run();
}

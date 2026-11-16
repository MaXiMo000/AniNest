import { logger } from './logger.js';

// Public-domain books read inside AniNest. The catalog record comes from
// Gutendex and the text from gutenberg.org; only books Gutendex marks as out
// of copyright (in the US) are served. The Project Gutenberg header and
// license footer are removed, so the text is served as plain public-domain
// text with a link back to its source.

const MAX_BYTES = 5 * 1024 * 1024;   // the longest novels (War and Peace) are about 3.3 MB
const MIN_SECTION_WORDS = 150;   // shorter "chapters" are contents lists or stray headings
const MAX_PART_WORDS = 9000;     // longer chapters are split so a part loads quickly
const PAGE_WORDS = 4000;         // used when no chapter headings are found
const CACHE_BOOKS = 6;           // parsed books kept in memory; at most ~60 MB

const META_TIMEOUT_MS = 6000;    // Gutendex sometimes hangs; gutenberg.org is tried next
const TEXT_TIMEOUT_MS = 25000;

const realFetch = (url, ms = TEXT_TIMEOUT_MS) => fetch(url, {
  headers: { 'User-Agent': 'AniNest/1.0 (+https://github.com/MaXiMo000/AniNest)' },
  signal: AbortSignal.timeout(ms),
});
let fetcher = realFetch;
// Test hook: the suite never calls Gutendex or gutenberg.org.
export function setClassicsFetcher(fn) {
  fetcher = fn || realFetch;
}

const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|the\\s+\\w+';
const HEADING = new RegExp(`^(chapter|book|part|volume|letter|stave|act|adventure|canto|section|epilogue|prologue)(\\s+([0-9]+|[ivxlcdm]+|${NUMBER_WORDS}))?\\b[.:]?`, 'i');
const ROMAN_TITLE = /^[IVXLC]+\.?(\s+[A-Z0-9][A-Z0-9'’",.:;!?() -]*)?$/;

const words = (s) => (s.match(/\S+/g) || []).length;

function isHeading(paragraph) {
  const first = paragraph.split('\n')[0].trim();
  if (paragraph.length > 140 || first.length > 80) return false;
  return HEADING.test(first) || ROMAN_TITLE.test(first);
}

// The book's own table of contents: a "Contents" line, or a block of 3+
// short lines that mostly start like chapter headings. The reader has its
// own chapter list, so these are dropped.
const CONTENTS_LINE = /^(chapter|letter|book|part|volume|stave|act|[ivxlc]+\.|\d+\.)/i;
function isContentsBlock(p) {
  if (/^(table of )?contents\.?$/i.test(p)) return true;
  const lines = p.split('\n');
  return lines.length >= 3
    && lines.every((l) => l.length < 80)
    && lines.filter((l) => CONTENTS_LINE.test(l)).length >= lines.length * 0.8;
}

// Plain text to parts: [{ title, paragraphs }]. Pure, so it can be tested on
// fixture text.
export function parseBook(raw) {
  let text = raw.replace(/\r\n?/g, '\n');
  const start = text.search(/^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG.*$/im);
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1);
  const end = text.search(/^\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/im);
  if (end >= 0) text = text.slice(0, end);

  const paragraphs = text.split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).join('\n').trim())
    .filter((p) => p && !/^\[Illustration/i.test(p) && !isContentsBlock(p));

  // A contents list repeats the real headings in a tight cluster. A heading
  // that appears again later AND sits within a few words of another heading
  // is such an entry and doesn't start a section. (Numbered sections that
  // repeat per story, "I." / "II.", are kept: they have text around them.)
  const key = (p) => p.split('\n')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const headingAt = paragraphs.map((p, i) => (isHeading(p) ? i : -1)).filter((i) => i >= 0);
  const gap = (a, b) => words(paragraphs.slice(a + 1, b).join(' '));
  const skip = new Set();
  headingAt.forEach((i, n) => {
    const dense = (n > 0 && gap(headingAt[n - 1], i) < 40) || (n < headingAt.length - 1 && gap(i, headingAt[n + 1]) < 40);
    const repeated = headingAt.slice(n + 1).some((j) => key(paragraphs[j]) === key(paragraphs[i]));
    if (dense && repeated) skip.add(i);
  });

  // Sections start at each heading; the heading's lines become the title.
  let sections = [{ title: null, paragraphs: [] }];
  for (const [i, p] of paragraphs.entries()) {
    if (skip.has(i)) continue;
    if (isHeading(p)) sections.push({ title: p.replace(/\n+/g, ' — ').replace(/[\]_]/g, '').trim(), paragraphs: [] });
    else sections[sections.length - 1].paragraphs.push(p.replace(/\n/g, ' ').replace(/_([^_]+)_/g, '$1'));
  }

  // A contents list produces a run of headings with almost nothing between
  // them: fold each short section into the next one.
  const merged = [];
  let carry = [];
  let carryTitle = null;
  for (const s of sections) {
    const all = [...carry, ...s.paragraphs];
    if (words(all.join(' ')) < MIN_SECTION_WORDS) { carry = all; carryTitle = carryTitle || s.title; continue; }
    // A story title right before its first numbered section: keep both.
    const title = carryTitle && s.title && carryTitle !== s.title ? `${carryTitle} · ${s.title}` : (s.title || carryTitle);
    merged.push({ title, paragraphs: all });
    carry = [];
    carryTitle = null;
  }
  if (carry.length && merged.length) merged[merged.length - 1].paragraphs.push(...carry);
  sections = merged;

  if (sections.filter((s) => s.title).length < 3) {
    const all = sections.flatMap((s) => s.paragraphs);
    sections = [{ title: null, paragraphs: all }];
  }

  const parts = [];
  for (const s of sections) {
    const limit = s.title ? MAX_PART_WORDS : PAGE_WORDS;
    const chunks = [[]];
    let count = 0;
    for (const p of s.paragraphs) {
      const n = words(p);
      if (count + n > limit && chunks[chunks.length - 1].length) { chunks.push([]); count = 0; }
      chunks[chunks.length - 1].push(p);
      count += n;
    }
    chunks.forEach((c, i) => {
      if (!s.title && sections.length === 1) { parts.push({ title: `Part ${parts.length + 1}`, paragraphs: c }); return; }
      const base = s.title || 'Opening';
      parts.push({ title: chunks.length > 1 ? `${base} (${i + 1}/${chunks.length})` : base, paragraphs: c });
    });
  }
  return parts.filter((p) => p.paragraphs.length).map((p) => ({ ...p, words: words(p.paragraphs.join(' ')) }));
}

const textUrl = (formats = {}) => {
  const key = Object.keys(formats).find((k) => k.startsWith('text/plain') && !String(formats[k]).endsWith('.zip'));
  return key ? formats[key] : null;
};

export function catalogEntry(b) {
  return {
    id: Number(b.id),
    title: b.title,
    authors: (b.authors || []).map((a) => a.name),
    years: (b.authors || []).map((a) => [a.birth_year, a.death_year].filter(Boolean).join('–')).filter(Boolean),
    image: b.formats?.['image/jpeg'] || null,
    summary: (b.summaries || [])[0]?.replace(/\s*\(This is an automatically generated summary\.\)\s*$/, '') || null,
    subjects: (b.subjects || []).map((s) => s.split(' -- ')[0]).filter((s, i, a) => a.indexOf(s) === i).slice(0, 6),
    downloads: b.download_count || 0,
    readable: b.copyright === false && Boolean(textUrl(b.formats)),
    sourceUrl: `https://www.gutenberg.org/ebooks/${Number(b.id)}`,
  };
}

// gutenberg.org's own RDF record, reshaped like a Gutendex record so
// catalogEntry reads both. Used when Gutendex is down.
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const tagValues = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`, 'g'))].map((m) => decode(m[1]).trim());
const blocks = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);

export function rdfRecord(id, xml) {
  const files = [...xml.matchAll(/<pgterms:file rdf:about="([^"]+)"/g)].map((m) => decode(m[1]));
  const text = files.find((u) => u.endsWith('.txt.utf-8')) || files.find((u) => /\.txt$/.test(u));
  const cover = files.find((u) => u.endsWith('.cover.medium.jpg'));
  const year = (v) => (v ? Number(v) : null);
  return {
    id,
    title: tagValues(xml, 'dcterms:title')[0]?.replace(/\s+/g, ' ') || `Book ${id}`,
    authors: blocks(xml, 'dcterms:creator').map((b) => ({
      name: tagValues(b, 'pgterms:name')[0],
      birth_year: year(tagValues(b, 'pgterms:birthdate')[0]),
      death_year: year(tagValues(b, 'pgterms:deathdate')[0]),
    })).filter((a) => a.name),
    summaries: tagValues(xml, 'pgterms:marc520'),
    subjects: blocks(xml, 'dcterms:subject').flatMap((b) => tagValues(b, 'rdf:value')),
    download_count: Number(tagValues(xml, 'pgterms:downloads')[0]) || 0,
    copyright: !/^public domain in the usa/i.test(tagValues(xml, 'dcterms:rights')[0] || ''),
    formats: { ...(text ? { 'text/plain; charset=utf-8': text } : {}), ...(cover ? { 'image/jpeg': cover } : {}) },
  };
}

async function loadRecord(id) {
  try {
    const res = await fetcher(`https://gutendex.com/books/${id}/`, META_TIMEOUT_MS);
    if (res.status === 404) throw Object.assign(new Error('Book not found.'), { status: 404 });
    if (res.ok) return await res.json();
  } catch (err) {
    if (err.status === 404) throw err;
  }
  const res = await fetcher(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.rdf`, META_TIMEOUT_MS * 2);
  if (res.status === 404) throw Object.assign(new Error('Book not found.'), { status: 404 });
  if (!res.ok) throw Object.assign(new Error('Project Gutenberg unavailable'), { status: 502 });
  return rdfRecord(id, await res.text());
}

const books = new Map(); // id -> Promise<{ meta, parts }>, most recent last

async function loadBook(id) {
  const record = await loadRecord(id);
  const meta = catalogEntry(record);
  if (!meta.readable) throw Object.assign(new Error('This book can’t be read here.'), { status: 404 });

  const textRes = await fetcher(textUrl(record.formats));
  if (!textRes.ok) throw Object.assign(new Error('Book text unavailable'), { status: 502 });
  const raw = await textRes.text();
  if (raw.length > MAX_BYTES) throw Object.assign(new Error('This book is too long to read here.'), { status: 404 });
  const parts = parseBook(raw);
  if (!parts.length) throw Object.assign(new Error('This book has no readable text.'), { status: 404 });
  return { meta, parts };
}

// One parsed book, kept in memory for the next pages. A failed load is not kept.
export function getBook(id) {
  if (books.has(id)) {
    const hit = books.get(id);
    books.delete(id);
    books.set(id, hit);
    return hit;
  }
  const p = loadBook(id).catch((err) => {
    books.delete(id);
    if (!err.status) logger.warn({ err, id }, 'classic book load failed');
    throw err;
  });
  books.set(id, p);
  while (books.size > CACHE_BOOKS) books.delete(books.keys().next().value);
  return p;
}

export function clearBooks() {
  books.clear();
}

import { gunzipSync } from 'node:zlib';

// Reads a MyAnimeList anime list export (Profile > Export, which downloads
// animelist_*.xml.gz) or our own MAL-format export (lib/listExport.js).
// The format is flat and fixed, so a regex per <anime> block is enough.

// On-Hold has no equivalent here; like AniList's PAUSED it becomes a plain heart.
const MAL_TO_STATUS = {
  Watching: 'watching',
  Completed: 'completed',
  Dropped: 'dropped',
  'Plan to Watch': 'plan_to_watch',
  'On-Hold': null,
};
const MAX_XML_BYTES = 30 * 1024 * 1024;
const MAX_ENTRIES = 5000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
});

function tag(block, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  if (!m) return '';
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return (cdata ? cdata[1] : decode(m[1])).trim();
}

// Buffer (gzipped or not) -> [{ mal_id, title, type, status, episodes,
// episodes_watched, my_score }], or null if it isn't a MAL anime list.
export function parseMalXml(buf) {
  let xml;
  try {
    const bytes = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf, { maxOutputLength: MAX_XML_BYTES }) : buf;
    xml = bytes.toString('utf8');
  } catch {
    return null;
  }
  if (!/<myanimelist>/.test(xml)) return null;
  const seen = new Set();
  const entries = [];
  for (const [block] of xml.matchAll(/<anime>[\s\S]*?<\/anime>/g)) {
    if (entries.length >= MAX_ENTRIES) break;
    const malId = Number(tag(block, 'series_animedb_id'));
    if (!Number.isInteger(malId) || malId <= 0 || seen.has(malId)) continue;
    seen.add(malId);
    const episodes = Number(tag(block, 'series_episodes')) || null;
    const watched = Math.max(0, Math.min(5000, Number(tag(block, 'my_watched_episodes')) || 0));
    const score = Number(tag(block, 'my_score'));
    const status = tag(block, 'my_status');
    entries.push({
      mal_id: malId,
      title: tag(block, 'series_title') || 'Untitled',
      type: tag(block, 'series_type') || 'TV',
      status: MAL_TO_STATUS[status] ?? null,
      episodes,
      episodes_watched: episodes ? Math.min(watched, episodes) : watched,
      my_score: Number.isInteger(score) && score >= 1 && score <= 10 ? score : null,
    });
  }
  return entries;
}

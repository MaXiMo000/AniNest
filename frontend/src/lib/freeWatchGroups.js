// Pure grouping logic for the "Watch Free (Official)" list - deliberately
// import-free (no DOM, no other modules) so it can be unit-tested directly by
// the backend's test runner (backend/test/api.test.js imports it).
//
// Input is the rows from GET /api/anime/:id/watch-sources; the only structure
// they carry is the label the importer wrote, e.g. "Episode 12 · English Sub",
// "Complete Series · English Sub" or a bare "Episode 5" (older rows). That is
// enough to group by language version and, for long runs, split into ranges.
// Each anime page is already one MAL entry (one season/part), so there is no
// separate season field to group on - ranges are how a 35-episode run stays
// scannable.

const LANG_ORDER = ['English Sub', 'English Dub', 'Sub', 'Dub', 'Chinese subs'];
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseSourceLabel(label) {
  const text = String(label || '');
  const [base, langRaw] = text.split(' · ');
  const lang = (langRaw || '').trim() || 'Other';
  if (/^complete/i.test(base)) return { kind: 'complete', episode: null, lang, base };
  const m = /Episode\s+(\d+)/i.exec(base);
  if (m) return { kind: 'episode', episode: Number(m[1]), lang, base };
  return { kind: 'other', episode: null, lang, base };
}

function langRank(lang) {
  const i = LANG_ORDER.indexOf(lang);
  return i === -1 ? LANG_ORDER.length : i;
}

// Returns { languages: [{ lang, count, groups: [{ title|null, items }] }], defaultLang }.
// Within a language: "Complete Series" uploads first, then episodes ascending
// (split into ranges of `chunkSize` once there are more than `chunkThreshold`),
// then anything without an episode number.
export function groupSources(sources, { chunkSize = 12, chunkThreshold = 24 } = {}) {
  const byLang = new Map();
  for (const s of sources) {
    if (!YT_ID_RE.test(s.youtube_video_id)) continue;
    const parsed = parseSourceLabel(s.label);
    if (!byLang.has(parsed.lang)) byLang.set(parsed.lang, []);
    byLang.get(parsed.lang).push({ ...s, parsed });
  }

  const languages = [...byLang.entries()]
    .sort((a, b) => langRank(a[0]) - langRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([lang, items]) => {
      const complete = items.filter((i) => i.parsed.kind === 'complete');
      const episodes = items.filter((i) => i.parsed.kind === 'episode')
        .sort((a, b) => a.parsed.episode - b.parsed.episode || (a.channel_name || '').localeCompare(b.channel_name || ''));
      const other = items.filter((i) => i.parsed.kind === 'other');

      const groups = [];
      if (complete.length) groups.push({ title: 'Complete series', items: complete });
      if (episodes.length <= chunkThreshold) {
        if (episodes.length) groups.push({ title: complete.length || other.length ? 'Episodes' : null, items: episodes });
      } else {
        for (let i = 0; i < episodes.length; i += chunkSize) {
          const chunk = episodes.slice(i, i + chunkSize);
          const first = chunk[0].parsed.episode;
          const last = chunk[chunk.length - 1].parsed.episode;
          groups.push({ title: first === last ? `Episode ${first}` : `Episodes ${first}–${last}`, items: chunk });
        }
      }
      if (other.length) groups.push({ title: 'Other', items: other });
      return { lang, count: items.length, groups };
    });

  return { languages, defaultLang: languages[0]?.lang || null };
}

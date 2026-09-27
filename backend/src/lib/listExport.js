// Pure formatters for "export my list" (routes/export.js). No database here,
// so the tests can feed rows straight in.
//
// Rows are favorites joined with the user's own review:
//   { mal_id, title, type, status, episodes, episodes_watched, added_at,
//     score (the show's community score), my_rating, my_review }

// Our status -> MyAnimeList's import vocabulary. A favorite with no status is
// a plain heart: "Watching" if progress was logged, otherwise "Plan to Watch",
// since MAL rejects an entry without one.
const MAL_STATUS = {
  watching: 'Watching',
  completed: 'Completed',
  dropped: 'Dropped',
  plan_to_watch: 'Plan to Watch',
};

export function malStatus(row) {
  return MAL_STATUS[row.status] || (Number(row.episodes_watched) > 0 ? 'Watching' : 'Plan to Watch');
}

// ---- CSV ----

export const CSV_COLUMNS = [
  'mal_id', 'title', 'type', 'status', 'episodes_watched', 'episodes',
  'my_rating', 'my_review', 'added_at',
];

// RFC 4180 quoting, plus a leading ' on text that a spreadsheet would run as a
// formula (=, +, -, @, tab, CR). Numbers are written as-is.
export function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
  // CRLF per RFC 4180; the BOM makes Excel read the file as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---- MyAnimeList XML ----

// Characters XML 1.0 forbids outright (most C0 controls, lone surrogates,
// U+FFFE/U+FFFF) are dropped; MAL's importer rejects the whole file otherwise.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/g;

export function xmlText(value) {
  return String(value ?? '').replace(XML_INVALID, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// CDATA can't contain "]]>", so that sequence is split across two sections.
export function cdata(value) {
  const text = String(value ?? '').replace(XML_INVALID, '');
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

const intOr0 = (v) => (Number.isFinite(Number(v)) && v != null ? Math.max(0, Math.trunc(Number(v))) : 0);

// The shape MAL's own export produces and its importer
// (myanimelist.net/import.php, "MyAnimeList Import") reads. update_on_import=1
// lets a re-import overwrite entries already on the MAL list.
export function toMalXml(rows, { username = '' } = {}) {
  const valid = rows.filter((r) => Number.isInteger(Number(r.mal_id)) && Number(r.mal_id) > 0);
  const count = (s) => valid.filter((r) => malStatus(r) === s).length;
  const entries = valid.map((r) => `
  <anime>
    <series_animedb_id>${Number(r.mal_id)}</series_animedb_id>
    <series_title>${cdata(r.title)}</series_title>
    <series_type>${xmlText(r.type || '')}</series_type>
    <series_episodes>${intOr0(r.episodes)}</series_episodes>
    <my_id>0</my_id>
    <my_watched_episodes>${intOr0(r.episodes_watched)}</my_watched_episodes>
    <my_start_date>0000-00-00</my_start_date>
    <my_finish_date>0000-00-00</my_finish_date>
    <my_rated></my_rated>
    <my_score>${Math.min(10, intOr0(r.my_rating))}</my_score>
    <my_storage></my_storage>
    <my_storage_value>0.00</my_storage_value>
    <my_status>${malStatus(r)}</my_status>
    <my_comments>${cdata(r.my_review || '')}</my_comments>
    <my_times_watched>0</my_times_watched>
    <my_rewatch_value></my_rewatch_value>
    <my_priority>LOW</my_priority>
    <my_tags>${cdata('')}</my_tags>
    <my_rewatching>0</my_rewatching>
    <my_rewatching_ep>0</my_rewatching_ep>
    <my_discuss>1</my_discuss>
    <my_sns>default</my_sns>
    <update_on_import>1</update_on_import>
  </anime>`).join('');

  return `<?xml version="1.0" encoding="UTF-8" ?>
<!-- Exported from AniNest. Import at https://myanimelist.net/import.php (choose "MyAnimeList Import"). -->
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>${xmlText(username)}</user_name>
    <user_export_type>1</user_export_type>
    <user_total_anime>${valid.length}</user_total_anime>
    <user_total_watching>${count('Watching')}</user_total_watching>
    <user_total_completed>${count('Completed')}</user_total_completed>
    <user_total_onhold>0</user_total_onhold>
    <user_total_dropped>${count('Dropped')}</user_total_dropped>
    <user_total_plantowatch>${count('Plan to Watch')}</user_total_plantowatch>
  </myinfo>${entries}
</myanimelist>
`;
}

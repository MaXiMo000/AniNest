// Turns a real YouTube upload title into structured data (series, season,
// episode, language) and matches the series to a MAL id via AniList. Used only
// by the admin bulk-import (routes/adminWatchSources.js) - nothing here writes
// to the database; the caller decides what to do with a match or a miss.
//
// Written against the real title shapes on the curated channels, e.g.
//   "Fairy Tail - Episode 008 (S1E08) [English Dub]"
//   "Re:ZERO -Starting Life in Another World- Season 4 | Episode 16 (EP82) [English Sub]"
//   "Complete SeriesMade in Abyss (S1)"
//   "《幼女戰記 2》#12 (繁中字幕 | 日語原聲)【Ani-One Asia】"
// and, just as importantly, the many things that are NOT episodes (PVs, CMs,
// teasers, vlogs, "Preview of Episode 84", ...) which must never be guessed
// into a series.
import { anilistFindCandidates } from './anilist.js';

// Anything that is promo/extra content rather than the episode itself.
const NEGATIVE = /\b(pv\d*|teaser|trailer|preview|promo|cm\d*|commemoration|greeting|recap|highlights?|interview|making of|behind the scenes|announcement|on live|live stream|opening|ending theme|theme song|music video|clip)\b|專訪|预告|預告|花絮|訪談/i;

function languageTag(t) {
  if (/english\s*dub/i.test(t)) return 'English Dub';
  if (/(english|eng)\s*sub/i.test(t)) return 'English Sub';
  if (/繁中字幕/.test(t)) return 'Chinese subs';
  if (/\bdub\b/i.test(t)) return 'Dub';
  if (/\bsub\b/i.test(t)) return 'Sub';
  return null;
}

const EPISODE_PATTERNS = [
  /\bEpisode\s*#?\s*(\d{1,4})\b/i,
  /\bEP\.?\s*#?\s*(\d{1,4})\b/i,
  /第\s*(\d{1,4})\s*[話话集]/,
  /\bE(\d{1,4})\b/i,
  /#\s*(\d{1,4})\b/,
];

const BRACKETS = /[[(【「『][^\])】」』]*[\])】」』]/g;

// What's left after an episode marker must be nothing but tags/brackets/
// separators. If real words remain ("Episode 25? Answering questions that we
// get 273 times daily") it's a vlog/extra, not the episode.
function isJustTags(text) {
  const rest = text
    .replace(BRACKETS, ' ')
    .replace(/\bS\d{1,2}\s*E\d{1,4}\b/gi, ' ')
    .replace(/\b(dub|sub|english|eng|multi|full episode|hd|official|ani-?one( asia)?|muse( asia)?|crunchyroll)\b/gi, ' ')
    .replace(/[\s\-|:–—·•,.!?/]+/g, ' ');
  return (rest.match(/[\p{L}\p{N}]/gu) || []).length < 3;
}

function stripSeason(text) {
  let season = null;
  let out = text;
  const patterns = [
    /\bSeason\s*(\d{1,2})\b/i,
    /\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i,
    /\(S(\d{1,2})\)/i,
  ];
  for (const re of patterns) {
    const m = out.match(re);
    if (m) {
      season = Number(m[1]);
      out = out.replace(re, ' ');
      break;
    }
  }
  return { season, text: out };
}

function cleanSeries(text) {
  const cjk = /《([^》]+)》/.exec(text);
  let s = cjk ? cjk[1] : text.replace(BRACKETS, ' ');
  s = s.replace(/\b(Muse Asia|Ani-?One( Asia)?|Crunchyroll)\b/gi, ' ');
  s = s.replace(/\s{2,}/g, ' ').replace(/^[\s\-|:–—]+|[\s\-|:–—]+$/g, '').trim();
  return s;
}

// Returns null for anything that isn't a full episode / complete-series
// upload. Otherwise { kind, series, season, episode, lang, label, groupKey }.
export function parseUploadTitle(rawTitle) {
  const raw = String(rawTitle || '').normalize('NFKC').trim();
  if (!raw || NEGATIVE.test(raw)) return null;
  const lang = languageTag(raw);

  const complete = /^\s*[【\[(]?\s*complete\s*(series|arc)\s*[】\])]?\s*[:\-–|]*\s*(.+)$/i.exec(raw);
  let kind;
  let seriesRaw;
  let episode = null;
  let seasonFromEp = null;

  if (complete) {
    kind = complete[1].toLowerCase() === 'arc' ? 'arc' : 'complete';
    seriesRaw = complete[2];
  } else {
    let marker = null;
    for (const re of EPISODE_PATTERNS) {
      const m = re.exec(raw);
      if (m) { marker = m; break; }
    }
    if (!marker) return null;
    const trailing = raw.slice(marker.index + marker[0].length);
    if (!isJustTags(trailing)) return null;
    seriesRaw = raw.slice(0, marker.index);
    episode = Number(marker[1]);
    kind = 'episode';
    // "(S3E12)" is per-season numbering and is what MAL/AniList entries
    // (one per season) actually correspond to, unlike a running "EP36".
    const se = /\bS(\d{1,2})\s*E(\d{1,4})\b/i.exec(raw);
    if (se) { seasonFromEp = Number(se[1]); episode = Number(se[2]); }
  }

  const { season: seasonInName, text } = stripSeason(seriesRaw);
  const series = cleanSeries(text);
  if (!series || (series.match(/[\p{L}\p{N}]/gu) || []).length < 2) return null;

  const season = seasonFromEp ?? seasonInName;
  const label = kind === 'complete' ? 'Complete Series'
    : kind === 'arc' ? 'Complete Arc'
      : `Episode ${episode}`;

  return {
    kind,
    series,
    season,
    episode,
    lang,
    label: lang ? `${label} · ${lang}` : label,
    groupKey: `${normalize(series)}|${season || 1}|${kind === 'episode' ? 'ep' : kind}`,
  };
}

export function normalize(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// The form titles are COMPARED in: normalized, with the word "the" and all
// spacing removed. Upload titles and AniList's spellings differ in exactly
// these trivial ways ("Ace of Diamond Act II" vs "Ace of the Diamond act
// II"; "actII" vs "act II") and none of them changes which show it is.
// Still strict equality - no substring/prefix matching - so a spin-off or a
// different season can't slip through.
export function looseKey(s) {
  return normalize(s).replace(/\bthe\b/g, ' ').replace(/\s+/g, '');
}

const ORDINALS = { 2: '2nd', 3: '3rd' };
const ordinal = (n) => ORDINALS[n] || `${n}th`;

// The exact set of normalized titles that count as "this series, this
// season". Season 1 (or unspecified) accepts the bare name; any later season
// accepts ONLY season-qualified forms - the bare name would be season 1, and
// silently attaching season 3's episodes to season 1's page is the failure
// this whole strict scheme exists to prevent.
export function acceptedTitles(series, season) {
  const base = series;
  if (!season || season === 1) return new Set([looseKey(base)]);
  return new Set([
    looseKey(`${base} season ${season}`),
    looseKey(`${base} ${ordinal(season)} season`),
    looseKey(`${base} ${season}`),
  ]);
}

const TV_FORMATS = new Set(['TV', 'TV_SHORT']);

// Exact equality against ANY of a candidate's titles or synonyms - never a
// substring/containment test ("Ascendance of a Bookworm" is contained in
// "Ascendance of a Bookworm Side Story", and is not that show). Among several
// exact hits prefer TV, then the most popular.
export function pickBestCandidate(candidates, series, season) {
  const accepted = acceptedTitles(series, season);
  const hits = candidates.filter((c) => c.titles.some((t) => accepted.has(looseKey(t))));
  if (!hits.length) return null;
  hits.sort((a, b) => (Number(TV_FORMATS.has(b.format)) - Number(TV_FORMATS.has(a.format))) || (b.popularity - a.popularity));
  return hits[0];
}

// Resolves to { malId, title } or null (a definitive "no confident match").
// Network/rate-limit errors are deliberately NOT caught: the caller must be
// able to tell "AniList said no" from "AniList couldn't answer" and retry the
// latter later instead of queueing it as unmatched.
export async function matchSeries({ series, season }) {
  const query = season && season > 1 ? `${series} Season ${season}` : series;
  const candidates = await anilistFindCandidates(query);
  const best = pickBestCandidate(candidates, series, season);
  return best ? { malId: best.malId, title: best.displayTitle } : null;
}

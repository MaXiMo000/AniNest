// Turns a real YouTube upload title (e.g. "Mushoku Tensei Episode 12 [ENG
// SUB] | Muse Asia") into a best-guess series title + episode label, then
// matches that guess against AniNest's own anime search (the same Jikan/
// AniList proxy every other page uses - lib/animeSource.js) to find the
// MAL id it belongs to. Used only by the admin bulk-import action
// (routes/adminWatchSources.js) - never inserts anything itself, just
// reports a guess + confidence so the caller decides what to do with it.
import * as animeSource from './animeSource.js';

const EPISODE_PATTERNS = [
  /\bepisode\s*#?\s*(\d{1,4})\b/i,
  /\bep\.?\s*#?\s*(\d{1,4})\b/i,
  /\be(\d{1,4})\b/i,
  /[-|]\s*(\d{1,4})\s*$/,
  /#(\d{1,4})\b/,
];

// Strips bracketed/parenthesized tags (subs, quality, sponsor/official
// marks) and a trailing channel-name suffix, then pulls out an episode
// number if the title actually has one - a title with NO episode marker at
// all is treated as "not a real episode upload" (trailer, short, AMV,
// announcement) and the caller skips it entirely; this is the main filter
// keeping non-episode content out of the bulk-import results.
export function extractSeriesGuess(rawTitle) {
  let title = String(rawTitle || '').replace(/[[(][^\])]{1,40}[\])]/g, ' ');

  let episodeLabel = null;
  for (const re of EPISODE_PATTERNS) {
    const m = title.match(re);
    if (m) {
      episodeLabel = `Episode ${m[1]}`;
      title = title.slice(0, m.index) + title.slice(m.index + m[0].length);
      break;
    }
  }
  if (!episodeLabel) return { seriesGuess: null, episodeLabel: null };

  title = title.replace(/[-|:]+\s*(Muse Asia|Ani-?One Asia|Crunchyroll)\b.*$/i, '');
  title = title.replace(/\s{2,}/g, ' ').replace(/[-|:]\s*$/, '').trim();

  return { seriesGuess: title || null, episodeLabel };
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Deliberately conservative - a false "confident" match means a wrong
// anime's page gets someone else's episode embedded on it, which is worse
// than just skipping a video and leaving it for manual review. Exact
// normalized equality, or one title fully containing the other with
// comparable length, only.
function isConfidentMatch(guess, candidateTitle) {
  const a = normalize(guess);
  const b = normalize(candidateTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  return (a.includes(b) || b.includes(a)) && shorter >= longer * 0.65;
}

// Returns null (no confident match - caller should skip/report it) or
// { malId, title, image } for the best match.
export async function matchToAnime(seriesGuess) {
  if (!seriesGuess) return null;
  try {
    const { data } = await animeSource.search({ q: seriesGuess, page: 1 });
    const top = (data || [])[0];
    if (!top) return null;
    const title = top.title || top.title_english;
    if (!isConfidentMatch(seriesGuess, title) && !isConfidentMatch(seriesGuess, top.title_english || '')) return null;
    return { malId: top.mal_id, title, image: top.images?.jpg?.image_url || top.images?.webp?.image_url || '' };
  } catch {
    return null;
  }
}

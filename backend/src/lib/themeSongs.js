// Parses MyAnimeList's opening/ending strings (Jikan /anime/:id/themes) into
// the same track shape lib/animeThemes.js returns, minus the video. Used as
// the jukebox fallback when AnimeThemes.moe is down: the song list still
// shows, with listen-elsewhere links instead of a player. Pure, no imports,
// so the tests can feed it real string shapes directly.
//
// Shapes seen in the wild:
//   1: "Again" by YUI (eps 1-14)
//   "Hologram" by NICO Touches the Walls (eps 15-26)
//   2: "Guren no Yumiya (紅蓮の弓矢)" by Linked Horizon (eps 1-13, 25)
//   "Kaikai Kitan" by Eve
export function parseThemeSong(raw, type, index) {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  const episodes = /\s*\((eps?\s[^)]*)\)\s*$/i.exec(text);
  if (episodes) text = text.slice(0, episodes.index).trim();

  const match = /^(?:(\d+)\s*:\s*)?"(.+)"\s*(?:by\s+(.+))?$/.exec(text);
  const number = match?.[1] ? Number(match[1]) : index + 1;
  const title = (match ? match[2] : text.replace(/^\d+\s*:\s*/, '')).trim();
  if (!title) return null;
  return {
    slug: `${type}${number}`,
    type,
    title,
    artist: match?.[3]?.trim() || null,
    episodes: episodes ? episodes[1] : null,
    videoUrl: null,
  };
}

export function themeSongsFromJikan(data) {
  const list = (items, type) => (Array.isArray(items) ? items : [])
    .map((raw, i) => parseThemeSong(raw, type, i))
    .filter(Boolean);
  return [...list(data?.openings, 'OP'), ...list(data?.endings, 'ED')];
}

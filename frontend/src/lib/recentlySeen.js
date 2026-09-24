// Remembers, per game, which answers this browser has seen recently, so a new
// run starts with things the player hasn't just played. Within a run the games
// already avoid repeats; this covers "I just played, why is round 1 the same
// show again?" across runs.
//
// Not used for seeded challenge runs, which must deal an identical deck.

const PREFIX = 'aninest_seen_';
const DEFAULT_LIMIT = 200;

function read(game) {
  try {
    const list = JSON.parse(localStorage.getItem(PREFIX + game) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recentlySeen(game) {
  return read(game);
}

// Records that `id` was shown. Keeps the newest `limit` entries.
export function markSeen(game, id, limit = DEFAULT_LIMIT) {
  const key = String(id);
  const list = read(game).filter((x) => x !== key);
  list.push(key);
  try { localStorage.setItem(PREFIX + game, JSON.stringify(list.slice(-limit))); } catch { /* not remembered */ }
}

// Orders a shuffled deck so unseen items come first, then seen ones from the
// longest-ago to the most recent. The deck is used with pop() by the games,
// so the result is REVERSED: the first item to be played sits at the end.
//
// The memory is capped at half the pool, so a small pool (Emoji Plot's 42
// puzzles) still rotates instead of pinning everything as "seen".
export function freshFirst(shuffled, game, key = (a) => a.mal_id) {
  const cap = Math.max(1, Math.floor(shuffled.length / 2));
  const seen = read(game).slice(-cap);
  const rank = new Map(seen.map((id, i) => [id, i]));
  const unseen = shuffled.filter((a) => !rank.has(String(key(a))));
  const old = shuffled.filter((a) => rank.has(String(key(a))))
    .sort((a, b) => rank.get(String(key(a))) - rank.get(String(key(b))));
  return [...unseen, ...old].reverse();
}

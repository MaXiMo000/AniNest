// Scoring for Watch Together rooms (routes/rooms.js): given each member's
// taste and the group's swipes, which candidate shows suit everyone. Pure.
//
// A member's taste is a genre -> affinity map in [0, 1]: a signed-in member's
// comes from their list (lib/taste.js genreVector), a guest's from the genres
// they picked. A show's predicted enjoyment for one member is their mean
// affinity over its genres, nudged by the show's overall score. The group
// score leans on the LEAST happy member (60%) over the average (40%), so
// nobody gets stuck with something they'd hate. Any 👎 vetoes a show; each 👍
// adds a little.

import { genreVector } from './taste.js';

export const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music',
  'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];

// Titles on someone's list with these statuses count as already seen.
const SEEN = new Set(['completed', 'watching', 'dropped']);

export function affinityFromList(favorites, ratings = new Map()) {
  const v = genreVector(favorites, ratings);
  const max = Math.max(0, ...v.values());
  return max ? new Map([...v].map(([g, x]) => [g, Math.max(0, x) / max])) : new Map();
}

export function affinityFromGenres(genres) {
  return new Map(genres.map((g) => [g, 1]));
}

export function seenBy(favorites) {
  return favorites.filter((f) => SEEN.has(f.status)).map((f) => Number(f.mal_id));
}

function enjoyment(affinity, show) {
  const genres = show.genres || [];
  const base = genres.length ? genres.reduce((s, g) => s + (affinity.get(g) || 0), 0) / genres.length : 0;
  return 0.85 * base + 0.15 * ((show.score || 0) / 10);
}

// members: [{ id, affinity: Map, seen: [mal_id] }]
// pool: [{ mal_id, genres: [names], score (0-10), ... }]
// votes: [{ member_id, mal_id, vote: 1 | -1 }]
// Returns the pool ranked best-first, minus seen and vetoed shows, each with
// its group score and the genres every member likes.
export function rankForGroup(members, pool, votes = []) {
  const seen = new Set(members.flatMap((m) => m.seen));
  const vetoed = new Set(votes.filter((v) => v.vote < 0).map((v) => v.mal_id));
  const likes = new Map();
  votes.filter((v) => v.vote > 0).forEach((v) => likes.set(v.mal_id, (likes.get(v.mal_id) || 0) + 1));

  return pool
    .filter((s) => !seen.has(s.mal_id) && !vetoed.has(s.mal_id))
    .map((s) => {
      const each = members.map((m) => enjoyment(m.affinity, s));
      const min = Math.min(...each);
      const mean = each.reduce((a, b) => a + b, 0) / each.length;
      const group = 0.6 * min + 0.4 * mean + 0.1 * (likes.get(s.mal_id) || 0);
      const everyoneLikes = (s.genres || []).filter((g) => members.every((m) => (m.affinity.get(g) || 0) >= 0.5));
      return { ...s, group: Math.round(group * 1000) / 1000, everyoneLikes, likes: likes.get(s.mal_id) || 0 };
    })
    .sort((a, b) => b.group - a.group || (b.score || 0) - (a.score || 0));
}

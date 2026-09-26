// Taste match between two users, from their lists (favorites rows with
// status and genres) and review scores. Pure: routes/users.js loads the rows.
//
// Two signals, blended by how much the lists overlap:
//  - genre profile: cosine similarity of genre weights (what each person
//    finishes and rates well, minus what they drop)
//  - agreement on shows both have rated or listed
// Agreement only gets full weight at FULL_OVERLAP shared shows, so two people
// who share two titles don't read as a "100% match".

const FULL_OVERLAP = 10;
export const MIN_LIST = 5;

// How much someone liked a title, from -1 to 1. A review score says it best;
// otherwise the status: finishing something is a good sign, dropping it a bad one.
const STATUS_SENTIMENT = { completed: 0.6, watching: 0.5, plan_to_watch: 0.2, dropped: -0.8 };
export function sentiment(fav, rating) {
  if (rating) return Math.max(-1, Math.min(1, (rating - 5.5) / 4.5));
  return STATUS_SENTIMENT[fav?.status] ?? 0.4;
}

export function genreVector(favs, ratings) {
  const v = new Map();
  for (const f of favs) {
    const s = sentiment(f, ratings.get(f.mal_id));
    for (const g of f.genres || []) v.set(g, (v.get(g) || 0) + s);
  }
  return v;
}

function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  for (const [k, x] of a) { na += x * x; if (b.has(k)) dot += x * b.get(k); }
  for (const [, y] of b) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// a, b: { favorites: [{ mal_id, title, image, status, genres }], ratings: Map(mal_id -> 1..10) }
// Returns null when either list is too short to say anything.
export function tasteMatch(a, b) {
  if (a.favorites.length < MIN_LIST || b.favorites.length < MIN_LIST) return null;
  const bById = new Map(b.favorites.map((f) => [f.mal_id, f]));
  const shared = a.favorites
    .filter((f) => bById.has(f.mal_id))
    .map((f) => ({ fav: f, you: sentiment(f, a.ratings.get(f.mal_id)), them: sentiment(bById.get(f.mal_id), b.ratings.get(f.mal_id)) }));

  const ga = genreVector(a.favorites, a.ratings);
  const gb = genreVector(b.favorites, b.ratings);
  const genreScore = Math.max(0, cosine(ga, gb));
  const agreement = shared.length ? shared.reduce((sum, s) => sum + (1 - Math.abs(s.you - s.them) / 2), 0) / shared.length : 0;
  const w = Math.min(shared.length, FULL_OVERLAP) / FULL_OVERLAP;
  const percent = Math.round(100 * ((1 - w) * genreScore + w * agreement));

  const pick = ({ fav }) => ({ mal_id: fav.mal_id, title: fav.title, image: fav.image || null });
  const bothLove = shared.filter((s) => s.you >= 0.5 && s.them >= 0.5).sort((x, y) => (y.you + y.them) - (x.you + x.them)).slice(0, 5).map(pick);
  const disagree = shared.filter((s) => Math.abs(s.you - s.them) >= 1).sort((x, y) => Math.abs(y.you - y.them) - Math.abs(x.you - x.them))
    .slice(0, 3).map((s) => ({ ...pick(s), youLiked: s.you > s.them }));

  const sharedGenres = [...ga.keys()].filter((g) => ga.get(g) > 0 && (gb.get(g) || 0) > 0)
    .sort((x, y) => (gb.get(y) + ga.get(y)) - (gb.get(x) + ga.get(x))).slice(0, 3);

  return { percent, shared: shared.length, bothLove, disagree, sharedGenres };
}

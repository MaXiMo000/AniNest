// Seeded randomness for "challenge a friend" links: the same seed over the
// same pool deals the same deck, so two people can play an identical run.
// Not cryptographic - it only has to be repeatable.

// mulberry32: tiny, fast, good-enough 32-bit PRNG. Returns floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Turns any string (a seed from a URL, a date) into a 32-bit integer.
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A short, URL-safe random seed for a new challenge link.
export function newSeed() {
  return Math.random().toString(36).slice(2, 10);
}

// Fisher-Yates with an injected random source. `rand` defaults to Math.random
// so this is also the unseeded shuffle.
export function shuffleWith(list, rand = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A seeded random source for a challenge seed, or Math.random without one.
// The pool is sorted by id first so a seed deals the same deck no matter what
// order the API happened to return entries in.
export function randomFor(seed) {
  return seed ? mulberry32(hashString(String(seed))) : Math.random;
}

export function stableOrder(pool) {
  return [...pool].sort((a, b) => (a.mal_id || 0) - (b.mal_id || 0));
}

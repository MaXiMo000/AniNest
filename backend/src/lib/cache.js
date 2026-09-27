// Small shared TTL cache. Every visitor hitting /api/anime/top, for example,
// reuses the same cached page instead of triggering a fresh Jikan/AniList
// call each time — this is the main lever that keeps us well under Jikan's
// rate limit even with many concurrent site visitors.
//
// Capped at MAX_ENTRIES, least recently used first out: some keys come from
// free text (studio and voice-actor names), and an uncapped Map would grow
// until the 512 MB instance ran out of memory.

const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES) || 5000;
const store = new Map();
// Loads in progress, so twenty visitors arriving on a cold cache share one
// upstream call instead of sending twenty.
const inFlight = new Map();

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return undefined;
  }
  // Map keeps insertion order; re-inserting marks this key most recently used.
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

export function cacheSet(key, value, ttlMs) {
  store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
}

export function cacheSize() {
  return store.size;
}

export async function cached(key, ttlMs, fn) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  if (inFlight.has(key)) return inFlight.get(key);
  const load = (async () => {
    try {
      const value = await fn();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, load);
  return load;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 10 * 60 * 1000).unref();

// "Continue browsing" - a small, per-browser (not per-account) history of
// recently opened anime detail pages, kept in localStorage. Deliberately not
// synced server-side: this is a lightweight convenience, not user data worth
// a backend table and an account requirement.
const KEY = 'aninest_recently_viewed';
const MAX_ENTRIES = 20;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked - not critical */ }
}

export const RecentlyViewed = {
  list() { return read(); },

  // Re-viewing something already in the list just moves it back to the
  // front rather than creating a duplicate entry.
  record(anime) {
    const id = Number(anime.mal_id);
    if (!id) return;
    const entry = {
      mal_id: id,
      title: anime.title,
      image: anime.images?.webp?.image_url || anime.images?.jpg?.image_url || '',
      score: anime.score ?? null,
      type: anime.type || null,
      viewedAt: Date.now(),
    };
    const list = read().filter((a) => a.mal_id !== id);
    list.unshift(entry);
    write(list.slice(0, MAX_ENTRIES));
  },
};

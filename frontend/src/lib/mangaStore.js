// Manga reading-list, structurally identical to store.js's Favorites (an
// in-memory mirror kept synchronous for rendering, optimistic toggle/
// setStatus, reload on auth change) but keyed by manga_id (a MangaDex UUID
// string) against /api/manga-favorites instead of mal_id against
// /api/favorites. Deliberately independent of store.js, not derived from
// it - same relationship reviewsApi.js has to store.js today.

import { apiGet, apiPost, apiDelete } from './http.js';
import { Auth } from './authStore.js';

let byId = new Map();
let loaded = false;
const listeners = new Set();

function notify() { listeners.forEach((fn) => fn()); }

// Accepts either an already-normalized manga-favorites row (top-level
// `image` string) or a raw MangaDex-shaped manga object (`coverImage`) -
// the detail page and the library page each have a different shape on
// hand when they call setStatus().
function toEntry(manga, status) {
  const image = manga.image !== undefined ? manga.image : (manga.coverImage || '');
  return {
    manga_id: String(manga.id ?? manga.manga_id),
    title: manga.title,
    image: image || '',
    format: manga.format || (manga.originalLanguage === 'ko' ? 'manhwa' : manga.originalLanguage === 'zh' ? 'manhua' : 'manga'),
    status,
  };
}

export const MangaFavorites = {
  all() { return Object.fromEntries(byId); },
  count() { return byId.size; },
  has(id) { return byId.has(String(id)); },
  getStatus(id) { return byId.get(String(id))?.status || null; },
  isLoaded() { return loaded; },

  async loadFromServer() {
    if (!Auth.get().user) { byId = new Map(); loaded = true; notify(); return; }
    try {
      const { favorites } = await apiGet('/api/manga-favorites');
      byId = new Map(favorites.map((f) => [f.manga_id, f]));
    } catch {
      byId = new Map();
    }
    loaded = true;
    notify();
  },

  // Returns { ok, needsLogin, isFav } rather than throwing, same contract
  // as Favorites.toggle().
  async toggle(manga) {
    if (!Auth.get().user) return { ok: false, needsLogin: true };

    const id = String(manga.id ?? manga.manga_id);
    const wasFav = byId.has(id);

    if (wasFav) {
      byId.delete(id);
      notify();
      try {
        await apiDelete(`/api/manga-favorites/${id}`);
        return { ok: true, isFav: false };
      } catch {
        byId.set(id, manga);
        notify();
        return { ok: false, isFav: true };
      }
    }

    // No `status` argument on purpose: toEntry()'s `status` property is
    // then `undefined`, which JSON.stringify drops entirely - a plain
    // heart-toggle never sends a `status` key and can't clobber one.
    const entry = toEntry(manga);
    byId.set(id, entry);
    notify();
    try {
      await apiPost('/api/manga-favorites', entry);
      return { ok: true, isFav: true };
    } catch {
      byId.delete(id);
      notify();
      return { ok: false, isFav: false };
    }
  },

  // Sets (or, with status: null, clears) the reading-status "mini tracker"
  // field. Unlike toggle(), always saves the manga as a favorite too if it
  // wasn't one already - same rule as Favorites.setStatus().
  async setStatus(manga, status) {
    if (!Auth.get().user) return { ok: false, needsLogin: true };

    const id = String(manga.id ?? manga.manga_id);
    const prev = byId.get(id);
    const entry = toEntry(manga, status);
    if (!entry.image && prev?.image) entry.image = prev.image;

    byId.set(id, entry);
    notify();
    try {
      await apiPost('/api/manga-favorites', entry);
      return { ok: true };
    } catch {
      if (prev) byId.set(id, prev); else byId.delete(id);
      notify();
      return { ok: false };
    }
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

Auth.subscribe(() => { MangaFavorites.loadFromServer(); });

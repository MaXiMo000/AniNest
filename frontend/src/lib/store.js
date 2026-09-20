// Favorites now live on the server, scoped to the signed-in account (so they
// sync across devices) instead of localStorage. We keep an in-memory mirror
// so Favorites.has()/list() stay synchronous for rendering, and update it
// optimistically on toggle so the heart flips instantly — reverting only if
// the server call actually fails.

import { apiGet, apiPost, apiDelete } from './http.js';
import { Auth } from './authStore.js';

let byId = new Map();
let loaded = false;
const listeners = new Set();

function notify() { listeners.forEach((fn) => fn()); }

// Accepts either an already-normalized favorites row (has a top-level
// `image` string) or a raw anime object from the Jikan/AniList proxy (has
// `images.webp/jpg`) - the detail page and the library page each have a
// different shape on hand when they call setStatus().
function toEntry(anime, status) {
  const image = anime.image !== undefined
    ? anime.image
    : (anime.images?.webp?.image_url || anime.images?.jpg?.image_url || '');
  return {
    mal_id: Number(anime.mal_id),
    title: anime.title,
    image: image || '',
    score: anime.score ?? null,
    type: anime.type || null,
    status,
  };
}

export const Favorites = {
  all() { return Object.fromEntries(byId); },
  count() { return byId.size; },
  has(id) { return byId.has(Number(id)); },
  getStatus(id) { return byId.get(Number(id))?.status || null; },
  isLoaded() { return loaded; },

  async loadFromServer() {
    if (!Auth.get().user) { byId = new Map(); loaded = true; notify(); return; }
    try {
      const { favorites } = await apiGet('/api/favorites');
      byId = new Map(favorites.map((f) => [f.mal_id, f]));
    } catch {
      byId = new Map();
    }
    loaded = true;
    notify();
  },

  // Returns { ok, needsLogin, isFav } rather than throwing, so callers (event
  // handlers in ui.js) can show the right toast without a try/catch.
  async toggle(anime) {
    if (!Auth.get().user) return { ok: false, needsLogin: true };

    const id = Number(anime.mal_id);
    const wasFav = byId.has(id);

    if (wasFav) {
      byId.delete(id);
      notify();
      try {
        await apiDelete(`/api/favorites/${id}`);
        return { ok: true, isFav: false };
      } catch {
        byId.set(id, anime);
        notify();
        return { ok: false, isFav: true };
      }
    }

    // No `status` argument here on purpose: toEntry()'s `status` property
    // is then `undefined`, which JSON.stringify drops entirely - so a plain
    // heart-toggle never sends a `status` key and can't clobber one.
    const entry = toEntry(anime);
    byId.set(id, entry);
    notify();
    try {
      await apiPost('/api/favorites', entry);
      return { ok: true, isFav: true };
    } catch {
      byId.delete(id);
      notify();
      return { ok: false, isFav: false };
    }
  },

  // Sets (or, with status: null, clears) the watch-status "mini tracker"
  // field on an anime. Unlike toggle(), this always saves the anime as a
  // favorite too if it wasn't one already - status is metadata on a
  // favorites row, not a separate list, so tracking something implicitly
  // saves it. Returns { ok, needsLogin } rather than throwing.
  async setStatus(anime, status) {
    if (!Auth.get().user) return { ok: false, needsLogin: true };

    const id = Number(anime.mal_id);
    const prev = byId.get(id);
    const entry = toEntry(anime, status);
    if (!entry.image && prev?.image) entry.image = prev.image;

    byId.set(id, entry);
    notify();
    try {
      await apiPost('/api/favorites', entry);
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

Auth.subscribe(() => { Favorites.loadFromServer(); });

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

export const Favorites = {
  all() { return Object.fromEntries(byId); },
  count() { return byId.size; },
  has(id) { return byId.has(Number(id)); },
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

    const entry = {
      mal_id: id,
      title: anime.title,
      image: anime.images?.webp?.image_url || anime.images?.jpg?.image_url || '',
      score: anime.score ?? null,
      type: anime.type || null,
    };
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

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

Auth.subscribe(() => { Favorites.loadFromServer(); });

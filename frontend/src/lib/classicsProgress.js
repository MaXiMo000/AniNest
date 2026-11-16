import { apiGet, apiPost } from './http.js';
import { Auth } from './authStore.js';

// Where you are in each public-domain book. Signed in, it lives on the
// account (and counts toward XP); otherwise in this browser only.
const KEY = 'aninest:classics';

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function writeLocal(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage full or blocked */ }
}

// The "continue reading" list, most recent first.
export async function readingList() {
  if (Auth.get().user) {
    const { list, finished } = await apiGet('/api/novels/classics/reading');
    return { list, finished, local: false };
  }
  const list = Object.values(readLocal()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return { list, finished: list.filter((b) => b.finishedAt).length, local: true };
}

export function localPosition(id) {
  return readLocal()[id] || null;
}

// Saves the part you're on. Resolves to { justFinished } (always false for guests).
export async function savePosition(book, part) {
  if (Auth.get().user) {
    const out = await apiPost(`/api/novels/classics/${book.id}/progress`, { part });
    return { justFinished: out.justFinished, mine: out.mine };
  }
  const all = readLocal();
  const prev = all[book.id];
  all[book.id] = {
    id: book.id, title: book.title, authors: book.authors, image: book.image, parts: book.parts.length,
    part, maxPart: Math.max(prev?.maxPart ?? -1, part), updatedAt: new Date().toISOString(),
  };
  const keep = Object.values(all).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
  writeLocal(Object.fromEntries(keep.map((b) => [b.id, b])));
  return { justFinished: false, mine: all[book.id] };
}

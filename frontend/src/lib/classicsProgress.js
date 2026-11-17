import { apiGet, apiPost } from './http.js';
import { Auth } from './authStore.js';

// Where you are in each public-domain book, and your reading streak. Signed
// in, both live on the account (and count toward XP); otherwise in this
// browser only.
const KEY = 'aninest:classics';
const DAYS_KEY = 'aninest:classics-days';
const DAY_MS = 24 * 60 * 60 * 1000;

function readLocal(key = KEY, fallback = {}) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function writeLocal(value, key = KEY) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

// Today in the reader's own time zone, as YYYY-MM-DD.
export function today(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Twin of backend/src/lib/readingStreak.js streakFrom(): consecutive days
// ending today, or ending yesterday.
export function streakFrom(days, day) {
  const have = new Set(days);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const t = Date.parse(`${day}T00:00:00Z`);
  const start = have.has(day) ? t : t - DAY_MS;
  let n = 0;
  while (have.has(iso(start - n * DAY_MS))) n++;
  return n;
}

// The "continue reading" list, most recent first, with the streak.
export async function readingList() {
  if (Auth.get().user) {
    const { list, finished, streak } = await apiGet(`/api/novels/classics/reading?day=${today()}`);
    return { list, finished, streak: streak || 0, local: false };
  }
  const list = Object.values(readLocal()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return { list, finished: list.filter((b) => b.finishedAt).length, streak: streakFrom(readLocal(DAYS_KEY, []), today()), local: true };
}

export function localPosition(id) {
  return readLocal()[id] || null;
}

// Saves the part you're on. Resolves to { justFinished, mine, streak,
// firstToday }; justFinished is always false for guests.
export async function savePosition(book, part) {
  const day = today();
  if (Auth.get().user) {
    const out = await apiPost(`/api/novels/classics/${book.id}/progress`, { part, day });
    return { justFinished: out.justFinished, mine: out.mine, streak: out.streak || 0, firstToday: Boolean(out.firstToday) };
  }
  const all = readLocal();
  const prev = all[book.id];
  all[book.id] = {
    id: book.id, title: book.title, authors: book.authors, image: book.image, parts: book.parts.length,
    part, maxPart: Math.max(prev?.maxPart ?? -1, part), updatedAt: new Date().toISOString(),
  };
  const keep = Object.values(all).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
  writeLocal(Object.fromEntries(keep.map((b) => [b.id, b])));
  const days = readLocal(DAYS_KEY, []);
  const firstToday = !days.includes(day);
  if (firstToday) writeLocal([day, ...days].slice(0, 400), DAYS_KEY);
  return { justFinished: false, mine: all[book.id], streak: streakFrom(firstToday ? [day, ...days] : days, day), firstToday };
}

// Books saved for offline reading (every chapter fetched once, so the
// service worker has it cached).
const OFFLINE_KEY = 'aninest:classics-offline';
export const isSavedOffline = (id) => readLocal(OFFLINE_KEY, []).includes(Number(id));
export function markSavedOffline(id) {
  const ids = readLocal(OFFLINE_KEY, []).filter((x) => x !== Number(id));
  writeLocal([Number(id), ...ids].slice(0, 50), OFFLINE_KEY);
}

import { escapeHtml } from './ui.js';

// The December nudge: a home-page banner pointing signed-in people at their
// Wrapped. Shows through December and the first two weeks of January (for
// the year just ended), until dismissed for that year.
export function wrappedNudgeYear(date = new Date()) {
  const month = date.getMonth();
  if (month === 11) return date.getFullYear();
  if (month === 0 && date.getDate() <= 14) return date.getFullYear() - 1;
  return null;
}

const key = (year) => `aninest-wrapped-nudge-${year}`;

function dismissed(year) {
  try { return localStorage.getItem(key(year)) === '1'; } catch { return false; }
}

export function wrappedNudgeHTML(user, date = new Date()) {
  const year = wrappedNudgeYear(date);
  if (!user || !year || dismissed(year)) return '';
  return `
    <div class="wrapped-nudge" id="wrapped-nudge" role="region" aria-label="Your Wrapped">
      <span class="wrapped-nudge-text">🎁 <strong>${escapeHtml(user.username)}, your ${year} in anime is ready.</strong> Episodes, binges, top shows and a card to share.</span>
      <a class="btn-pow btn-pow--pink btn-pow--sm" href="#/wrapped?year=${year}">SEE MY WRAPPED</a>
      <button type="button" class="chip" id="wrapped-nudge-close" aria-label="Hide this">✕</button>
    </div>`;
}

export function wireWrappedNudge(root, date = new Date()) {
  const year = wrappedNudgeYear(date);
  root.querySelector('#wrapped-nudge-close')?.addEventListener('click', () => {
    try { localStorage.setItem(key(year), '1'); } catch { /* storage blocked: it just comes back next visit */ }
    root.querySelector('#wrapped-nudge')?.remove();
  });
}

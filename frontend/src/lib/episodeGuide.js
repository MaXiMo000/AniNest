import { apiGet, apiPost } from './http.js';
import { Auth } from './authStore.js';
import { escapeHtml, showToast } from './ui.js';

// Episode guide on the anime page (backend/src/routes/episodeGuide.js): one
// bar per episode with the community's average rating, "most people say it
// clicks at episode N", and — for a signed-in viewer — rating the episodes
// they've watched. Loaded after the page, like the jukebox.

const FACES = [
  { value: 1, emoji: '😴', label: 'Boring' },
  { value: 2, emoji: '😐', label: 'Meh' },
  { value: 3, emoji: '🙂', label: 'Good' },
  { value: 4, emoji: '🤩', label: 'Great' },
  { value: 5, emoji: '🔥', label: 'Amazing' },
];

function chartHTML(guide, count) {
  const byEp = new Map(guide.episodes.map((e) => [e.episode, e]));
  const bars = [];
  for (let ep = 1; ep <= count; ep += 1) {
    const e = byEp.get(ep);
    const label = e?.avg != null
      ? `Episode ${ep}: ${e.avg} / 5 from ${e.n} ratings`
      : `Episode ${ep}: ${e ? `${e.n} of ${guide.minVotes} ratings needed` : 'no ratings yet'}`;
    const height = e?.avg != null ? Math.max(8, (e.avg / 5) * 100) : 6;
    bars.push(`<span data-ep="${ep}" class="ep-bar${e?.avg != null ? '' : ' ep-bar--thin'}${guide.clicksAt === ep ? ' ep-bar--clicks' : ''}" tabindex="0" role="img" aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(label)}"><span style="height:${height}%"></span></span>`);
  }
  return `
    <div class="ep-chart-wrap">
      <div class="ep-chart" style="--eps:${count}">${bars.join('')}</div>
      <div class="ep-tip" role="status" aria-live="polite"></div>
    </div>
    <div class="ep-axis" style="--eps:${count}"><span>Ep 1</span><span>Ep ${count}</span></div>`;
}

function tableHTML(guide) {
  if (!guide.episodes.length) return '';
  return `
    <details class="ep-table">
      <summary>Show as a table</summary>
      <table>
        <thead><tr><th scope="col">Episode</th><th scope="col">Average</th><th scope="col">Ratings</th></tr></thead>
        <tbody>${guide.episodes.map((e) => `<tr><td>${e.episode}</td><td>${e.avg ?? '—'}</td><td>${e.n}</td></tr>`).join('')}</tbody>
      </table>
    </details>`;
}

function yourPartHTML(guide) {
  if (!Auth.get().user) return '<p class="muted-note">Log in and track your progress to rate episodes.</p>';
  const mine = guide.mine || { ratings: {}, clickedAt: null, watched: 0 };
  if (!mine.watched) return '<p class="muted-note">Track your progress above (“+1 episode”) to rate the episodes you’ve seen.</p>';
  const options = Array.from({ length: mine.watched }, (_, i) => mine.watched - i)
    .map((ep) => `<option value="${ep}">Episode ${ep}${mine.ratings[ep] ? ` · ${FACES[mine.ratings[ep] - 1].emoji}` : ''}</option>`).join('');
  return `
    <div class="ep-rate">
      <label class="free-country">Rate <select id="ep-pick" aria-label="Episode to rate">${options}</select></label>
      <div class="ep-faces" role="group" aria-label="Your rating">
        ${FACES.map((f) => `<button class="status-pill" data-face="${f.value}" aria-label="${f.label}" title="${f.label}">${f.emoji}</button>`).join('')}
      </div>
      <button class="chip" id="ep-clicked">⚡ It clicked here</button>
    </div>
    ${mine.clickedAt ? `<p class="muted-note">You said it clicked at episode ${mine.clickedAt}.</p>` : ''}`;
}

// "26, 54, 97-108": consecutive episodes collapsed into ranges.
export function skipRanges(episodes) {
  const sorted = [...new Set(episodes)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return parts.join(', ');
}

// The skip guide, from MAL's filler/recap flags (loaded separately so the
// guide never waits on Jikan). Dims those bars and says what can be skipped.
export function skipGuideHTML(flags) {
  if (!flags?.available) return '';
  const { filler = [], recap = [] } = flags;
  if (!filler.length && !recap.length) return '<p class="muted-note">✅ No filler: MyAnimeList marks every episode as canon.</p>';
  const lines = [];
  if (filler.length) lines.push(`You can safely skip <strong>${filler.length} filler episode${filler.length === 1 ? '' : 's'}</strong>: ${escapeHtml(skipRanges(filler))}.`);
  if (recap.length) lines.push(`Recap episode${recap.length === 1 ? '' : 's'}: ${escapeHtml(skipRanges(recap))}.`);
  return `<div class="ep-skip"><p>⏭️ ${lines.join(' ')}</p><p class="muted-note">Faded bars are filler or recap, per MyAnimeList.</p></div>`;
}

async function loadSkipGuide(slot, anime) {
  const target = slot.querySelector('#ep-skip-slot');
  if (!target) return;
  let flags;
  try {
    flags = await apiGet(`/api/episode-guide/${Number(anime.mal_id)}/flags`);
  } catch {
    return;
  }
  if (!target.isConnected) return;
  target.innerHTML = skipGuideHTML(flags);
  const filler = new Set(flags.filler || []);
  const recap = new Set(flags.recap || []);
  slot.querySelectorAll('.ep-bar[data-ep]').forEach((bar) => {
    const ep = Number(bar.dataset.ep);
    if (!filler.has(ep) && !recap.has(ep)) return;
    bar.classList.add('ep-bar--filler');
    const kind = filler.has(ep) ? 'filler' : 'recap';
    bar.dataset.tip = `${bar.dataset.tip} · ${kind}`;
    bar.setAttribute('aria-label', bar.dataset.tip);
  });
}

export async function loadEpisodeGuide(root, anime) {
  const slot = root.querySelector('#episode-guide-slot');
  if (!slot) return;
  let guide;
  try {
    guide = await apiGet(`/api/episode-guide/${Number(anime.mal_id)}`);
  } catch {
    return; // the page is fine without it
  }
  if (!slot.isConnected) return;

  const rated = guide.episodes.reduce((m, e) => Math.max(m, e.episode), 0);
  const count = anime.episodes || Math.max(rated, guide.mine?.watched || 0);
  const headline = guide.clicksAt
    ? `Most people say it clicks at <strong>episode ${guide.clicksAt}</strong> 👉 (${guide.clickVotes} votes)`
    : 'Not enough votes yet on when it gets good. Watched it? Say where it clicked for you.';
  slot.innerHTML = `
    <section class="section">
      <div class="section-head"><h2 class="section-title">📈 Episode Guide</h2></div>
      <p class="ep-headline">${headline}</p>
      <div id="ep-skip-slot"></div>
      ${count ? chartHTML(guide, count) : ''}
      ${count ? `<p class="muted-note">Each bar is the community's average rating; grey means fewer than ${guide.minVotes} ratings so far.</p>` : ''}
      ${tableHTML(guide)}
      ${yourPartHTML(guide)}
    </section>`;
  wire(slot, root, anime, guide);
  loadSkipGuide(slot, anime);
}

function wire(slot, root, anime, guide) {
  const tip = slot.querySelector('.ep-tip');
  const show = (e) => {
    const bar = e.target.closest('.ep-bar');
    if (bar && tip) tip.textContent = bar.dataset.tip;
  };
  slot.querySelector('.ep-chart')?.addEventListener('pointerover', show);
  slot.querySelector('.ep-chart')?.addEventListener('focusin', show);

  const pick = slot.querySelector('#ep-pick');
  if (!pick) return;
  const mine = guide.mine;
  const syncFaces = () => {
    const current = mine.ratings[pick.value];
    slot.querySelectorAll('[data-face]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.face) === current));
  };
  pick.addEventListener('change', syncFaces);
  syncFaces();
  const id = Number(anime.mal_id);
  slot.querySelectorAll('[data-face]').forEach((b) => b.addEventListener('click', async () => {
    const episode = Number(pick.value);
    const rating = mine.ratings[episode] === Number(b.dataset.face) ? null : Number(b.dataset.face); // same face again takes it back
    try {
      await apiPost(`/api/episode-guide/${id}/rate`, { episode, rating });
      showToast(rating ? `Rated episode ${episode} ${FACES[rating - 1].emoji}` : 'Rating removed.');
      loadEpisodeGuide(root, anime);
    } catch (err) {
      showToast(err.message || 'Something went wrong — try again.');
    }
  }));
  slot.querySelector('#ep-clicked').addEventListener('click', async () => {
    const episode = Number(pick.value);
    try {
      await apiPost(`/api/episode-guide/${id}/clicked`, { episode: mine.clickedAt === episode ? null : episode });
      showToast(mine.clickedAt === episode ? 'Removed.' : `Noted: it clicked at episode ${episode} ⚡`);
      loadEpisodeGuide(root, anime);
    } catch (err) {
      showToast(err.message || 'Something went wrong — try again.');
    }
  });
}

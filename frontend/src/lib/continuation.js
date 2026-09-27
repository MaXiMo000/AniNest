import { apiDelete, apiGet, apiPost } from './http.js';
import { Auth } from './authStore.js';
import { escapeHtml, showToast } from './ui.js';

// "Continue in the manga" on a detail page (backend/src/routes/continuations.js):
// the source title from AniList, plus where the community says the anime
// stops. Hidden for anime originals nobody has answered for.

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function sectionHTML(d) {
  const { source, consensus: c, mine } = d;
  const kind = source?.format || 'manga';
  const sourceLine = source
    ? `Based on the ${escapeHtml(kind.toLowerCase())} <strong>${escapeHtml(source.title)}</strong>.
       <a href="#/manga?q=${encodeURIComponent(source.title)}">Find it in Manga →</a>`
    : '';
  const answer = c
    ? `<p class="continuation-answer">The anime ends at <strong>chapter ${fmt(c.lastChapter)}</strong>${c.volume ? ` (volume ${c.volume})` : ''}, so start at <strong>chapter ${c.nextChapter}</strong>.</p>
       <p class="section-sub">${c.agree} of ${c.total} ${c.total === 1 ? 'person says' : 'people say'} so.</p>`
    : '<p class="section-sub">Nobody has said where the anime stops yet.</p>';
  const form = Auth.get().user ? `
    <details class="continuation-form"${c ? '' : ' open'}>
      <summary>${mine ? `You said chapter ${fmt(mine.lastChapter)}. Change it?` : 'Know where the anime stops?'}</summary>
      <form class="hero-actions" style="align-items:flex-end;gap:10px">
        <label class="predict-input">Last chapter adapted
          <input name="chapter" type="number" inputmode="decimal" min="1" max="5000" step="0.1" required value="${mine?.lastChapter ?? ''}" />
        </label>
        <label class="predict-input">Volume (optional)
          <input name="volume" type="number" inputmode="numeric" min="1" max="500" step="1" value="${mine?.volume ?? ''}" />
        </label>
        <button class="btn-pow btn-pow--pink btn-pow--sm" type="submit">SAVE</button>
        ${mine ? '<button class="chip" type="button" data-remove>Remove mine</button>' : ''}
      </form>
    </details>` : '<p class="section-sub"><a href="#/login">Log in</a> to say where the anime stops.</p>';
  return `
    <section class="section continuation">
      <div class="section-head"><h2 class="section-title">📖 Continue in the ${escapeHtml(kind)}</h2></div>
      ${sourceLine ? `<p>${sourceLine}</p>` : ''}
      ${answer}
      ${form}
    </section>`;
}

export async function loadContinuation(root, malId) {
  const slot = root.querySelector('#continuation-slot');
  if (!slot) return;
  let d;
  try {
    d = await apiGet(`/api/continuations/${malId}`);
  } catch {
    return; // no section is the right fallback
  }
  const render = (data) => {
    if (!slot.isConnected) return;
    if (!data.source && !data.consensus) { slot.innerHTML = ''; return; }
    slot.innerHTML = sectionHTML(data);
    const form = slot.querySelector('.continuation-form form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const volume = form.volume.value.trim();
      try {
        render(await apiPost(`/api/continuations/${malId}`, { last_chapter: Number(form.chapter.value), volume: volume ? Number(volume) : null }));
        showToast('Thanks! Saved.');
      } catch (err) {
        showToast(err.message || 'Couldn’t save — try again.');
      }
    });
    slot.querySelector('[data-remove]')?.addEventListener('click', async () => {
      try {
        render(await apiDelete(`/api/continuations/${malId}`));
      } catch (err) {
        showToast(err.message || 'Couldn’t remove it — try again.');
      }
    });
  };
  render(d);
}

import { apiGet } from '../lib/http.js';
import { cardGrid, loadingHTML, errorHTML, emptyHTML, wireRetry, escapeHtml } from '../lib/ui.js';
import { getCountry, setCountry, countryName } from '../lib/country.js';
import { countryPickerHTML } from '../lib/freeWatch.js';

// Every anime with free official episodes that play in the viewer's country
// (backend/src/routes/free.js). The country is the same remembered choice
// the detail page's picker uses.
export async function renderFree(root) {
  document.title = 'Free in My Country — AniNest';
  const country = getCountry();
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">📺 Free & Official in ${escapeHtml(countryName(country))}</h1>
      <span class="section-sub">Full episodes uploaded by licensed channels (Muse Asia, Ani-One, Crunchyroll) that YouTube says play where you are.</span>
    </div>
    <div class="hero-actions" style="margin:0 0 16px">${countryPickerHTML()}</div>
    <div id="free-slot">${loadingHTML('CHECKING WHAT’S FREE')}</div>`;

  root.querySelector('#free-country')?.addEventListener('change', (e) => {
    setCountry(e.target.value);
    renderFree(root);
  });

  const slot = root.querySelector('#free-slot');
  let res;
  try {
    res = await apiGet(`/api/free${country ? `?country=${encodeURIComponent(country)}` : ''}`);
  } catch {
    if (!slot.isConnected) return;
    slot.innerHTML = errorHTML('Couldn’t load the free list.');
    wireRetry(slot, () => renderFree(root));
    return;
  }
  if (!slot.isConnected) return;
  const pendingNote = res.pending ? `<p class="muted-note">${Number(res.pending)} more show${res.pending === 1 ? ' is' : 's are'} still being added. Check back in a bit.</p>` : '';
  if (!res.data.length) {
    slot.innerHTML = res.pending
      ? pendingNote
      : emptyHTML(`Nothing we know of plays free in ${countryName(country)} yet. Try another country, or check back as more uploads are added.`, '📺');
    return;
  }
  slot.innerHTML = `
    <p class="section-sub" style="margin:0 0 12px">${res.data.length} show${res.data.length === 1 ? '' : 's'}, best rated first. Open one and press play under “Watch Free (Official)”.</p>
    ${cardGrid(res.data)}
    ${pendingNote}`;
}

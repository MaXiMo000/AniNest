import { apiGet, apiPost } from '../../lib/http.js';
import { escapeHtml, loadingHTML, emptyHTML, errorHTML, wireRetry, showToast } from '../../lib/ui.js';
import { Auth } from '../../lib/authStore.js';

// Admin queue of reported reviews: hide one (it leaves every public list)
// or dismiss its reports. See backend/src/routes/reviewReports.js.
function itemHTML(r) {
  const KIND = { anime: ['anime', 'Anime'], manga: ['manga', 'Manga'], novel: ['novel', 'Light novel'] }[r.kind] || ['manga', 'Manga'];
  const link = `#/${KIND[0]}/${encodeURIComponent(r.title_id)}`;
  return `
    <div class="watch-box" data-kind="${escapeHtml(r.kind)}" data-id="${Number(r.reviewId)}">
      <h3>🚩 ${Number(r.reports)} report${r.reports === 1 ? '' : 's'} · <a href="${link}">${KIND[1]} review</a> by
        <a href="#/u/${encodeURIComponent(r.username)}">${escapeHtml(r.username)}</a> (${Number(r.rating)}/10)</h3>
      <p class="review-body">${escapeHtml(r.body || '(no text, rating only)')}</p>
      ${r.reasons ? `<p class="section-sub">Reasons: ${escapeHtml(r.reasons)}</p>` : ''}
      <div class="hero-actions">
        <button class="btn-pow btn-pow--pink btn-pow--sm" data-action="hide">Hide review</button>
        <button class="btn-pow btn-pow--outline btn-pow--sm" data-action="dismiss">Dismiss reports</button>
      </div>
    </div>`;
}

export async function renderReviewReportsAdmin(root) {
  document.title = 'Reported Reviews — AniNest';
  if (!Auth.get().user?.isAdmin) {
    root.innerHTML = emptyHTML('This page wandered off into the filler dimension.', '🌀');
    return;
  }
  root.innerHTML = loadingHTML('LOADING REPORTS');
  let data;
  try {
    data = await apiGet('/api/admin/review-reports');
  } catch {
    root.innerHTML = errorHTML('Couldn’t load the reports.');
    wireRetry(root, () => renderReviewReportsAdmin(root));
    return;
  }
  root.innerHTML = `
    <div class="section-head"><h2 class="section-title">🚩 Reported Reviews</h2>
      <span class="section-sub">Hidden reviews disappear from every public list; their author still sees them.</span></div>
    <div id="report-list">${data.reports.length ? data.reports.map(itemHTML).join('') : emptyHTML('Nothing reported. The community is behaving!', '😇')}</div>`;

  root.querySelector('#report-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const box = btn.closest('[data-kind]');
    btn.disabled = true;
    try {
      await apiPost(`/api/admin/review-reports/${box.dataset.kind}/${box.dataset.id}/${btn.dataset.action}`);
      box.remove();
      showToast(btn.dataset.action === 'hide' ? 'Review hidden.' : 'Reports dismissed.');
    } catch {
      btn.disabled = false;
      showToast('Something went wrong — try again.');
    }
  });
}

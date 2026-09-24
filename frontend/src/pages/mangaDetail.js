import { MangaApi } from '../lib/mangaApi.js';
import { loadingHTML, errorHTML, escapeHtml, wireRetry, showToast, READ_STATUSES } from '../lib/ui.js';
import { MangaFavorites } from '../lib/mangaStore.js';
import { mangaImg } from '../lib/mangaImage.js';
import { MangaReviews } from '../lib/reviewsApi.js';
import { createReviewsUi } from '../lib/reviewsUi.js';
import { navigate } from '../lib/router.js';

// The manga analog of details.js's watchBoxHTML fallback branch. There's no
// reliable API mapping an arbitrary manga to its official MANGA Plus/VIZ/
// Webtoons chapter URL, so this always renders generated title-search
// links (never an embedded reader - see mangadex.js's file-header comment
// for why reading stays link-out-only, same "no piracy scraping" line
// AniNest already holds for anime streaming).
function readBoxHTML(m) {
  const q = encodeURIComponent(m.title);
  const links = [
    { name: 'MANGA Plus', url: `https://mangaplus.shueisha.co.jp/search_result?word=${q}` },
    { name: 'VIZ', url: `https://www.viz.com/search?q=${q}` },
    { name: 'Webtoons', url: `https://www.webtoons.com/en/search?keyword=${q}` },
  ];
  return `
    <div class="watch-box">
      <h3>📖 Read For Free</h3>
      <p style="color:var(--muted);font-weight:600;margin:0">We link to official platforms only — no sketchy scans here, gotta support the creators! Availability varies by title and region.</p>
      <div class="watch-links">${links.map((l) => `<a class="btn-pow btn-pow--blue" target="_blank" rel="noopener" href="${escapeHtml(l.url)}">▶ Search on ${escapeHtml(l.name)}</a>`).join('')}</div>
    </div>`;
}

function readStatusHTML(mangaId) {
  const current = MangaFavorites.getStatus(mangaId);
  return `
    <div class="watch-status-row">
      <span class="watch-status-label">📖 Track:</span>
      ${READ_STATUSES.map((s) => `
        <button class="status-pill ${current === s.value ? 'is-active' : ''}" data-status="${s.value}">${s.emoji} ${escapeHtml(s.label)}</button>
      `).join('')}
    </div>`;
}

const mangaReviews = createReviewsUi(MangaReviews);

export async function renderMangaDetail(root, id) {
  root.innerHTML = loadingHTML('LOADING CHAPTER DATA');
  try {
    const [{ data: m }, reviewsData] = await Promise.all([MangaApi.byId(id), mangaReviews.load(id)]);

    document.title = `${m.title} — AniNest`;

    const info = [
      m.status ? `📡 ${m.status}` : null,
      m.demographic ? `🎯 ${m.demographic}` : null,
      m.year ? `📅 ${m.year}` : null,
    ].filter(Boolean);

    root.innerHTML = `
      <div class="detail-hero" style="background:linear-gradient(160deg, rgba(123,47,247,0.25), rgba(18,12,34,0.9)), var(--panel)">
        <img class="detail-poster" src="${escapeHtml(mangaImg(m.coverImage))}" alt="${escapeHtml(m.title)}" />
        <div class="detail-main">
          <h1 class="detail-title">${escapeHtml(m.title)}</h1>
          ${m.altTitles?.[0] && m.altTitles[0] !== m.title ? `<p class="detail-title-en">${escapeHtml(m.altTitles[0])}</p>` : ''}
          <div class="detail-badges">
            ${info.map((p) => `<span class="stat-pill">${escapeHtml(p)}</span>`).join('')}
          </div>
          <div class="genre-chips">
            ${(m.tags || []).map((t) => `<a class="chip" href="#/manga?tags=${encodeURIComponent(t.id)}">${escapeHtml(t.name)}</a>`).join('')}
          </div>
          <div class="hero-actions">
            <button class="btn-pow btn-pow--pink" id="manga-fav-toggle">${MangaFavorites.has(m.id) ? '💖 FAVORITED' : '🤍 ADD TO FAVORITES'}</button>
          </div>
          ${readStatusHTML(m.id)}
        </div>
      </div>

      <div class="speech-bubble">${escapeHtml(m.description || 'No synopsis available for this one — pure mystery box.')}</div>

      ${readBoxHTML(m)}

      <div class="info-grid">
        <div class="info-box"><div class="k">Status</div><div class="v">${escapeHtml(m.status || '—')}</div></div>
        <div class="info-box"><div class="k">Demographic</div><div class="v">${escapeHtml(m.demographic || '—')}</div></div>
        <div class="info-box"><div class="k">Author</div><div class="v">${escapeHtml(m.author || '—')}</div></div>
        <div class="info-box"><div class="k">Year</div><div class="v">${escapeHtml(String(m.year || '—'))}</div></div>
      </div>

      ${mangaReviews.sectionHTML(reviewsData)}
    `;

    mangaReviews.wire(root, m.id);

    root.querySelector('#manga-fav-toggle')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      const result = await MangaFavorites.toggle(m);
      btn.disabled = false;
      if (result.needsLogin) {
        showToast('Log in to save favorites!');
        navigate('#/login');
        return;
      }
      btn.textContent = result.isFav ? '💖 FAVORITED' : '🤍 ADD TO FAVORITES';
      showToast(result.ok
        ? (result.isFav ? `Added "${m.title}" to favorites!` : 'Removed from favorites.')
        : 'Something went wrong — try again.');
    });

    root.querySelectorAll('.status-pill').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const clicked = btn.dataset.status;
        const wasActive = btn.classList.contains('is-active');
        const nextStatus = wasActive ? null : clicked; // clicking the active status again clears it
        root.querySelectorAll('.status-pill').forEach((b) => { b.disabled = true; });
        const result = await MangaFavorites.setStatus(m, nextStatus);
        root.querySelectorAll('.status-pill').forEach((b) => { b.disabled = false; });
        if (result.needsLogin) {
          showToast('Log in to track manga!');
          navigate('#/login');
          return;
        }
        if (!result.ok) { showToast('Something went wrong — try again.'); return; }
        root.querySelectorAll('.status-pill').forEach((b) => b.classList.toggle('is-active', b.dataset.status === nextStatus));
        const favBtn = root.querySelector('#manga-fav-toggle');
        if (favBtn) favBtn.textContent = '💖 FAVORITED';
        const label = READ_STATUSES.find((s) => s.value === nextStatus)?.label;
        showToast(label ? `Marked as ${label}.` : 'Status cleared.');
      });
    });
  } catch (err) {
    console.error(err);
    root.innerHTML = errorHTML('Couldn’t load this manga — it might not exist, or the API is rate-limited. Try again shortly!');
    wireRetry(root, () => renderMangaDetail(root, id));
  }
}

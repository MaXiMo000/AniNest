import { Api, imageOf } from '../lib/api.js';
import { cardRail, loadingHTML, errorHTML, escapeHtml, wireRetry, showToast } from '../lib/ui.js';
import { Favorites } from '../lib/store.js';
import { navigate } from '../lib/router.js';

function fmtDate(x) {
  return x?.string || '?';
}

function statPills(a) {
  const pills = [
    a.rank ? `🏅 Rank #${a.rank}` : null,
    a.popularity ? `📈 Popularity #${a.popularity}` : null,
    a.status ? `📡 ${a.status}` : null,
    a.duration ? `⏱ ${a.duration}` : null,
    a.rating ? `🔞 ${a.rating.replace(/\s*-.*$/, '')}` : null,
  ].filter(Boolean);
  return pills.map((p) => `<span class="stat-pill">${escapeHtml(p)}</span>`).join('');
}

function trailerHTML(a) {
  const raw = a.trailer?.embed_url;
  if (!raw) return '';
  // Jikan's embed_url defaults to autoplay=1 — don't blast video+sound at
  // someone who just opened a details page.
  const embed = escapeHtml(raw.includes('autoplay=') ? raw.replace(/autoplay=1/, 'autoplay=0') : raw);
  return `
    <div class="tv-frame">
      <div class="tv-screen"><iframe src="${embed}" title="Trailer" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
      <div class="tv-label">📼 OFFICIAL TRAILER</div>
    </div>`;
}

function watchBoxHTML(a) {
  const streaming = a.streaming || [];
  const links = streaming.length
    ? streaming.map((s) => `<a class="btn-pow btn-pow--blue" target="_blank" rel="noopener" href="${escapeHtml(s.url)}">▶ ${escapeHtml(s.name)}</a>`).join('')
    : `<a class="btn-pow btn-pow--blue" target="_blank" rel="noopener" href="https://www.crunchyroll.com/search?q=${encodeURIComponent(a.title)}">▶ Search on Crunchyroll</a>`;
  return `
    <div class="watch-box">
      <h3>📺 Where to Watch</h3>
      <p style="color:var(--muted);font-weight:600;margin:0">We link to official platforms only — no sketchy streams here, gotta support the studios!</p>
      <div class="watch-links">${links}</div>
    </div>`;
}

export async function renderDetails(root, id) {
  root.innerHTML = loadingHTML('LOADING EPISODE DATA');
  try {
    const [{ data: a }, recRes] = await Promise.all([
      Api.fullById(id),
      Api.recommendations(id).catch(() => ({ data: [] })),
    ]);

    const img = escapeHtml(imageOf(a));
    const score = a.score ? a.score.toFixed(1) : '—';
    const recs = (recRes.data || []).slice(0, 12).map((r) => r.entry);

    document.title = `${a.title} — AniNest`;

    root.innerHTML = `
      <div class="detail-hero" style="background:linear-gradient(160deg, rgba(123,47,247,0.25), rgba(18,12,34,0.9)), var(--panel)">
        <img class="detail-poster" src="${img}" alt="${escapeHtml(a.title)}" />
        <div class="detail-main">
          <h1 class="detail-title">${escapeHtml(a.title)}</h1>
          ${a.title_english && a.title_english !== a.title ? `<p class="detail-title-en">${escapeHtml(a.title_english)}</p>` : ''}
          <div class="detail-badges">
            <span class="badge-score">${score}</span>
            ${statPills(a)}
          </div>
          <div class="genre-chips">
            ${(a.genres || []).concat(a.themes || []).map((g) => `<a class="chip" href="#/browse?genre=${Number(g.mal_id) || 0}">${escapeHtml(g.name)}</a>`).join('')}
          </div>
          <div class="hero-actions">
            <button class="btn-pow btn-pow--pink" id="fav-toggle">${Favorites.has(a.mal_id) ? '💖 FAVORITED' : '🤍 ADD TO FAVORITES'}</button>
            ${a.url ? `<a class="btn-pow btn-pow--outline" target="_blank" rel="noopener" href="${escapeHtml(a.url)}">🔗 MyAnimeList</a>` : ''}
          </div>
        </div>
      </div>

      <div class="speech-bubble">${escapeHtml(a.synopsis || 'No synopsis available for this one — pure mystery box.')}</div>

      ${trailerHTML(a)}
      ${watchBoxHTML(a)}

      <div class="info-grid">
        <div class="info-box"><div class="k">Episodes</div><div class="v">${a.episodes ?? '?'}</div></div>
        <div class="info-box"><div class="k">Aired</div><div class="v">${escapeHtml(fmtDate(a.aired))}</div></div>
        <div class="info-box"><div class="k">Studios</div><div class="v">${escapeHtml((a.studios || []).map((s) => s.name).join(', ') || '—')}</div></div>
        <div class="info-box"><div class="k">Source</div><div class="v">${escapeHtml(a.source || '—')}</div></div>
        <div class="info-box"><div class="k">Season</div><div class="v">${escapeHtml([a.season, a.year].filter(Boolean).join(' ') || '—')}</div></div>
        <div class="info-box"><div class="k">Members</div><div class="v">${a.members ? a.members.toLocaleString() : '—'}</div></div>
      </div>

      ${recs.length ? `
      <section class="section">
        <div class="section-head"><h2 class="section-title">🔀 If You Like This</h2></div>
        ${cardRail(recs)}
      </section>` : ''}
    `;

    root.querySelector('#fav-toggle')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      const result = await Favorites.toggle(a);
      btn.disabled = false;
      if (result.needsLogin) {
        showToast('Log in to save favorites!');
        navigate('#/login');
        return;
      }
      btn.textContent = result.isFav ? '💖 FAVORITED' : '🤍 ADD TO FAVORITES';
      showToast(result.ok
        ? (result.isFav ? `Added "${a.title}" to favorites!` : 'Removed from favorites.')
        : 'Something went wrong — try again.');
    });
  } catch (err) {
    console.error(err);
    root.innerHTML = errorHTML('Couldn’t load this anime — it might not exist, or the API is rate-limited. Try again shortly!');
    wireRetry(root, () => renderDetails(root, id));
  }
}

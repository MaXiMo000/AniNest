import { Api, imageOf } from '../lib/api.js';
import { cardRail, cardGrid, loadingHTML, errorHTML, escapeHtml, genreGradient, wireRetry, skeletonRail } from '../lib/ui.js';
import { navigate } from '../lib/router.js';
import { RecentlyViewed } from '../lib/recentlyViewed.js';
import { Auth } from '../lib/authStore.js';
import { Recs } from '../lib/recommendationsApi.js';
import { todayName } from './schedule.js';

const FEATURED_GENRES = [
  { id: 1, name: 'Action' }, { id: 22, name: 'Romance' }, { id: 4, name: 'Comedy' },
  { id: 8, name: 'Drama' }, { id: 10, name: 'Fantasy' }, { id: 24, name: 'Sci-Fi' },
  { id: 7, name: 'Mystery' }, { id: 14, name: 'Horror' }, { id: 27, name: 'Shounen' },
  { id: 25, name: 'Shoujo' }, { id: 36, name: 'Slice of Life' }, { id: 30, name: 'Sports' },
];

function heroHTML(anime, isAiring) {
  const bg = escapeHtml(imageOf(anime));
  const id = Number(anime.mal_id) || 0;
  const score = anime.score ? anime.score.toFixed(1) : '—';
  return `
    <section class="hero">
      <div class="hero-bg" style="background-image:url('${bg}')"></div>
      <div class="hero-speedlines"></div>
      <div class="hero-gradient"></div>
      <div class="hero-content">
        <img class="hero-poster" src="${bg}" alt="" fetchpriority="high" />
        <div class="hero-info">
          <span class="hero-tag">${isAiring ? '🔥 AIRING NOW' : '✨ SPOTLIGHT'}</span>
          <h1 class="hero-title">${escapeHtml(anime.title)}</h1>
          <div class="hero-meta">
            <span class="chip">★ ${score}</span>
            <span class="chip">${escapeHtml(anime.type || '')}</span>
            <span class="chip">${anime.episodes ? anime.episodes + ' episodes' : 'Ongoing'}</span>
          </div>
          <p class="hero-synopsis">${escapeHtml((anime.synopsis || 'No synopsis yet — mysterious, like a good plot twist.').slice(0, 260))}</p>
          <div class="hero-actions">
            <button class="btn-pow btn-pow--pink" data-open="${id}">▶ VIEW DETAILS</button>
            <button class="btn-pow btn-pow--outline" id="lucky-btn">🎲 FEELING LUCKY</button>
          </div>
        </div>
      </div>
    </section>`;
}

function sectionFallback() {
  return `<div class="empty-state" style="padding:30px 10px">📡 This section couldn't load right now (the anime API may be busy). <button class="chip" id="retry-section">🔄 Retry section</button></div>`;
}

// Duplicated once inside a single flex track (not two separate tracks) so a
// translateX(-50%) animation loops seamlessly - the visible half always
// looks identical to what scrolled off, with no jump or gap.
function tickerHTML(airingToday) {
  if (!airingToday.length) return '';
  const itemHTML = (a) => `<a class="ticker-item" href="#/anime/${Number(a.mal_id) || 0}">${escapeHtml(a.title)}</a>`;
  const items = airingToday.slice(0, 16).map(itemHTML).join('');
  return `
    <div class="ticker-bar">
      <span class="ticker-label">📡 AIRING TODAY</span>
      <div class="ticker-track">
        <div class="ticker-move">${items}${items}</div>
      </div>
    </div>`;
}

// Each data source is fetched independently so one flaky endpoint (Jikan's
// upstream MyAnimeList connection can be unreliable) doesn't blank the whole
// page — sections that fail just show their own small retry prompt.
export async function renderHome(root) {
  root.innerHTML = loadingHTML('SUMMONING ANIME');

  const [airingRes, seasonRes, topRes, scheduleRes] = await Promise.allSettled([
    Api.topAnime(1, 'airing'),
    Api.seasonNow(1),
    Api.topAnime(1),
    Api.schedule(todayName()),
  ]);

  const airing = airingRes.status === 'fulfilled' ? airingRes.value.data : null;
  const seasonNow = seasonRes.status === 'fulfilled' ? seasonRes.value.data : null;
  const topAnime = topRes.status === 'fulfilled' ? topRes.value.data : null;
  const airingToday = scheduleRes.status === 'fulfilled' ? (scheduleRes.value.data || []) : [];

  if (!airing && !seasonNow && !topAnime) {
    root.innerHTML = errorHTML('Couldn’t reach the anime dimension right now (the free API may be temporarily down). Try again shortly!');
    wireRetry(root, () => renderHome(root));
    return;
  }

  const heroSource = airing || topAnime || seasonNow;
  const heroPick = heroSource?.[Math.floor(Math.random() * Math.min(5, heroSource.length))];
  const recentlyViewed = RecentlyViewed.list();
  const { user } = Auth.get();

  root.innerHTML = `
    ${heroPick ? heroHTML(heroPick, heroSource === airing) : ''}

    ${tickerHTML(airingToday)}

    ${recentlyViewed.length ? `
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">🕐 Continue Browsing</h2>
        <span class="section-sub">Picking up where you left off</span>
      </div>
      ${cardRail(recentlyViewed)}
    </section>` : ''}

    ${user ? `
    <section class="section" id="reco-section">
      <div class="section-head">
        <h2 class="section-title">🔀 Recommended For You</h2>
        <span class="section-sub">Based on your favorites</span>
      </div>
      ${skeletonRail()}
    </section>` : ''}

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">🔥 Trending Now</h2>
        <span class="section-sub">Top airing series this week</span>
      </div>
      ${airing ? cardRail(airing.slice(0, 14)) : sectionFallback()}
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">🍁 This Season</h2>
        <a href="#/browse?sort=season" class="chip">See all →</a>
      </div>
      ${seasonNow ? cardGrid(seasonNow.slice(0, 12)) : sectionFallback()}
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">🏆 All-Time Top Rated</h2>
        <a href="#/browse?sort=top" class="chip">See all →</a>
      </div>
      ${topAnime ? cardRail(topAnime.slice(0, 14)) : sectionFallback()}
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">🎭 Browse by Genre</h2>
      </div>
      <div class="genre-grid">
        ${FEATURED_GENRES.map((g) => `
          <a class="genre-tile" style="background:${genreGradient(g.id)}" href="#/browse?genre=${g.id}">${escapeHtml(g.name)}</a>
        `).join('')}
      </div>
    </section>
  `;

  root.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`#/anime/${btn.dataset.open}`));
  });
  root.querySelectorAll('#retry-section').forEach((btn) => {
    btn.addEventListener('click', () => renderHome(root));
  });
  const luckyBtn = root.querySelector('#lucky-btn');
  if (luckyBtn) {
    luckyBtn.addEventListener('click', async () => {
      luckyBtn.textContent = '🎲 ROLLING...';
      luckyBtn.disabled = true;
      try {
        const { data } = await Api.randomAnime();
        navigate(`#/anime/${data.mal_id}`);
      } catch {
        luckyBtn.textContent = '🎲 FEELING LUCKY';
        luckyBtn.disabled = false;
      }
    });
  }

  // Fetched separately from the Promise.allSettled batch above rather than
  // alongside it: it needs its own auth-gated backend call and can take a
  // few seconds (up to 15 upstream recommendation lookups on a cold cache),
  // so it shouldn't hold up the rest of Home rendering.
  if (user) loadRecommendations(root);
}

async function loadRecommendations(root) {
  const section = root.querySelector('#reco-section');
  if (!section) return;

  let data;
  try {
    data = await Recs.mine();
  } catch {
    section.remove();
    return;
  }

  // Not enough favorites yet (or no meaningful overlap found) - removing
  // the section entirely reads better than an awkward empty state on Home.
  if (!data.recommendations.length) {
    section.remove();
    return;
  }

  // Guards against a navigation away from Home while the fetch above was
  // still in flight - re-check the section is still the one we started with.
  if (!root.querySelector('#reco-section')) return;

  const names = data.basedOn.slice(0, 3).map((b) => b.title);
  const subtitle = `Because you favorited ${names.join(', ')}${data.basedOn.length > 3 ? ', and more' : ''}`;

  section.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">🔀 Recommended For You</h2>
      <span class="section-sub">${escapeHtml(subtitle)}</span>
    </div>
    ${cardRail(data.recommendations)}
  `;
}

import { Games } from '../../lib/gamesApi.js';
import { Auth } from '../../lib/authStore.js';
import { escapeHtml, loadingHTML } from '../../lib/ui.js';
import { GAME_CATALOG, BOARDS } from '../../lib/gameCatalog.js';
import { getLocalStats } from '../../lib/gameKit.js';
import { dailyStats, localDailyResults } from '../../lib/dailyStats.js';
import { statsPanelHTML } from './dailyChallenge.js';

// Inline SVG sparkline of the last runs' scores.
export function sparklineSVG(values, { width = 120, height = 32 } = {}) {
  if (values.length < 2) return '';
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Last ${values.length} scores"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

const LEGACY = { 'guess-the-anime': 'aninest_gta_best', 'higher-lower': 'aninest_hl_best' };

function rowHTML(slug, label, emoji, server) {
  const local = getLocalStats(slug, LEGACY[slug]);
  const s = server?.[slug];
  const best = Math.max(local.best, s?.best || 0);
  const plays = Math.max(local.plays, s?.plays || 0);
  if (!best && !plays) return '';
  const avg = local.plays ? (local.total / local.plays).toFixed(1) : '—';
  return `
    <tr>
      <th scope="row">${emoji} ${escapeHtml(label)}</th>
      <td>${plays}</td>
      <td><strong>${best}</strong></td>
      <td>${avg}</td>
      <td>${s?.weekBest ?? '—'}</td>
      <td>${s?.rank ? `#${s.rank}` : '—'}</td>
      <td class="spark-cell">${sparklineSVG(local.history.map((h) => h.s))}</td>
    </tr>`;
}

export async function renderGameStats(root) {
  document.title = 'My Game Stats — AniNest';
  root.innerHTML = loadingHTML('CRUNCHING NUMBERS');

  let server = null;
  if (Auth.get().user) {
    try { server = await Games.myStats(); } catch { server = null; }
  }

  const rows = [
    ...BOARDS.map((b) => rowHTML(b.slug, b.label, b.game.emoji, server?.games)),
    rowHTML('gta-local-easy', 'Guess the Anime: Easy', '🌱', null),
  ].filter(Boolean);

  const animeDaily = server?.daily || dailyStats(localDailyResults('aninest_daily_'));
  const mangaDaily = server?.mangaDaily || dailyStats(localDailyResults('aninest_manga_daily_'));
  const totalPlays = GAME_CATALOG.reduce((sum, g) => sum + g.local.reduce((s, slug) => s + getLocalStats(slug).plays, 0), 0)
    + animeDaily.played + mangaDaily.played;

  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">📊 My Game Stats</h1>
      <span class="section-sub">${server ? 'Ranks and weekly bests from your account; averages and trends from this device.' : 'From this device. Log in to see your leaderboard ranks and keep stats across devices.'}</span>
    </div>
    <div class="stats-tiles fx-stagger">
      <div class="stats-tile"><strong>${totalPlays}</strong><span>Games played</span></div>
      <div class="stats-tile"><strong>${rows.length}</strong><span>Modes tried</span></div>
      <div class="stats-tile"><strong>${animeDaily.currentStreak}</strong><span>Daily streak</span></div>
      <div class="stats-tile"><strong>${mangaDaily.currentStreak}</strong><span>Manga daily streak</span></div>
    </div>

    <h2 class="setup-heading">Streak games</h2>
    ${rows.length ? `
      <div class="stats-table-wrap">
        <table class="stats-table">
          <thead><tr><th scope="col">Game</th><th scope="col">Played</th><th scope="col">Best</th><th scope="col">Avg</th><th scope="col">This week</th><th scope="col">Rank</th><th scope="col">Last runs</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>` : '<p class="section-sub">No games played yet. <a href="#/games">Pick one!</a></p>'}

    <div class="stats-dailies">
      <div><h2 class="setup-heading">📅 Daily Challenge</h2>${statsPanelHTML(animeDaily)}</div>
      <div><h2 class="setup-heading">📖 Manga Daily</h2>${statsPanelHTML(mangaDaily)}</div>
    </div>
    <div class="hero-actions" style="justify-content:center;margin-top:24px">
      <a href="#/games" class="btn-pow btn-pow--pink">🎮 Back to Game Zone</a>
    </div>
  `;
}

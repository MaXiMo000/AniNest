import { apiGet, apiPost } from '../lib/http.js';
import { Auth } from '../lib/authStore.js';
import { escapeHtml, emptyHTML, errorHTML, loadingHTML, showToast, wireRetry } from '../lib/ui.js';
import { powSelectHTML } from '../lib/powSelect.js';
import { relativeTime } from './tournament.js';

// Season prediction league (backend/src/lib/predictions.js): guess the final
// AniList score of the season's 20 most popular shows. Picks lock two weeks
// in; after that the standings follow the live scores until the league is final.

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const seasonLabel = (d) => `${d.season[0]}${d.season.slice(1).toLowerCase()} ${d.year}`;
const fmt = (n) => (n == null ? '—' : Number(n).toFixed(1));

function statusHTML(d) {
  if (d.final) return `<p class="tournament-status"><strong>Final results.</strong> ${d.players} player${d.players === 1 ? '' : 's'}.</p>`;
  if (d.open) {
    const login = Auth.get().user ? '' : ' <a href="#/login">Log in</a> to play.';
    return `<p class="tournament-status"><strong>Picks are open</strong> · they lock ${escapeHtml(relativeTime(d.locksAt))}. Guess each show's final AniList score: 10 points for spot on, one less for every 0.1 you're off.${login}</p>`;
  }
  if (Date.parse(d.opensAt) > Date.now()) return `<p class="tournament-status">Picks open ${escapeHtml(relativeTime(d.opensAt))}.</p>`;
  return `<p class="tournament-status"><strong>Picks are locked.</strong> Standings follow the live AniList scores until the results are final ${escapeHtml(relativeTime(d.finalAt))}.</p>`;
}

function showHTML(d, s) {
  const canPick = d.open && Auth.get().user;
  const result = d.open ? '' : `
    <div class="predict-stats">
      <span>Score <strong>${fmt(s.score)}</strong></span>
      <span>Crowd <strong>${fmt(s.crowd)}</strong></span>
      <span>You <strong>${fmt(s.mine)}</strong></span>
      ${s.points != null ? `<span class="predict-points">+${s.points}</span>` : ''}
    </div>`;
  return `
    <li class="predict-show">
      ${s.image ? `<img src="${escapeHtml(s.image)}" alt="" loading="lazy" />` : '<div class="duel-cover"></div>'}
      <div class="duel-body">
        <a class="duel-song" href="#/anime/${Number(s.mal_id)}">${escapeHtml(s.title)}</a>
        ${canPick ? `<label class="predict-input">Your guess
          <input type="number" inputmode="decimal" min="1" max="10" step="0.1" data-mal="${Number(s.mal_id)}" value="${s.mine ?? ''}" placeholder="e.g. 7.8" />
        </label>` : ''}
        ${result}
      </div>
    </li>`;
}

function standingsHTML(d) {
  if (!d.standings.length) return emptyHTML(d.open ? 'No picks yet. Be the first!' : 'Nobody played this season.', '🔮');
  const me = Auth.get().user?.username;
  const inTop = d.me && d.standings.some((r) => r.username === me);
  return `
    <ol class="leaderboard-list">${d.standings.map((r) => `
      <li class="leaderboard-row ${r.username === me ? 'is-me' : ''}">
        <span class="leaderboard-rank">${RANK_MEDAL[r.rank] || `#${r.rank}`}</span>
        <a class="leaderboard-user" href="#/u/${encodeURIComponent(r.username)}">${escapeHtml(r.username)}</a>
        <span class="leaderboard-level">${r.picks} pick${r.picks === 1 ? '' : 's'}</span>
        <span class="leaderboard-streak">🔮 ${r.points} pts</span>
      </li>`).join('')}
    </ol>
    ${d.me && !inTop ? `<div class="leaderboard-you"><span class="leaderboard-rank">#${d.me.rank}</span><span class="leaderboard-user">You</span><span class="leaderboard-streak">🔮 ${d.me.points} pts</span></div>` : ''}`;
}

function pageHTML(d) {
  const canPick = d.open && Auth.get().user;
  return `
    ${statusHTML(d)}
    <ul class="predict-grid">${d.shows.map((s) => showHTML(d, s)).join('')}</ul>
    ${canPick ? '<div class="hero-actions" style="justify-content:center;margin:16px 0"><button class="btn-pow btn-pow--pink" id="predict-save">💾 SAVE PICKS</button></div>' : ''}
    ${d.open ? '' : `<div class="section-head"><h2 class="section-title">Standings</h2></div>${standingsHTML(d)}`}`;
}

function wire(slot, state) {
  slot.querySelector('#predict-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const picks = [];
    for (const input of slot.querySelectorAll('input[data-mal]')) {
      const malId = Number(input.dataset.mal);
      const before = state.data.shows.find((s) => s.mal_id === malId)?.mine ?? null;
      const raw = input.value.trim();
      const score = raw === '' ? null : Number(raw);
      if (score != null && !(score >= 1 && score <= 10)) {
        input.focus();
        showToast('Scores go from 1.0 to 10.0.');
        return;
      }
      if (score !== before) picks.push({ mal_id: malId, score });
    }
    if (!picks.length) { showToast('Nothing changed.'); return; }
    btn.disabled = true;
    try {
      state.data = (await apiPost(`/api/predictions/${state.data.id}/picks`, { picks })).data;
      slot.innerHTML = pageHTML(state.data);
      wire(slot, state);
      showToast('Picks saved!');
    } catch (err) {
      btn.disabled = false;
      showToast(err.message || 'Couldn’t save your picks — try again.');
    }
  });
}

async function loadSeasonPicker(root, pick) {
  const slot = root.querySelector('#season-picker');
  let seasons;
  try {
    ({ seasons } = await apiGet('/api/predictions/seasons'));
  } catch {
    return;
  }
  if (!slot?.isConnected || seasons.length < 2) return;
  slot.innerHTML = `
    <span class="section-sub" style="font-weight:800">Season</span>
    ${powSelectHTML({
    id: 'season-select',
    options: [{ value: '', label: 'Latest' }, ...seasons.map((x) => ({ value: `${x.season}:${x.year}`, label: seasonLabel(x) }))],
    value: pick ? `${pick.season}:${pick.year}` : '',
  })}`;
  slot.querySelector('#season-select').addEventListener('change', (e) => {
    const [season, year] = e.target.value.split(':');
    window.location.hash = e.target.value ? `#/predictions?season=${season}&year=${year}` : '#/predictions';
  });
}

export async function renderPredictions(root, params) {
  const season = String(params?.get('season') || '').toUpperCase();
  const year = Number(params?.get('year'));
  const pick = /^(WINTER|SPRING|SUMMER|FALL)$/.test(season) && Number.isInteger(year) && year > 1990 ? { season, year } : null;
  document.title = 'Season Predictions — AniNest';
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🔮 Season Predictions</h1>
      <span class="section-sub">Call the season before it happens: guess where each big show's score ends up.</span>
    </div>
    <div id="season-picker" class="hero-actions" style="align-items:center;gap:10px;margin:6px 0 10px"></div>
    <div id="predict-slot">${loadingHTML('GAZING INTO THE CRYSTAL BALL')}</div>`;
  const slot = root.querySelector('#predict-slot');

  let res;
  try {
    res = await apiGet(pick ? `/api/predictions/${pick.year}/${pick.season.toLowerCase()}` : '/api/predictions/current');
  } catch {
    if (!root.isConnected) return;
    slot.innerHTML = errorHTML('Couldn’t load the league.');
    wireRetry(slot, () => renderPredictions(root, params));
    return;
  }
  if (!root.isConnected) return;
  loadSeasonPicker(root, pick);
  if (!res.data) {
    slot.innerHTML = emptyHTML(pick ? `There was no league in ${seasonLabel(res)}.` : `The ${seasonLabel(res)} lineup isn’t out yet. Check back soon.`, '🔮');
    return;
  }
  root.querySelector('.section-title').textContent = `🔮 ${seasonLabel(res.data)} Predictions`;
  const state = { data: res.data };
  slot.innerHTML = pageHTML(state.data);
  wire(slot, state);
}

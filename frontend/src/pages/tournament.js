import { apiGet, apiPost } from '../lib/http.js';
import { Auth } from '../lib/authStore.js';
import { escapeHtml, emptyHTML, errorHTML, loadingHTML, showToast, wireRetry } from '../lib/ui.js';
import { autoplayVideoOnView } from '../lib/autoplayOnView.js';
import { powSelectHTML } from '../lib/powSelect.js';

// Season OP/ED tournament (backend/src/routes/tournaments.js): the season's
// 16 most popular shows' openings (or endings) in a bracket, one round every
// few days. Songs play through the same creditless videos as the jukebox, or
// fall back to listen-elsewhere links when only MAL's song list was available.

const KIND_LABEL = { OP: 'Opening', ED: 'Ending' };
const PENDING_RETRY_MS = 5000;
const PENDING_TRIES = 12;

const seasonLabel = (d) => `${d.season[0]}${d.season.slice(1).toLowerCase()} ${d.year}`;

export function relativeTime(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  const abs = Math.abs(ms);
  const [n, unit] = abs >= 86400000 ? [Math.round(abs / 86400000), 'day'] : abs >= 3600000 ? [Math.round(abs / 3600000), 'hour'] : [Math.max(1, Math.round(abs / 60000)), 'minute'];
  const text = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return ms >= 0 ? `in ${text}` : `${text} ago`;
}

function listenLinksHTML(song) {
  const q = encodeURIComponent([song.title, song.artist || song.anime_title].filter(Boolean).join(' '));
  return `
    <a class="chip" target="_blank" rel="noopener" href="https://music.youtube.com/search?q=${q}">▶ YouTube Music</a>
    <a class="chip" target="_blank" rel="noopener" href="https://open.spotify.com/search/${q}">🎧 Spotify</a>`;
}

const songLabel = (s) => `${s.slug} — ${s.title}`;

function sideHTML(data, round, m, seed) {
  const s = data.entries.find((e) => e.seed === seed);
  if (!s) return '<div class="duel-side duel-side--empty">To be decided</div>';
  const mine = data.myVotes[`${round.round}:${m.match}`];
  const votes = seed === m.a ? m.votesA : m.votesB;
  const total = (m.votesA || 0) + (m.votesB || 0);
  const pct = votes != null && total ? Math.round((votes / total) * 100) : null;
  const isOpen = m.status === 'open';
  const classes = ['duel-side', mine === seed ? 'is-mine' : '', m.winner === seed ? 'is-winner' : '', m.winner && m.winner !== seed ? 'is-out' : ''].filter(Boolean).join(' ');
  let action = '';
  if (isOpen && Auth.get().user) {
    action = `<button class="btn-pow btn-pow--sm ${mine === seed ? 'btn-pow--pink' : 'btn-pow--outline'}" data-vote="${seed}" data-round="${round.round}" data-match="${m.match}">${mine === seed ? '✓ YOUR PICK' : 'VOTE'}</button>`;
  }
  return `
    <div class="${classes}">
      ${s.image ? `<img src="${escapeHtml(s.image)}" alt="" loading="lazy" />` : '<div class="duel-cover"></div>'}
      <div class="duel-body">
        <span class="duel-seed">#${s.seed}</span>
        <strong class="duel-song">${escapeHtml(s.title)}</strong>
        ${s.artist ? `<span class="duel-artist">${escapeHtml(s.artist)}</span>` : ''}
        <a class="duel-anime" href="#/anime/${Number(s.mal_id)}">${escapeHtml(s.anime_title)} · ${escapeHtml(s.slug)}</a>
        <div class="duel-actions">
          <button class="chip" data-play="${s.seed}">▶ Play</button>
          ${action}
        </div>
        ${pct != null ? `<div class="duel-bar" title="${votes} vote${votes === 1 ? '' : 's'}"><span style="width:${pct}%"></span></div><span class="duel-pct">${pct}% · ${votes} vote${votes === 1 ? '' : 's'}</span>` : ''}
      </div>
    </div>`;
}

function duelHTML(data, round, m) {
  return `
    <div class="duel">
      ${sideHTML(data, round, m, m.a)}
      <div class="duel-vs">VS</div>
      ${sideHTML(data, round, m, m.b)}
    </div>`;
}

function bracketHTML(data) {
  const name = (seed) => {
    const s = data.entries.find((e) => e.seed === seed);
    return s ? `#${s.seed} ${escapeHtml(s.title)}` : '—';
  };
  const line = (m, seed) => `<li class="${m.winner === seed ? 'is-winner' : m.winner ? 'is-out' : ''}">${name(seed)}</li>`;
  return `
    <div class="bracket">
      ${data.rounds.map((r) => `
        <div class="bracket-round">
          <h3>${escapeHtml(r.name)}</h3>
          <div class="bracket-matches">${r.matches.map((m) => `<ul class="bracket-match">${line(m, m.a)}${line(m, m.b)}</ul>`).join('')}</div>
        </div>`).join('')}
    </div>`;
}

function statusHTML(data) {
  const open = data.rounds.find((r) => r.round === data.currentRound);
  if (data.finished) {
    const champ = data.entries.find((e) => e.seed === data.champion);
    return `
      <div class="champion">
        <span class="big-emoji">🏆</span>
        <div>
          <div class="muted-note">Best ${KIND_LABEL[data.kind]} of ${seasonLabel(data)}</div>
          <strong class="champion-song">${escapeHtml(champ?.title || '')}</strong>
          <div>${escapeHtml([champ?.artist, champ?.anime_title].filter(Boolean).join(' · '))}</div>
        </div>
        ${champ ? `<button class="btn-pow btn-pow--pink" data-play="${champ.seed}">▶ PLAY</button>` : ''}
      </div>`;
  }
  if (!open) return `<p class="tournament-status">Voting opens ${escapeHtml(relativeTime(data.rounds[0].opensAt))}.</p>`;
  const login = Auth.get().user ? '' : ' <a href="#/login">Log in</a> to vote.';
  return `<p class="tournament-status"><strong>${escapeHtml(open.name)}</strong> · voting closes ${escapeHtml(relativeTime(open.closesAt))}. Ties go to the higher seed.${login}</p>`;
}

function pageHTML(data) {
  const open = data.rounds.find((r) => r.round === data.currentRound);
  const shown = open || [...data.rounds].reverse().find((r) => r.status === 'done');
  const first = data.entries.find((e) => e.seed === (data.champion || shown?.matches[0]?.a)) || data.entries[0];
  return `
    ${statusHTML(data)}
    <div class="tv-frame tourney-tv">
      <div class="tv-screen"><video id="tourney-player" style="width:100%;height:100%" controls preload="none"${first?.videoUrl ? ` src="${escapeHtml(first.videoUrl)}"` : ''}></video></div>
      <div class="tv-label" id="tourney-now-playing">${first ? `▶ ${escapeHtml(songLabel(first))} · ${escapeHtml(first.anime_title)}` : ''}</div>
    </div>
    <p class="muted-note" id="tourney-video-down" ${first && !first.videoUrl ? '' : 'hidden'}>No creditless video for this one right now. You can still listen:</p>
    <div class="song-links" id="tourney-listen">${first ? listenLinksHTML(first) : ''}</div>
    ${shown ? `
      <div class="section-head"><h2 class="section-title">${escapeHtml(shown.name)}</h2></div>
      <div class="duels">${shown.matches.map((m) => duelHTML(data, shown, m)).join('')}</div>` : ''}
    <div class="section-head"><h2 class="section-title">Bracket</h2></div>
    ${bracketHTML(data)}`;
}

function wire(root, slot, state) {
  const player = slot.querySelector('#tourney-player');
  if (player) autoplayVideoOnView(player);
  player?.addEventListener('error', () => slot.querySelector('#tourney-video-down')?.removeAttribute('hidden'));
  slot.querySelectorAll('[data-play]').forEach((btn) => btn.addEventListener('click', () => {
    const s = state.data.entries.find((e) => e.seed === Number(btn.dataset.play));
    if (!s) return;
    slot.querySelector('#tourney-now-playing').textContent = `▶ ${songLabel(s)} · ${s.anime_title}`;
    slot.querySelector('#tourney-listen').innerHTML = listenLinksHTML(s);
    const down = slot.querySelector('#tourney-video-down');
    if (s.videoUrl) {
      down.hidden = true;
      player.src = s.videoUrl;
      player.play().catch(() => {});
      player.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      player.removeAttribute('src');
      player.load();
      down.hidden = false;
    }
  }));
  slot.querySelectorAll('[data-vote]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await apiPost(`/api/tournaments/${state.data.id}/vote`, {
        round: Number(btn.dataset.round), match: Number(btn.dataset.match), seed: Number(btn.dataset.vote),
      });
      state.data = res.data;
      slot.innerHTML = pageHTML(state.data);
      wire(root, slot, state);
    } catch (err) {
      btn.disabled = false;
      showToast(err.message || 'Couldn’t save your vote — try again.');
    }
  }));
}

const SEASON_RE = /^(WINTER|SPRING|SUMMER|FALL)$/;
const pickHref = (kind, pick) => `#/tournament?kind=${kind}${pick ? `&season=${pick.season}&year=${pick.year}` : ''}`;

// Past seasons, filled in after the bracket loads (GET /api/tournaments/seasons).
async function loadSeasonPicker(root, kind, pick) {
  const slot = root.querySelector('#season-picker');
  if (!slot) return;
  let seasons;
  try {
    ({ seasons } = await apiGet('/api/tournaments/seasons'));
  } catch {
    return;
  }
  if (!slot.isConnected || seasons.length < 2) return;
  const current = pick ? `${pick.season}:${pick.year}` : null;
  slot.innerHTML = `
    <span class="section-sub" style="font-weight:800">Season</span>
    ${powSelectHTML({
    id: 'season-select',
    options: [{ value: '', label: 'Latest' }, ...seasons.map((x) => ({ value: `${x.season}:${x.year}`, label: seasonLabel(x) }))],
    value: current || '',
  })}`;
  slot.querySelector('#season-select').addEventListener('change', (e) => {
    const [season, year] = e.target.value.split(':');
    window.location.hash = pickHref(kind, e.target.value ? { season, year } : null);
  });
}

export async function renderTournament(root, params) {
  const kind = params?.get('kind') === 'ED' ? 'ED' : 'OP';
  const season = String(params?.get('season') || '').toUpperCase();
  const year = Number(params?.get('year'));
  const pick = SEASON_RE.test(season) && Number.isInteger(year) && year > 1990 ? { season, year } : null;
  document.title = `Best ${KIND_LABEL[kind]} Tournament — AniNest`;
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🏆 OP/ED Tournament</h1>
      <span class="section-sub">The season's best opening and ending, decided by you. 16 songs from the most popular shows, one round every few days.</span>
    </div>
    <div class="vibe-examples" role="tablist">
      ${Object.entries(KIND_LABEL).map(([k, label]) => `<a class="chip${k === kind ? ' active' : ''}" role="tab" aria-selected="${k === kind}" href="${pickHref(k, pick)}">Best ${label}</a>`).join('')}
    </div>
    <div id="season-picker" class="hero-actions" style="align-items:center;gap:10px;margin:6px 0 10px"></div>
    <div id="tourney-slot">${loadingHTML('LOADING THE BRACKET')}</div>`;
  const slot = root.querySelector('#tourney-slot');

  const load = async (tries = 0) => {
    let res;
    try {
      res = await apiGet(pick
        ? `/api/tournaments/${pick.year}/${pick.season.toLowerCase()}?kind=${kind}`
        : `/api/tournaments/current?kind=${kind}`);
    } catch {
      if (!root.isConnected) return;
      slot.innerHTML = errorHTML('Couldn’t load the tournament.');
      wireRetry(slot, () => { slot.innerHTML = loadingHTML('LOADING THE BRACKET'); load(); });
      return;
    }
    if (!root.isConnected) return;
    if (res.pending) {
      slot.innerHTML = loadingHTML('PICKING THIS SEASON’S SONGS');
      if (tries < PENDING_TRIES) setTimeout(() => load(tries + 1), PENDING_RETRY_MS);
      return;
    }
    if (!res.data && pick) {
      slot.innerHTML = emptyHTML(`There was no Best ${KIND_LABEL[kind]} bracket in ${seasonLabel(pick)}.`, '🎵');
      loadSeasonPicker(root, kind, pick);
      return;
    }
    if (!res.data) {
      slot.innerHTML = emptyHTML(`Not enough ${KIND_LABEL[kind].toLowerCase()}s are known for ${seasonLabel(res)} yet. Check back soon.`, '🎵');
      return;
    }
    const state = { data: res.data };
    root.querySelector('.section-title').textContent = `🏆 Best ${KIND_LABEL[kind]} · ${seasonLabel(res.data)}`;
    slot.innerHTML = pageHTML(state.data);
    wire(root, slot, state);
    loadSeasonPicker(root, kind, pick);
  };
  load();
}

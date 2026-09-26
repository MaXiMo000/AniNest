import { apiGet, apiPost } from '../lib/http.js';
import { Auth } from '../lib/authStore.js';
import { imageOf } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { animeCard, escapeHtml, emptyHTML, errorHTML, loadingHTML, showToast, wireRetry } from '../lib/ui.js';

// Watch Together (backend/src/routes/rooms.js): a room code, friends join
// signed in or as guests, everyone swipes, and the room shows the picks that
// suit the whole group. A member's seat token and own swipes are kept in this
// browser, per room.

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music',
  'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const POLL_MS = 8000;

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: works until reload */ }
  },
};
const seatKey = (code) => `aninest:room:${code}`;
const votesKey = (code) => `aninest:room:${code}:votes`;

export function renderTogether(root) {
  document.title = 'Watch Together — AniNest';
  const user = Auth.get().user;
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🍿 Watch Together</h1>
      <span class="section-sub">Can't agree on what to watch? Open a room, share the code, and everyone swipes. We find what suits all of you, not just the loudest person.</span>
    </div>
    <div class="together-grid">
      <section class="together-box">
        <h2>Start a room</h2>
        <p class="muted-note">Rooms last 24 hours and fit up to 8 people. Friends can join without an account.</p>
        ${user
          ? '<button id="room-create" class="btn-pow btn-pow--pink">OPEN A ROOM</button>'
          : '<a href="#/login" class="btn-pow btn-pow--pink">LOG IN TO OPEN A ROOM</a>'}
      </section>
      <section class="together-box">
        <h2>Join a room</h2>
        <form id="room-join" class="vibe-form">
          <input id="room-code" maxlength="6" autocomplete="off" aria-label="Room code" placeholder="ROOM CODE" style="text-transform:uppercase" />
          <button type="submit" class="btn-pow btn-pow--blue">JOIN</button>
        </form>
      </section>
    </div>`;

  root.querySelector('#room-create')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { code, memberToken } = await apiPost('/api/rooms');
      store.set(seatKey(code), memberToken);
      navigate(`#/together/${code}`);
    } catch {
      e.target.disabled = false;
      showToast('Couldn’t open a room — try again.');
    }
  });
  root.querySelector('#room-join').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = root.querySelector('#room-code').value.trim().toUpperCase();
    if (/^[A-Z2-9]{6}$/.test(code)) navigate(`#/together/${code}`);
    else showToast('Room codes are 6 letters and numbers.');
  });
}

function joinHTML() {
  const user = Auth.get().user;
  if (user) {
    return `
      <section class="together-box">
        <h2>Join this room</h2>
        <p class="muted-note">Your list tells the room what you like, and anything you've already watched won't come up.</p>
        <button id="join-me" class="btn-pow btn-pow--pink">JOIN AS ${escapeHtml(user.username.toUpperCase())}</button>
      </section>`;
  }
  return `
    <section class="together-box">
      <h2>Join as a guest</h2>
      <form id="join-guest">
        <input id="guest-name" maxlength="20" required aria-label="Your name" placeholder="Your name" class="together-input" />
        <p class="muted-note">Pick up to 5 genres you're in the mood for:</p>
        <div class="vibe-examples" id="guest-genres">
          ${GENRES.map((g) => `<button type="button" class="chip" data-genre="${escapeHtml(g)}" aria-pressed="false">${escapeHtml(g)}</button>`).join('')}
        </div>
        <button type="submit" class="btn-pow btn-pow--pink">JOIN</button>
        <p class="muted-note">Or <a href="#/login">log in</a> so your list does the talking.</p>
      </form>
    </section>`;
}

function deckCardHTML(c) {
  return `
    <div class="swipe-card">
      <img src="${escapeHtml(imageOf(c))}" alt="" />
      <div class="swipe-body">
        <a class="wo-title" href="#/anime/${Number(c.mal_id)}">${escapeHtml(c.title)}</a>
        <div class="wo-meta">${escapeHtml([c.type, c.episodes && c.type !== 'Movie' ? `${c.episodes} eps` : null, c.year, c.score ? `★ ${c.score}` : null].filter(Boolean).join(' · '))}</div>
        <div class="vibe-reasons">${(c.genres || []).map((g) => `<span>${escapeHtml(g)}</span>`).join('')}</div>
        ${c.everyoneLikes?.length ? `<p class="muted-note">Everyone here likes ${escapeHtml(c.everyoneLikes.join(', '))}.</p>` : ''}
        <div class="swipe-actions">
          <button class="btn-pow btn-pow--outline" data-vote="-1" data-id="${Number(c.mal_id)}">👎 NOT FOR ME</button>
          <button class="btn-pow btn-pow--pink" data-vote="1" data-id="${Number(c.mal_id)}">👍 I'D WATCH IT</button>
        </div>
      </div>
    </div>`;
}

function pickHTML(p) {
  const why = [
    p.everyoneLikes?.length ? `Everyone likes ${p.everyoneLikes.join(', ')}` : null,
    p.likes ? `👍 ×${p.likes}` : null,
  ].filter(Boolean);
  return `<div class="vibe-result">${animeCard(p)}<div class="vibe-reasons">${why.map((w) => `<span>${escapeHtml(w)}</span>`).join('')}</div></div>`;
}

// myVotes is null until this browser has a seat in the room.
function roomHTML(room, code, myVotes) {
  const link = `${window.location.origin}${window.location.pathname}#/together/${code}`;
  const next = myVotes && room.candidates.find((c) => !myVotes[c.mal_id]);
  return `
    <div class="section-head">
      <h1 class="section-title">🍿 Room ${escapeHtml(code)}</h1>
      <span class="section-sub">Share the code or link. Expires ${escapeHtml(new Date(`${room.expiresAt.replace(' ', 'T')}Z`).toLocaleString())}.</span>
    </div>
    <div class="together-share">
      <input readonly value="${escapeHtml(link)}" aria-label="Room link" class="together-input" />
      <button id="copy-room" class="chip">📋 Copy link</button>
    </div>
    <div class="vibe-chips" aria-label="Who's here">
      ${room.members.map((m) => `<span class="vibe-chip">${m.guest ? '🙂' : '👤'} ${escapeHtml(m.name)} · ${Number(m.votes)} swipe${Number(m.votes) === 1 ? '' : 's'}</span>`).join('')}
    </div>
    <div class="together-grid">
      ${myVotes ? `
      <section class="together-box">
        <h2>Swipe</h2>
        ${next ? deckCardHTML(next) : '<p class="muted-note">You’ve swiped everything for now. The picks update as the others swipe.</p>'}
      </section>` : joinHTML()}
      <section class="together-box">
        <h2>🎯 Picks for all of you</h2>
        ${room.picks.length
          ? `<div class="card-grid together-picks">${room.picks.map(pickHTML).join('')}</div>`
          : '<p class="muted-note">Picks appear once a second person joins.</p>'}
      </section>
    </div>`;
}

export async function renderRoom(root, code) {
  code = String(code).toUpperCase();
  document.title = `Room ${code} — Watch Together — AniNest`;
  root.innerHTML = loadingHTML('OPENING THE ROOM');

  let room;
  const load = async () => {
    room = await apiGet(`/api/rooms/${encodeURIComponent(code)}`);
  };
  try {
    await load();
  } catch (err) {
    if (err.status === 404) {
      root.innerHTML = emptyHTML('That room doesn’t exist or has expired. Rooms last 24 hours.', '🍿');
      return;
    }
    root.innerHTML = errorHTML('Couldn’t open the room — try again.');
    wireRetry(root, () => renderRoom(root, code));
    return;
  }

  const draw = () => {
    if (!root.isConnected) return;
    const token = store.get(seatKey(code), null);
    const myVotes = token ? store.get(votesKey(code), {}) : null;
    root.innerHTML = roomHTML(room, code, myVotes);
    root.querySelector('#copy-room').addEventListener('click', () => {
      navigator.clipboard?.writeText(root.querySelector('.together-share input').value).then(() => showToast('Link copied!'), () => {});
    });
    if (!token) {
      wireJoin();
      return;
    }
    root.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', async () => {
      root.querySelectorAll('[data-vote]').forEach((x) => { x.disabled = true; });
      const malId = Number(b.dataset.id);
      try {
        await apiPost(`/api/rooms/${code}/vote`, { memberToken: token, mal_id: malId, vote: Number(b.dataset.vote) });
        store.set(votesKey(code), { ...myVotes, [malId]: Number(b.dataset.vote) });
        await load();
      } catch {
        showToast('That swipe didn’t go through — try again.');
      }
      draw();
    }));
  };

  const wireJoin = () => {
    const seat = async (body) => {
      try {
        const { memberToken } = await apiPost(`/api/rooms/${code}/join`, body);
        store.set(seatKey(code), memberToken);
        await load();
        draw();
      } catch (err) {
        showToast(err.message || 'Couldn’t join — try again.');
      }
    };
    root.querySelector('#join-me')?.addEventListener('click', () => seat({}));
    const picked = new Set();
    root.querySelectorAll('[data-genre]').forEach((b) => b.addEventListener('click', () => {
      if (!picked.has(b.dataset.genre) && picked.size >= 5) { showToast('Up to 5 genres.'); return; }
      if (picked.has(b.dataset.genre)) picked.delete(b.dataset.genre); else picked.add(b.dataset.genre);
      b.classList.toggle('active', picked.has(b.dataset.genre));
      b.setAttribute('aria-pressed', String(picked.has(b.dataset.genre)));
    }));
    root.querySelector('#join-guest')?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!picked.size) { showToast('Pick at least one genre.'); return; }
      seat({ name: root.querySelector('#guest-name').value.trim(), genres: [...picked] });
    });
  };

  draw();
  // Keep up with the others while this page is open; stops once the user
  // navigates away (the router detaches this root). Doesn't redraw mid-join.
  const poll = setInterval(async () => {
    if (!root.isConnected) { clearInterval(poll); return; }
    if (root.querySelector('#join-guest, #join-me') || document.activeElement?.closest?.('[data-vote]')) return;
    try {
      await load();
      draw();
    } catch { /* keep the last state */ }
  }, POLL_MS);
}

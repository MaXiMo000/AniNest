import { apiGet } from '../lib/http.js';
import { Auth } from '../lib/authStore.js';
import { escapeHtml, emptyHTML, errorHTML, loadingHTML, showToast, wireRetry } from '../lib/ui.js';

// AniNest Wrapped (backend/src/routes/wrapped.js): your year in anime from
// the episodes you ticked off, plus a PNG card drawn right here in a canvas
// to download or share. The card is text only: cover images come from other
// hosts and would block the canvas export.

const CARD_W = 1080;
const CARD_H = 1350;

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function statTile(value, label) {
  return `<div class="wrapped-tile"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function monthsHTML(months) {
  const max = Math.max(1, ...months);
  const names = 'JFMAMJJASOND';
  return `
    <div class="wrapped-months" role="img" aria-label="Episodes per month">
      ${months.map((n, i) => `<div class="wrapped-month" title="${n} episodes"><span style="height:${Math.round((n / max) * 100)}%"></span><em>${names[i]}</em></div>`).join('')}
    </div>`;
}

function pageHTML(w, sofar) {
  const bingeDate = w.biggestBinge ? new Date(`${w.biggestBinge.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  return `
    <div class="wrapped-hero">
      <span class="muted-note">${escapeHtml(w.username)}, you were a</span>
      <strong class="wrapped-persona">${escapeHtml(w.persona)}</strong>
      <span class="muted-note">${sofar ? `in ${w.year} so far` : `in ${w.year}`}</span>
    </div>
    <div class="wrapped-tiles">
      ${statTile(w.episodes.toLocaleString(), 'episodes')}
      ${statTile(`~${w.hours.toLocaleString()}`, 'hours')}
      ${statTile(w.shows, w.shows === 1 ? 'show' : 'shows')}
      ${statTile(w.finished, 'finished')}
      ${statTile(w.longestStreak, 'day streak')}
    </div>
    <div class="wrapped-grid">
      <section class="together-box">
        <h2>Most watched</h2>
        <ol class="wrapped-list">
          ${w.topShows.map((s) => `<li><a href="#/anime/${Number(s.mal_id)}">${escapeHtml(s.title)}</a><span>${plural(s.episodes, 'ep')}</span></li>`).join('')}
        </ol>
      </section>
      <section class="together-box">
        <h2>Top genres</h2>
        ${w.topGenres.length
          ? `<ol class="wrapped-list">${w.topGenres.map((g) => `<li>${escapeHtml(g.name)}<span>${plural(g.episodes, 'ep')}</span></li>`).join('')}</ol>`
          : '<p class="muted-note">Genres show up for titles saved with them.</p>'}
      </section>
      <section class="together-box">
        <h2>Your year by month</h2>
        ${monthsHTML(w.months)}
        <p class="muted-note">Busiest: ${escapeHtml(w.busiestMonth.name)}, ${plural(w.busiestMonth.episodes, 'episode')}.</p>
      </section>
      <section class="together-box">
        <h2>Highlights</h2>
        <ul class="wrapped-highlights">
          ${w.biggestBinge ? `<li>🔥 Biggest binge: <strong>${plural(w.biggestBinge.episodes, 'episode')}</strong> of ${escapeHtml(w.biggestBinge.title)} on ${escapeHtml(bingeDate)}</li>` : ''}
          ${w.favorite ? `<li>⭐ Highest rated: <strong>${escapeHtml(w.favorite.title)}</strong> (${w.favorite.rating}/10)</li>` : ''}
          <li>📅 You watched on ${plural(w.daysWatched, 'day')}</li>
        </ul>
      </section>
    </div>
    <div class="wrapped-share">
      <button id="wrapped-share" class="btn-pow btn-pow--pink">📤 SHARE MY CARD</button>
      <button id="wrapped-download" class="btn-pow btn-pow--outline">🖼️ DOWNLOAD PNG</button>
    </div>
    <p class="muted-note">Hours are an estimate (24 minutes an episode, 100 for a movie). Only episodes ticked off one at a time count, not catch-up jumps.</p>`;
}

// Long titles are cut to fit the card width with an ellipsis.
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

export function drawCard(canvas, w, sofar) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#2a0f4f');
  bg.addColorStop(0.55, '#7b2ff7');
  bg.addColorStop(1, '#ff2d78');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const pad = 80;
  const width = CARD_W - pad * 2;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(`ANINEST WRAPPED ${w.year}${sofar ? ' · SO FAR' : ''}`, pad, 140);

  ctx.fillStyle = '#ffffff';
  ctx.font = '36px sans-serif';
  ctx.fillText(fitText(ctx, `${w.username} was a`, width), pad, 230);
  ctx.font = 'bold 76px sans-serif';
  ctx.fillText(fitText(ctx, w.persona, width), pad, 320);

  const tiles = [[w.episodes.toLocaleString(), 'episodes'], [`~${w.hours.toLocaleString()}`, 'hours'], [String(w.shows), w.shows === 1 ? 'show' : 'shows']];
  const tileW = (width - 40) / 3;
  tiles.forEach(([value, label], i) => {
    const x = pad + i * (tileW + 20);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x, 380, tileW, 170);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText(fitText(ctx, value, tileW - 40), x + 20, 470);
    ctx.font = '32px sans-serif';
    ctx.fillText(label, x + 20, 525);
  });

  let y = 640;
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('MOST WATCHED', pad, y);
  ctx.fillStyle = '#ffffff';
  w.topShows.slice(0, 5).forEach((s, i) => {
    y += 60;
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(`${i + 1}`, pad, y);
    ctx.font = '40px sans-serif';
    ctx.fillText(fitText(ctx, s.title, width - 60), pad + 60, y);
  });

  y += 100;
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('TOP GENRES', pad, y);
  ctx.fillStyle = '#ffffff';
  ctx.font = '40px sans-serif';
  ctx.fillText(fitText(ctx, w.topGenres.map((g) => g.name).join(' · ') || '—', width), pad, y + 60);

  ctx.font = '32px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const bits = [`Longest streak ${plural(w.longestStreak, 'day')}`, `${w.finished} finished`];
  ctx.fillText(fitText(ctx, bits.join('  ·  '), width), pad, CARD_H - 150);
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('aninest', pad, CARD_H - 80);
  return canvas;
}

function cardBlob(w, sofar) {
  const canvas = drawCard(document.createElement('canvas'), w, sofar);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed.'))), 'image/png'));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wire(root, w, sofar) {
  const name = `aninest-wrapped-${w.year}.png`;
  root.querySelector('#wrapped-download').addEventListener('click', async () => {
    try { download(await cardBlob(w, sofar), name); } catch { showToast('Couldn’t make the image — try again.'); }
  });
  root.querySelector('#wrapped-share').addEventListener('click', async () => {
    try {
      const file = new File([await cardBlob(w, sofar)], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `My ${w.year} in anime` });
      } else {
        download(file, name);
        showToast('Saved the card. Post it anywhere!');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') showToast('Couldn’t share the card — try downloading it.');
    }
  });
}

export async function renderWrapped(root, params) {
  const thisYear = new Date().getFullYear();
  const year = Number(params?.get('year')) || thisYear;
  document.title = `Wrapped ${year} — AniNest`;
  if (!Auth.get().user) {
    root.innerHTML = emptyHTML('Log in to see your year in anime.', '🎁')
      + '<p style="text-align:center"><a href="#/login" class="btn-pow btn-pow--pink">LOG IN</a></p>';
    return;
  }
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🎁 AniNest Wrapped ${year}</h1>
      <span class="section-sub">Your year in anime, from every episode you ticked off.</span>
    </div>
    <div id="wrapped-slot">${loadingHTML('WRAPPING YOUR YEAR')}</div>`;
  const slot = root.querySelector('#wrapped-slot');

  const load = async () => {
    let w;
    try {
      w = await apiGet(`/api/wrapped?year=${year}&tz=${new Date().getTimezoneOffset()}`);
    } catch {
      if (!root.isConnected) return;
      slot.innerHTML = errorHTML('Couldn’t load your Wrapped.');
      wireRetry(slot, () => { slot.innerHTML = loadingHTML('WRAPPING YOUR YEAR'); load(); });
      return;
    }
    if (!root.isConnected) return;
    if (w.empty) {
      slot.innerHTML = emptyHTML(`No episodes logged in ${year} yet. Tap +1 on a show you're watching and your Wrapped fills up as you go.`, '📺');
      return;
    }
    const sofar = year === thisYear && new Date().getMonth() < 11;
    slot.innerHTML = pageHTML(w, sofar);
    wire(slot, w, sofar);
  };
  load();
}

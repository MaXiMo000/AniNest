import { escapeHtml } from './ui.js';
import { groupSources } from './freeWatchGroups.js';

// "Watch Free (Official)" on the anime detail page: one player, language tabs
// when there's more than one version, and long runs split into collapsible
// episode ranges (grouping logic lives in freeWatchGroups.js so it's testable).
// Curated official YouTube uploads only, deliberately separate from the
// "Where to Watch" box (links to paid platforms). Embeds are always rebuilt
// from the bare validated 11-char id - never from stored text (see
// backend/src/lib/youtubeUrl.js).
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function freeWatchSectionHTML(sources, malId) {
  const head = `
      <div class="section-head">
        <h2 class="section-title">🆓 Watch Free (Official)</h2>
        <a href="#/anime/${malId}/submit-watch-link" class="chip">➕ Suggest a link</a>
      </div>`;
  const { languages } = groupSources(sources);
  const total = languages.reduce((n, l) => n + l.count, 0);
  // With several versions the language tabs say which is which; with just one
  // there are no tabs, so name it here (e.g. Ani-One's "Chinese subs" uploads).
  const onlyLang = languages.length === 1 && languages[0].lang !== 'Other' ? ` · ${languages[0].lang}` : '';
  if (!total) {
    return `
    <section class="section">
      ${head}
      <p style="color:var(--muted);font-weight:600">No free official episodes added yet — know one? Suggest a link above!</p>
    </section>`;
  }
  return `
    <section class="section" id="free-watch">
      ${head}
      <div class="tv-frame">
        <div class="tv-screen" id="free-player-screen"></div>
        <div class="tv-label" id="free-now-playing">${total} free ${total === 1 ? 'upload' : 'uploads'} available${escapeHtml(onlyLang)}</div>
      </div>
      <p class="free-note">Official channels license each upload for certain countries. If YouTube says a video isn't available where you are, it isn't licensed there yet.</p>
      <div class="library-tabs" id="free-lang-tabs" style="margin-top:14px"></div>
      <div id="free-episode-list" style="margin-top:10px"></div>
    </section>`;
}

export function wireFreeWatch(root, sources) {
  const section = root.querySelector('#free-watch');
  if (!section) return;
  const { languages, defaultLang } = groupSources(sources);
  const tabs = section.querySelector('#free-lang-tabs');
  const list = section.querySelector('#free-episode-list');
  let activeLang = defaultLang;
  let playingId = null;

  function renderTabs() {
    if (languages.length < 2) { tabs.innerHTML = ''; return; }
    tabs.innerHTML = languages.map((l) => `<button class="library-tab ${l.lang === activeLang ? 'is-active' : ''}" data-lang="${escapeHtml(l.lang)}">${escapeHtml(l.lang)} (${l.count})</button>`).join('');
  }

  const buttonHTML = (s) => {
    const text = `${s.parsed.base || 'Watch'} — ${s.channel_name || 'Official upload'}`;
    return `<button class="guess-choice ${s.youtube_video_id === playingId ? 'is-correct' : ''}" data-video="${escapeHtml(s.youtube_video_id)}" data-label="${escapeHtml(`${text}${s.parsed.lang !== 'Other' ? ` · ${s.parsed.lang}` : ''}`)}">${escapeHtml(text)}</button>`;
  };

  function renderList() {
    const lang = languages.find((l) => l.lang === activeLang) || languages[0];
    list.innerHTML = lang.groups.map((g, i) => {
      const buttons = `<div class="guess-choices">${g.items.map(buttonHTML).join('')}</div>`;
      if (!g.title || lang.groups.length === 1) return buttons;
      // Open the first group, the first EPISODE range (so episode 1 is never
      // hidden behind a pinned "Complete series" group), and whichever one
      // holds the episode being played.
      const firstEpisodeGroup = lang.groups.findIndex((x) => x.title !== 'Complete series');
      const open = i === 0 || i === firstEpisodeGroup || g.items.some((s) => s.youtube_video_id === playingId);
      return `<details class="free-group" ${open ? 'open' : ''}><summary>${escapeHtml(g.title)} <span class="xp-count">(${g.items.length})</span></summary>${buttons}</details>`;
    }).join('');
  }

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    activeLang = btn.dataset.lang;
    renderTabs();
    renderList();
    if (!playingId) renderPoster();
  });

  const screen = section.querySelector('#free-player-screen');

  function play(btn) {
    const videoId = btn.dataset.video;
    if (!YT_ID_RE.test(videoId)) return;
    playingId = videoId;
    screen.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" title="Free episode" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    list.querySelectorAll('.guess-choice').forEach((b) => b.classList.toggle('is-correct', b.dataset.video === videoId));
    section.querySelector('#free-now-playing').textContent = `▶ ${btn.dataset.label}`;
  }

  // Until something plays, the screen shows the first episode's YouTube
  // thumbnail as a poster (rebuilt from the validated id, like the embed);
  // clicking it plays that episode.
  function renderPoster() {
    const first = list.querySelector('[data-video]');
    if (!first || !YT_ID_RE.test(first.dataset.video)) return;
    screen.innerHTML = `
      <button type="button" class="free-poster" aria-label="Play ${escapeHtml(first.dataset.label)}">
        <img src="https://i.ytimg.com/vi/${first.dataset.video}/hqdefault.jpg" alt="" loading="lazy">
        <span class="free-poster-play">▶ ${escapeHtml(first.dataset.label.split(' — ')[0])}</span>
      </button>`;
    screen.querySelector('.free-poster').addEventListener('click', () => play(first));
    // No thumbnail (e.g. a removed video) just leaves the plain dark poster.
    screen.querySelector('.free-poster img').addEventListener('error', (e) => e.target.remove());
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-video]');
    if (btn) play(btn);
  });

  renderTabs();
  renderList();
  renderPoster();
}

import { Api } from '../lib/api.js';
import { animeCard, escapeHtml, errorHTML, emptyHTML, skeletonGrid, wireRetry } from '../lib/ui.js';
import { navigate } from '../lib/router.js';

// Plain-English search (backend/src/lib/vibeParser.js does the understanding).
// The query lives in the URL (#/vibe?q=...), so a search can be shared.

const EXAMPLES = [
  'cozy fantasy, under 13 episodes, no romance',
  'like Frieren but finished',
  'dark sci-fi movie from the 90s',
  'short sports anime',
  'mind-bending thriller, no gore',
  'wholesome slice of life with cute girls',
];

function chipsHTML(parsed, like) {
  const chips = parsed.chips.map((c) => {
    const icon = c.type === 'exclude' ? '🚫' : c.type === 'include' ? '✓' : '•';
    return `<span class="vibe-chip vibe-chip--${c.type}">${icon} ${escapeHtml(c.label)}</span>`;
  }).join('');
  const notes = [];
  if (like?.notFound) notes.push(`Couldn't find an anime called “${escapeHtml(like.notFound)}”, so that part was left out.`);
  if (like?.malId) notes.push(`Starting from shows people who liked <a href="#/anime/${Number(like.malId)}">${escapeHtml(like.title)}</a> recommend.`);
  if (parsed.unknown.length) notes.push(`Didn't understand: ${parsed.unknown.map((w) => `“${escapeHtml(w)}”`).join(', ')}.`);
  return `
    <div class="vibe-chips" aria-label="What was understood">${chips}</div>
    ${notes.map((n) => `<p class="muted-note">${n}</p>`).join('')}`;
}

function resultHTML(a) {
  return `
    <div class="vibe-result">
      ${animeCard(a)}
      <div class="vibe-reasons">${a.vibe_reasons.map((r) => `<span>✓ ${escapeHtml(r)}</span>`).join('')}</div>
    </div>`;
}

async function runSearch(root, q) {
  const out = root.querySelector('#vibe-results');
  out.innerHTML = skeletonGrid(12);
  let res;
  try {
    res = await Api.vibe(q);
  } catch {
    if (!out.isConnected) return;
    out.innerHTML = errorHTML('The search couldn’t reach the anime database. Try again in a moment!');
    wireRetry(out, () => runSearch(root, q));
    return;
  }
  if (!out.isConnected) return;
  if (!res.understood) {
    out.innerHTML = `
      ${chipsHTML(res.parsed, null)}
      ${emptyHTML('That didn’t sound like a vibe. Try a mood, a genre or a length, or search it as a title.', '🤔')}
      <div class="hero-actions" style="justify-content:center"><a class="btn-pow btn-pow--blue" href="#/browse?q=${encodeURIComponent(q)}">Search titles for “${escapeHtml(q)}”</a></div>`;
    return;
  }
  out.innerHTML = `
    ${chipsHTML(res.parsed, res.like)}
    ${res.data.length
      ? `<div class="card-grid">${res.data.map(resultHTML).join('')}</div>`
      : emptyHTML('Nothing matches all of that. Try dropping a filter.', '🔍')}`;
}

export function renderVibe(root, params) {
  const q = (params.get('q') || '').slice(0, 200);
  document.title = q ? `“${q}” — Vibe Search — AniNest` : 'Vibe Search — AniNest';
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">✨ Vibe Search</h1>
      <span class="section-sub">Describe what you're in the mood for, the way you'd tell a friend.</span>
    </div>
    <form id="vibe-form" class="vibe-form" role="search">
      <input id="vibe-input" type="search" maxlength="200" value="${escapeHtml(q)}" aria-label="Describe what you want to watch"
        placeholder="e.g. cozy fantasy, under 13 episodes, no romance" />
      <button type="submit" class="btn-pow btn-pow--pink">FIND IT</button>
    </form>
    <div class="vibe-examples">
      ${EXAMPLES.map((e) => `<button type="button" class="chip" data-example="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join('')}
    </div>
    <div id="vibe-results"></div>`;

  const go = (text) => {
    const t = text.trim();
    if (t) navigate(`#/vibe?q=${encodeURIComponent(t)}`);
  };
  root.querySelector('#vibe-form').addEventListener('submit', (e) => {
    e.preventDefault();
    go(root.querySelector('#vibe-input').value);
  });
  root.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => go(b.dataset.example)));

  if (q) runSearch(root, q);
}

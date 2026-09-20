import { escapeHtml } from '../../lib/ui.js';

const GAMES = [
  {
    emoji: '📈',
    title: 'Higher or Lower',
    desc: 'Guess whether the next anime scores higher or lower than the current champion. Keep your streak alive!',
    href: '#/games/higher-lower',
    ready: true,
  },
  {
    emoji: '🕵️',
    title: 'Guess the Anime',
    desc: 'A blurred cover and a redacted synopsis snippet — how fast can you name it?',
    href: '#/games/guess-the-anime',
    ready: true,
  },
  {
    emoji: '🧭',
    title: 'Taste Quiz',
    desc: 'Answer a few questions, get an anime recommendation picked just for you.',
    ready: false,
  },
];

function gameCard(g) {
  const inner = `
    <div class="game-card-emoji">${g.emoji}</div>
    <h3 class="game-card-title">${escapeHtml(g.title)}</h3>
    <p class="game-card-desc">${escapeHtml(g.desc)}</p>
    ${g.ready ? '<span class="btn-pow btn-pow--pink btn-pow--sm">▶ PLAY</span>' : '<span class="game-card-soon">🔒 Coming soon</span>'}
  `;
  return g.ready
    ? `<a class="game-card" href="${g.href}">${inner}</a>`
    : `<div class="game-card game-card--locked">${inner}</div>`;
}

export function renderGamesHub(root) {
  document.title = 'Game Zone — AniNest';
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🎮 Game Zone</h1>
      <span class="section-sub">Anime trivia built from our own data — no spoilers, no scraped character art.</span>
    </div>
    <div class="games-grid">${GAMES.map(gameCard).join('')}</div>
  `;
}

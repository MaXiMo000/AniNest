// Five multiple-choice streak games on lib/choiceGame.js. The server builds
// and judges the rounds (backend/src/lib/roundGames.js); each entry here only
// draws its prompt from what the server sent.

import { escapeHtml } from '../../lib/ui.js';
import { runChoiceGame } from '../../lib/choiceGame.js';
import { sfx } from '../../lib/gameFx.js';

const CLIP_SECONDS = 12;

const coverHTML = (anime) => `
  <div class="guess-poster-frame choice-cover">
    ${anime.image ? `<img src="${escapeHtml(anime.image)}" alt="${escapeHtml(anime.title)}" />` : ''}
  </div>`;
const showPrompt = (round) => `${coverHTML(round.anime)}<h2 class="choice-title">${escapeHtml(round.anime.title)}</h2>`;

export const STUDIO_MATCH = {
  slug: 'studio-match',
  title: 'Studio Match',
  emoji: '🏢',
  intro: 'Which studio animated this show?',
  loadingLabel: 'CALLING THE STUDIOS',
  promptHTML: showPrompt,
};

export const SOURCE_GUESS = {
  slug: 'source-guess',
  title: 'Source Material',
  emoji: '📚',
  intro: 'Was this anime adapted from a manga, a light novel, a game… or is it an original?',
  loadingLabel: 'DIGGING THROUGH THE ARCHIVES',
  promptHTML: showPrompt,
};

export const EMOJI_PLOT = {
  slug: 'emoji-plot',
  title: 'Emoji Plot',
  emoji: '😀',
  intro: 'Decode the emoji — which anime is it?',
  loadingLabel: 'WARMING UP THE EMOJI',
  promptHTML: (round) => `<div class="emoji-clue" aria-label="Emoji clue">${escapeHtml(round.emoji)}</div>`,
};

// Names of the main cast (text only) and their Japanese voice actors.
export const CAST_CALL = {
  slug: 'cast-call',
  title: 'Cast Call',
  emoji: '🎙️',
  intro: 'Here’s the main cast and who voices them. Which anime are they from?',
  loadingLabel: 'ROLLING CALL',
  revealMs: 1800,
  promptHTML: (round) => `
    <ul class="cast-list fx-stagger">
      ${round.cast.map((c) => `<li><strong>${escapeHtml(c.name)}</strong>${c.va ? `<span>🎙️ ${escapeHtml(c.va)}</span>` : ''}</li>`).join('')}
    </ul>`,
};

// The first seconds of an opening, audio only: the video stays hidden until
// the answer is revealed.
let video = null;
let stopTimer = null;
function stopClip() {
  clearTimeout(stopTimer);
  try { video?.pause(); } catch { /* ignore */ }
}
function playClip() {
  if (!video) return;
  stopClip();
  video.currentTime = 0;
  video.play()?.catch?.(() => {});
  stopTimer = setTimeout(() => video?.pause(), CLIP_SECONDS * 1000);
}

export const NAME_THAT_OPENING = {
  slug: 'name-that-opening',
  title: 'Name That Opening',
  emoji: '🎵',
  intro: `Listen to ${CLIP_SECONDS} seconds of an opening. Which anime is it from?`,
  loadingLabel: 'TUNING THE JUKEBOX',
  revealMs: 2600,
  promptHTML: (round) => `
    <div class="opening-player">
      <div class="opening-visual" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
      <video class="opening-video" preload="auto" playsinline src="${escapeHtml(round.videoUrl)}"></video>
      <button type="button" class="btn-pow btn-pow--blue" data-replay>▶ PLAY CLIP</button>
      <p class="section-sub opening-status" data-status>Loading the clip…</p>
    </div>`,
  onMount(stage, _round, { skip }) {
    video = stage.querySelector('video');
    const status = stage.querySelector('[data-status]');
    const visual = stage.querySelector('.opening-visual');
    stage.querySelector('[data-replay]').addEventListener('click', () => { sfx('click'); playClip(); });
    video.addEventListener('playing', () => { status.textContent = 'Now playing… 🎶'; visual.classList.add('is-playing'); });
    video.addEventListener('pause', () => { visual.classList.remove('is-playing'); status.textContent = 'Paused — press play to hear it again.'; });
    video.addEventListener('error', () => {
      status.innerHTML = 'This clip won’t load right now. <button type="button" class="btn-pow btn-pow--sm btn-pow--outline" data-skip>SKIP (NO PENALTY)</button>';
      status.querySelector('[data-skip]').addEventListener('click', skip);
    });
    video.addEventListener('canplay', () => {
      if (status.textContent.startsWith('Loading')) status.textContent = 'Ready!';
      // Sound may need a first tap on the page; the play button still works.
      if (!video.dataset.started) { video.dataset.started = '1'; playClip(); }
    }, { once: true });
  },
  onReveal(stage) {
    stage.querySelector('.opening-video')?.classList.add('is-revealed');
  },
  cleanup() {
    stopClip();
    if (video) { video.removeAttribute('src'); try { video.load(); } catch { /* ignore */ } }
    video = null;
  },
};

export const CHOICE_GAMES = {
  'studio-match': STUDIO_MATCH,
  'source-guess': SOURCE_GUESS,
  'emoji-plot': EMOJI_PLOT,
  'cast-call': CAST_CALL,
  'name-that-opening': NAME_THAT_OPENING,
};

export function renderChoiceGame(root, slug, params) {
  return runChoiceGame(root, CHOICE_GAMES[slug], params);
}

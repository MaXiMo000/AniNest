// Five multiple-choice streak games built on lib/choiceGame.js. Each entry
// only describes how one round is built from the shared anime pool.

import { getAnimePool } from '../../lib/animePool.js';
import { Api, imageOf } from '../../lib/api.js';
import { escapeHtml } from '../../lib/ui.js';
import { stableOrder, shuffleWith } from '../../lib/rng.js';
import { pickChoices, poolForDifficulty } from '../../lib/guessMechanic.js';
import { runChoiceGame, valueChoices, drawUnused } from '../../lib/choiceGame.js';
import { sfx } from '../../lib/gameFx.js';
import { EMOJI_PUZZLES } from './emojiPuzzles.js';

const CLIP_SECONDS = 12;

function coverHTML(anime, { blur = 0 } = {}) {
  const img = imageOf(anime);
  return `
    <div class="guess-poster-frame choice-cover">
      ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(anime.title)}" style="filter:blur(${blur}px)" />` : ''}
    </div>`;
}

function titleChoices(pool, answer, rand) {
  return pickChoices(pool, answer, 3, rand).map((a) => ({ id: a.mal_id, label: a.title }));
}

async function sortedPool(filter) {
  const pool = stableOrder((await getAnimePool()).filter(filter));
  if (pool.length < 8) throw new Error('Not enough data for this game.');
  return pool;
}

// --------------------------------------------------------------- Studio Match
const studioOf = (a) => a.studios?.[0]?.name || null;

export const STUDIO_MATCH = {
  slug: 'studio-match',
  title: 'Studio Match',
  emoji: '🏢',
  intro: 'Which studio animated this show?',
  loadingLabel: 'CALLING THE STUDIOS',
  load: () => sortedPool((a) => studioOf(a)),
  async buildRound({ data: pool, rand, used }) {
    const anime = drawUnused(pool, used, rand);
    const studios = pool.map(studioOf);
    if (new Set(studios).size < 4) return null;
    return {
      promptHTML: `${coverHTML(anime)}<h2 class="choice-title">${escapeHtml(anime.title)}</h2>`,
      choices: valueChoices(studioOf(anime), studios, rand),
      correctId: studioOf(anime),
      revealHTML: `🏢 ${escapeHtml(studioOf(anime))}`,
      recapLabel: `${anime.title} — ${studioOf(anime)}`,
      recapHref: `#/anime/${anime.mal_id}`,
    };
  },
};

// --------------------------------------------------------------- Source Material
export const SOURCE_GUESS = {
  slug: 'source-guess',
  title: 'Source Material',
  emoji: '📚',
  intro: 'Was this anime adapted from a manga, a light novel, a game… or is it an original?',
  loadingLabel: 'DIGGING THROUGH THE ARCHIVES',
  load: () => sortedPool((a) => a.source),
  async buildRound({ data: pool, rand, used }) {
    const anime = drawUnused(pool, used, rand);
    const sources = [...new Set(pool.map((a) => a.source)), 'Manga', 'Light Novel', 'Original', 'Video Game', 'Visual Novel'];
    return {
      promptHTML: `${coverHTML(anime)}<h2 class="choice-title">${escapeHtml(anime.title)}</h2>`,
      choices: valueChoices(anime.source, sources, rand),
      correctId: anime.source,
      revealHTML: `📚 ${escapeHtml(anime.source)}`,
      recapLabel: `${anime.title} — ${anime.source}`,
      recapHref: `#/anime/${anime.mal_id}`,
    };
  },
};

// --------------------------------------------------------------- Emoji Plot
export const EMOJI_PLOT = {
  slug: 'emoji-plot',
  title: 'Emoji Plot',
  emoji: '😀',
  intro: 'Decode the emoji — which anime is it?',
  loadingLabel: 'WARMING UP THE EMOJI',
  load: async () => EMOJI_PUZZLES,
  async buildRound({ data: puzzles, rand, used }) {
    const puzzle = drawUnused(puzzles, used, rand, (p) => p.title);
    const titles = puzzles.map((p) => p.title);
    return {
      promptHTML: `<div class="emoji-clue" aria-label="Emoji clue">${puzzle.emoji}</div>`,
      choices: valueChoices(puzzle.title, titles, rand),
      correctId: puzzle.title,
      revealHTML: escapeHtml(puzzle.title),
      recapLabel: `${puzzle.emoji} ${puzzle.title}`,
      recapHref: `#/browse?q=${encodeURIComponent(puzzle.title)}`,
    };
  },
};

// --------------------------------------------------------------- Cast Call
// Names of the main cast (text only - no character art) and their Japanese
// voice actors; name the show.
function castLines(characters) {
  const main = characters.filter((c) => String(c.role || '').toLowerCase() === 'main');
  const list = (main.length >= 2 ? main : characters).slice(0, 4);
  return list.map((c) => ({ name: c.character?.name || 'Unknown', va: c.voiceActors?.[0]?.name || null }));
}

export const CAST_CALL = {
  slug: 'cast-call',
  title: 'Cast Call',
  emoji: '🎙️',
  intro: 'Here’s the main cast and who voices them. Which anime are they from?',
  loadingLabel: 'ROLLING CALL',
  revealMs: 1800,
  load: () => sortedPool((a) => a.title).then((pool) => poolForDifficulty(pool, 'easy')),
  async buildRound({ data: pool, rand, used }) {
    const anime = drawUnused(pool, used, rand);
    const res = await Api.characters(anime.mal_id);
    const cast = castLines(res.data || []);
    if (cast.length < 2) return null;
    return {
      promptHTML: `
        <ul class="cast-list fx-stagger">
          ${cast.map((c) => `<li><strong>${escapeHtml(c.name)}</strong>${c.va ? `<span>🎙️ ${escapeHtml(c.va)}</span>` : ''}</li>`).join('')}
        </ul>`,
      choices: titleChoices(pool, anime, rand),
      correctId: anime.mal_id,
      revealHTML: escapeHtml(anime.title),
      recapLabel: anime.title,
      recapHref: `#/anime/${anime.mal_id}`,
    };
  },
};

// --------------------------------------------------------------- Name That Opening
// Plays the first seconds of an opening (audio only - the video element is
// hidden until the answer is revealed) from AnimeThemes, via our backend.
export const NAME_THAT_OPENING = {
  slug: 'name-that-opening',
  title: 'Name That Opening',
  emoji: '🎵',
  intro: `Listen to ${CLIP_SECONDS} seconds of an opening. Which anime is it from?`,
  loadingLabel: 'TUNING THE JUKEBOX',
  revealMs: 2600,
  load: () => sortedPool((a) => a.title).then((pool) => poolForDifficulty(pool, 'easy')),
  async buildRound({ data: pool, rand, used }) {
    const anime = drawUnused(pool, used, rand);
    const res = await Api.themes(anime.mal_id);
    const openings = (res.data || []).filter((t) => t.type === 'OP' && t.videoUrl);
    if (!openings.length) return null;
    const theme = shuffleWith(openings, rand)[0];
    let stopTimer = null;
    let video = null;
    const stop = () => { clearTimeout(stopTimer); try { video?.pause(); } catch { /* ignore */ } };
    const playClip = () => {
      if (!video) return;
      stop();
      video.currentTime = 0;
      const p = video.play();
      p?.catch?.(() => {});
      stopTimer = setTimeout(() => video?.pause(), CLIP_SECONDS * 1000);
    };
    return {
      promptHTML: `
        <div class="opening-player">
          <div class="opening-visual" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
          <video class="opening-video" preload="auto" playsinline src="${escapeHtml(theme.videoUrl)}"></video>
          <button type="button" class="btn-pow btn-pow--blue" data-replay>▶ PLAY CLIP</button>
          <p class="section-sub opening-status" data-status>Loading the clip…</p>
        </div>`,
      choices: titleChoices(pool, anime, rand),
      correctId: anime.mal_id,
      revealHTML: `${escapeHtml(anime.title)}${theme.title ? ` — “${escapeHtml(theme.title)}”` : ''}`,
      recapLabel: `${anime.title}${theme.title ? ` (${theme.title})` : ''}`,
      recapHref: `#/anime/${anime.mal_id}`,
      onMount(stage, { skip }) {
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
          // Browsers allow sound after the player has interacted with the
          // page; if not, the play button above still works.
          if (!video.dataset.started) { video.dataset.started = '1'; playClip(); }
        }, { once: true });
      },
      onReveal(stage) {
        stage.querySelector('.opening-video')?.classList.add('is-revealed');
      },
      cleanup() {
        stop();
        if (video) { video.removeAttribute('src'); try { video.load(); } catch { /* ignore */ } }
        video = null;
      },
    };
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

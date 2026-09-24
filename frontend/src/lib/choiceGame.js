// A small engine for "streak of multiple-choice rounds, three lives" games
// (Studio Match, Source Material, Emoji Plot, Cast Call, Name That Opening).
// Each game supplies only how to build a round; the engine owns lives, the
// streak, keys 1-4, sounds, the reveal, game over, local stats, the server
// run and challenge links.
//
// config:
//   slug, title (HTML-safe text), emoji, intro, loadingLabel
//   load(): Promise<any>            - data for the whole run (e.g. the pool)
//   buildRound(ctx): Promise<Round|null>
//        ctx = { data, rand, streak, used: Set } ; return null to skip
//   Round = { promptHTML, choices: [{ id, label }], correctId,
//             revealHTML?, recapLabel, recapHref?, onMount?(el, { skip }), onReveal?(el), cleanup?() }
//        skip(): moves on to a new round with no penalty (e.g. a clip that won't load)
//   revealMs (default 1500), lives (default 3)

import { escapeHtml, loadingHTML, errorHTML, wireRetry } from './ui.js';
import { randomFor } from './rng.js';
import {
  startServerRun, recordLocalResult, getLocalStats, gameOverHTML, wireGameOver, challengeBannerHTML,
} from './gameKit.js';
import {
  celebrateCorrect, lamentWrong, soundToggleHTML, wireSoundToggle,
} from './gameFx.js';
import { navigate } from './router.js';

const MAX_SKIPPED_BUILDS = 8;

export async function runChoiceGame(root, config, params = new URLSearchParams()) {
  const {
    slug, title, emoji, intro, loadingLabel = 'LOADING', revealMs = 1500, lives: startLives = 3,
  } = config;
  root.innerHTML = loadingHTML(loadingLabel);

  let data;
  try {
    data = await config.load();
  } catch {
    root.innerHTML = errorHTML('Couldn’t load this game’s data — try again shortly!');
    wireRetry(root, () => runChoiceGame(root, config, params));
    return;
  }

  document.title = `${title} — AniNest`;
  const seed = params.get('seed');
  const rand = randomFor(seed);
  const run = startServerRun(slug);
  const best = getLocalStats(slug).best;
  const used = new Set();
  const recap = [];
  let streak = 0;
  let lives = startLives;
  let locked = true;
  let current = null;
  let over = false;

  function hud() {
    return `
      <span class="stat-pill">${'❤️'.repeat(lives)}${'🖤'.repeat(Math.max(0, startLives - lives))}</span>
      <span class="stat-pill">🔥 Streak ${streak}</span>
      <span class="stat-pill">🏆 Best ${Math.max(best, streak)}</span>
      ${soundToggleHTML()}`;
  }

  async function nextRound() {
    if (over) return;
    current?.cleanup?.();
    root.querySelector('#choice-stage')?.classList.add('is-loading');
    let round = null;
    for (let tries = 0; !round && tries < MAX_SKIPPED_BUILDS; tries += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        round = await config.buildRound({ data, rand, streak, used });
      } catch {
        round = null;
      }
    }
    if (over || !root.isConnected) return;
    if (!round) {
      root.innerHTML = errorHTML('Ran out of rounds to build right now — try again shortly!');
      wireRetry(root, () => runChoiceGame(root, config, params));
      return;
    }
    current = round;
    locked = false;
    root.innerHTML = `
      <div class="hl-header">
        <h1 class="section-title">${emoji} ${escapeHtml(title)}</h1>
        <div class="hl-stats" id="choice-hud">${hud()}</div>
      </div>
      ${challengeBannerHTML(seed)}
      <p class="section-sub">${escapeHtml(intro)}</p>
      <div class="guess-arena choice-arena fx-slide-in" id="choice-stage">
        <div class="choice-prompt">${round.promptHTML}</div>
        <p class="guess-reveal-title" id="choice-reveal" aria-live="polite"></p>
        <div class="guess-choices">
          ${round.choices.map((c, i) => `<button class="guess-choice" data-id="${escapeHtml(String(c.id))}"><kbd>${i + 1}</kbd> ${escapeHtml(c.label)}</button>`).join('')}
        </div>
      </div>`;
    wireSoundToggle(root);
    root.querySelectorAll('.guess-choice').forEach((btn) => btn.addEventListener('click', () => answer(btn.dataset.id)));
    round.onMount?.(root.querySelector('#choice-stage'), {
      skip: () => { if (!locked && current === round) { locked = true; nextRound(); } },
    });
  }

  function answer(chosenId) {
    if (locked || over) return;
    locked = true;
    const correct = chosenId === String(current.correctId);
    root.querySelectorAll('.guess-choice').forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.id === String(current.correctId)) btn.classList.add('is-correct');
      else if (btn.dataset.id === chosenId) btn.classList.add('is-wrong');
      else btn.classList.add('is-muted');
    });
    const stage = root.querySelector('#choice-stage');
    const reveal = root.querySelector('#choice-reveal');
    if (reveal && current.revealHTML) reveal.innerHTML = current.revealHTML;
    current.onReveal?.(stage);
    recap.push({ label: current.recapLabel, href: current.recapHref, correct });

    if (correct) {
      streak += 1;
      celebrateCorrect(streak, stage);
    } else {
      lives -= 1;
      lamentWrong(stage);
    }
    const hudEl = root.querySelector('#choice-hud');
    if (hudEl) { hudEl.innerHTML = hud(); wireSoundToggle(hudEl); }

    setTimeout(() => {
      if (over || !root.isConnected) return;
      if (lives <= 0) finish();
      else nextRound();
    }, revealMs);
  }

  function onKey(e) {
    if (!root.isConnected || over) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest?.('input, textarea')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 9) root.querySelectorAll('.guess-choice')[n - 1]?.click();
  }

  function finish() {
    over = true;
    current?.cleanup?.();
    document.removeEventListener('keydown', onKey);
    run.submit(streak);
    const stats = recordLocalResult(slug, streak);
    const recapHTML = recap.length ? `
      <details class="recap"><summary>Round recap (${recap.filter((r) => r.correct).length}/${recap.length})</summary>
        <ul class="recap-list">${recap.slice(-20).map((r) => `<li class="${r.correct ? 'is-right' : 'is-wrong'}">${r.correct ? '✅' : '❌'} ${r.href ? `<a href="${r.href}">${escapeHtml(r.label)}</a>` : escapeHtml(r.label)}</li>`).join('')}</ul>
      </details>` : '';
    root.innerHTML = gameOverHTML({ emoji, score: streak, scoreLabel: 'Correct answers', stats, slug, extra: recapHTML });
    wireGameOver(root, {
      stats,
      onReplay: () => (seed ? navigate(`#/games/${slug}`) : runChoiceGame(root, config)),
      challenge: { text: `I got ${streak} right in AniNest's ${title}. Can you beat me?`, path: `/games/${slug}`, params: {} },
    });
  }

  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { over = true; current?.cleanup?.(); document.removeEventListener('keydown', onKey); }, { once: true });
  nextRound();
}

// Picks `count` distinct values from `candidates` other than `correct`,
// returns them shuffled together with `correct` as { id, label } choices.
export function valueChoices(correct, candidates, rand, count = 3) {
  const others = [...new Set(candidates.filter((c) => c && c !== correct))];
  const picked = [];
  while (others.length && picked.length < count) {
    picked.push(others.splice(Math.floor(rand() * others.length), 1)[0]);
  }
  const all = [correct, ...picked];
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.map((v) => ({ id: v, label: v }));
}

// Draws the next item from `list` not yet in `used` (by key), refilling when
// everything has been used once.
export function drawUnused(list, used, rand, key = (a) => a.mal_id) {
  let fresh = list.filter((a) => !used.has(key(a)));
  if (!fresh.length) { used.clear(); fresh = list; }
  const pick = fresh[Math.floor(rand() * fresh.length)];
  used.add(key(pick));
  return pick;
}

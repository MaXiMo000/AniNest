// Shared "game feel" for every Game Zone page: comic POW popups, confetti,
// shake, count-up numbers, synthesized sound effects and phone haptics.
//
// Everything here is decoration layered on top of a game - no game logic may
// depend on it. Each effect is a no-op (or its instant equivalent) when the
// visitor prefers reduced motion or has muted sound, and every effect creates
// and removes its own DOM so a page re-render never leaves stray nodes.
//
// Sounds are synthesized with the Web Audio API rather than shipped as files:
// no extra requests, nothing to add to the CSP's media-src, and the whole
// "sound pack" is a few lines of oscillator settings.

const SOUND_KEY = 'aninest_game_sound';

export function reducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------- settings

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: setting just won't persist */ }
}

export function soundEnabled() {
  return safeGet(SOUND_KEY) !== 'off';
}

export function setSoundEnabled(on) {
  safeSet(SOUND_KEY, on ? 'on' : 'off');
}

// A small 🔊/🔇 toggle button, dropped into any game header.
export function soundToggleHTML() {
  const on = soundEnabled();
  return `<button type="button" class="fx-sound-toggle" data-fx-sound aria-pressed="${on}" aria-label="Sound effects" title="Sound effects">${on ? '🔊' : '🔇'}</button>`;
}

export function wireSoundToggle(root) {
  root.querySelectorAll('[data-fx-sound]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = !soundEnabled();
      setSoundEnabled(on);
      btn.textContent = on ? '🔊' : '🔇';
      btn.setAttribute('aria-pressed', String(on));
      if (on) sfx('click');
    });
  });
}

// ---------------------------------------------------------------- sound

let audioCtx = null;
function ctx() {
  if (audioCtx) return audioCtx;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

// Each sound is a list of notes: [frequency Hz, start offset s, duration s].
const SOUNDS = {
  click: { type: 'square', gain: 0.04, notes: [[660, 0, 0.05]] },
  correct: { type: 'triangle', gain: 0.09, notes: [[660, 0, 0.09], [880, 0.08, 0.14]] },
  wrong: { type: 'sawtooth', gain: 0.06, notes: [[220, 0, 0.12], [150, 0.1, 0.22]] },
  combo: { type: 'triangle', gain: 0.08, notes: [[523, 0, 0.07], [659, 0.06, 0.07], [784, 0.12, 0.07], [1047, 0.18, 0.16]] },
  gameover: { type: 'square', gain: 0.05, notes: [[392, 0, 0.16], [330, 0.16, 0.16], [262, 0.32, 0.34]] },
  tick: { type: 'sine', gain: 0.05, notes: [[1200, 0, 0.03]] },
  reveal: { type: 'sine', gain: 0.06, notes: [[440, 0, 0.08], [554, 0.07, 0.08]] },
  fanfare: { type: 'triangle', gain: 0.09, notes: [[523, 0, 0.12], [523, 0.12, 0.08], [659, 0.2, 0.12], [784, 0.32, 0.3]] },
};

export function sfx(name) {
  if (!soundEnabled()) return;
  const spec = SOUNDS[name];
  const ac = spec && ctx();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    const now = ac.currentTime;
    for (const [freq, start, dur] of spec.notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(spec.gain, now + start);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    }
  } catch { /* audio is optional */ }
}

export function haptic(pattern = 30) {
  if (!soundEnabled()) return; // one "effects" switch for both
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// ---------------------------------------------------------------- visuals

function fxRoot() {
  let el = document.getElementById('fx-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx-overlay';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

const POP_COLORS = ['var(--yellow)', 'var(--pink)', 'var(--blue)', 'var(--green)', 'var(--orange)'];

// A comic "POW!" burst. `anchor` is an element to centre on (defaults to the
// middle of the viewport).
export function popText(text, { anchor, color, big = false } = {}) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = `fx-pop${big ? ' fx-pop--big' : ''}`;
  el.textContent = text;
  el.style.setProperty('--fx-color', color || POP_COLORS[Math.floor(Math.random() * POP_COLORS.length)]);
  el.style.setProperty('--fx-tilt', `${Math.round(Math.random() * 16 - 8)}deg`);
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2.6;
  if (anchor?.getBoundingClientRect) {
    const r = anchor.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  fxRoot().appendChild(el);
  setTimeout(() => el.remove(), reducedMotion() ? 700 : 1000);
}

const CONFETTI_COLORS = ['#ff2d78', '#00d9ff', '#ffd23f', '#17e8a0', '#7b2ff7', '#ff7a1a'];

export function confetti({ pieces = 80 } = {}) {
  if (typeof document === 'undefined' || reducedMotion()) return;
  const root = fxRoot();
  const frag = document.createDocumentFragment();
  const nodes = [];
  for (let i = 0; i < pieces; i += 1) {
    const p = document.createElement('i');
    p.className = 'fx-confetti';
    p.style.left = `${Math.random() * 100}vw`;
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    p.style.setProperty('--fx-dx', `${Math.round(Math.random() * 200 - 100)}px`);
    p.style.setProperty('--fx-rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    p.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    frag.appendChild(p);
    nodes.push(p);
  }
  root.appendChild(frag);
  setTimeout(() => nodes.forEach((n) => n.remove()), 3400);
}

// Restarts a one-shot CSS animation class on an element.
function replayClass(el, cls, ms) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow so the animation can restart
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

export function shake(el) {
  if (!reducedMotion()) replayClass(el, 'fx-shake', 500);
}

export function bounce(el) {
  if (!reducedMotion()) replayClass(el, 'fx-bounce', 500);
}

// Animates a number from `from` to `to` inside `el`. `format` turns the
// in-between value into text (e.g. one decimal place for a score).
export function countUp(el, to, { from = 0, ms = 700, format = (v) => String(Math.round(v)) } = {}) {
  if (!el) return;
  if (reducedMotion() || typeof requestAnimationFrame === 'undefined') {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Streak milestones get a bigger celebration than an ordinary correct answer.
export const MILESTONES = [5, 10, 15, 25, 50, 75, 100];

const HYPE = ['POW!', 'NICE!', 'BAM!', 'SUGOI!', 'YES!', 'KAPOW!', 'ZING!'];

// The standard "you got it right" package: sound, haptic, popup, and
// confetti on a milestone streak.
export function celebrateCorrect(streak, anchor) {
  if (MILESTONES.includes(streak)) {
    sfx('combo');
    haptic([30, 40, 30]);
    popText(`${streak} STREAK!`, { anchor, big: true, color: 'var(--yellow)' });
    confetti();
  } else {
    sfx('correct');
    haptic(25);
    popText(HYPE[Math.floor(Math.random() * HYPE.length)], { anchor });
  }
}

export function lamentWrong(el) {
  sfx('wrong');
  haptic([60, 40, 60]);
  shake(el);
}

export function hypeWord() {
  return HYPE[Math.floor(Math.random() * HYPE.length)];
}

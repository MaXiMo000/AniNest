// Autoplay a player while it's on screen and pause it once it scrolls away
// (or the tab is hidden). Used by the trailer (YouTube iframe) and the
// OP/ED jukebox / tournament (<video>).
//
// Only one player runs at a time: the most visible one. Sound first, and if
// the browser refuses unmuted autoplay, it retries muted - the controls
// still let people unmute. If someone pauses a player themselves, it stays
// paused until it has left the screen entirely; one that played to the end
// isn't restarted.

const VISIBLE = 0.5; // share of the player that must be on screen

const players = new Map(); // element -> controller
let active = null;
let observer = null;

function prune() {
  for (const [el] of players) {
    if (!el.isConnected) forget(el);
  }
}

function forget(el) {
  const p = players.get(el);
  if (!p) return;
  players.delete(el);
  observer?.unobserve(el);
  p.dispose();
  if (active === p) active = null;
}

function evaluate() {
  prune();
  const pageHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  let best = null;
  if (!pageHidden) {
    for (const p of players.values()) {
      if (p.ratio < VISIBLE || p.userPaused || p.done) continue;
      if (!best || p.ratio > best.ratio) best = p;
    }
  }
  // Someone pressed play on a player that is still on screen: keep it.
  if (active && !pageHidden && active.ratio >= VISIBLE && !active.userPaused && !active.done && active.userStarted) {
    best = active;
  }
  if (best === active) return;
  if (active) active.autoPause();
  active = best;
  if (active) active.autoPlay();
}

// A player the user started by hand becomes the active one; the other stops.
function takeOver(p) {
  if (active && active !== p) active.autoPause();
  active = p;
}

function onIntersect(entries) {
  for (const e of entries) {
    const p = players.get(e.target);
    if (!p) continue;
    p.ratio = e.isIntersecting ? e.intersectionRatio : 0;
    // Fully off screen: an earlier manual pause no longer applies.
    if (p.ratio === 0) p.userPaused = false;
  }
  evaluate();
}

function ensureObserver() {
  if (observer || typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver(onIntersect, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  document.addEventListener('visibilitychange', evaluate);
}

function register(el, p) {
  if (!el || players.has(el)) return;
  ensureObserver();
  if (!observer) return; // very old browser: leave the player manual
  prune();
  players.set(el, p);
  observer.observe(el);
}

// --- <video> ----------------------------------------------------------------

function videoController(video) {
  let ours = false; // the next pause/play event is one we caused
  const p = {
    ratio: 0, userPaused: false, userStarted: false, done: false,
    autoPlay() {
      if (!video.currentSrc && !video.getAttribute('src')) return;
      ours = true;
      p.userStarted = false;
      video.play().catch((err) => {
        ours = false;
        if (err?.name !== 'NotAllowedError' || active !== p) return;
        ours = true;
        video.muted = true;
        video.play().catch(() => { ours = false; });
      });
    },
    autoPause() {
      if (video.paused) return;
      ours = true;
      video.pause();
    },
    dispose() {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('emptied', onEmptied);
    },
  };
  function onPlay() {
    p.done = false;
    p.userPaused = false;
    if (ours) { ours = false; return; }
    p.userStarted = true;
    takeOver(p);
  }
  function onPause() {
    if (video.ended) { p.done = true; ours = false; return; }
    if (ours) { ours = false; return; }
    p.userPaused = true;
  }
  // A new track was loaded (jukebox/tournament buttons): fresh start.
  function onEmptied() { p.done = false; }
  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('emptied', onEmptied);
  return p;
}

export function autoplayVideoOnView(video) {
  register(video, videoController(video));
}

// --- YouTube iframe ----------------------------------------------------------
// Talks to the embed over postMessage (the same protocol the YouTube IFrame
// API uses), so no extra script is loaded. Needs enablejsapi=1 in the URL -
// see youtubeEmbedUrl below.

const YT = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 };

export function youtubeEmbedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return raw; }
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('autoplay', '0'); // we start it ourselves once it's on screen
  url.searchParams.set('playsinline', '1');
  if (typeof location !== 'undefined' && location.origin?.startsWith('http')) {
    url.searchParams.set('origin', location.origin);
  }
  return url.toString();
}

function youtubeController(iframe) {
  let ready = false;
  let want = null; // 'play' | 'pause' queued until the player answers
  let state = -1;
  let ourPauseAt = 0;
  let listenTimer = null;
  let mutedRetry = null;

  const send = (func, args = []) => {
    iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  };

  const p = {
    ratio: 0, userPaused: false, userStarted: false, done: false,
    autoPlay() {
      p.userStarted = false;
      if (!ready) { want = 'play'; return; }
      send('playVideo');
      clearTimeout(mutedRetry);
      // No "autoplay refused" event from YouTube: if it hasn't started
      // shortly after asking, try again muted.
      mutedRetry = setTimeout(() => {
        if (active === p && state !== YT.PLAYING && state !== YT.BUFFERING) {
          send('mute');
          send('playVideo');
        }
      }, 1500);
    },
    autoPause() {
      clearTimeout(mutedRetry);
      if (!ready) { want = 'pause'; return; }
      ourPauseAt = Date.now();
      send('pauseVideo');
    },
    dispose() {
      clearTimeout(mutedRetry);
      clearInterval(listenTimer);
      window.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', startListening);
    },
  };

  function onState(next) {
    const prev = state;
    state = next;
    if (next === YT.ENDED) { p.done = true; return; }
    if (next === YT.PLAYING) {
      p.done = false;
      p.userPaused = false;
      if (active !== p) { p.userStarted = true; takeOver(p); }
      return;
    }
    if (next === YT.PAUSED && prev !== YT.PAUSED && Date.now() - ourPauseAt > 1000) {
      p.userPaused = true;
    }
  }

  function onMessage(e) {
    if (e.source !== iframe.contentWindow || typeof e.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!ready) {
      ready = true;
      clearInterval(listenTimer);
      const queued = want;
      want = null;
      if (queued === 'play' && active === p) p.autoPlay();
      else if (queued === 'pause') p.autoPause();
    }
    const s = msg.event === 'onStateChange' ? msg.info : msg.info?.playerState;
    if (typeof s === 'number') onState(s);
  }

  // The embed only starts reporting once told someone is listening; repeat
  // until it answers, as the player may still be booting.
  function startListening() {
    clearInterval(listenTimer);
    let tries = 0;
    const hello = () => {
      if (ready || ++tries > 20) { clearInterval(listenTimer); return; }
      iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'aninest', channel: 'widget' }), '*');
    };
    hello();
    listenTimer = setInterval(hello, 250);
  }

  window.addEventListener('message', onMessage);
  iframe.addEventListener('load', startListening);
  return p;
}

export function autoplayYouTubeOnView(iframe) {
  register(iframe, youtubeController(iframe));
}

// Tests only.
export function _resetAutoplayForTests() {
  for (const el of [...players.keys()]) forget(el);
  observer?.disconnect();
  if (observer) document.removeEventListener('visibilitychange', evaluate);
  observer = null;
  active = null;
}

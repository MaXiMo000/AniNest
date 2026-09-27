import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { autoplayVideoOnView, youtubeEmbedUrl, _resetAutoplayForTests } from '../src/lib/autoplayOnView.js';

let fire;
class FakeObserver {
  constructor(cb) { fire = (entries) => cb(entries, this); }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeVideo({ reject } = {}) {
  const v = document.createElement('video');
  v.setAttribute('src', 'https://example.test/op1.webm');
  document.body.appendChild(v);
  let paused = true;
  Object.defineProperty(v, 'paused', { get: () => paused });
  v.play = vi.fn(() => {
    if (reject && !v.muted) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    paused = false;
    v.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  v.pause = vi.fn(() => {
    paused = true;
    v.dispatchEvent(new Event('pause'));
  });
  return v;
}

const seen = (target, ratio) => ({ target, isIntersecting: ratio > 0, intersectionRatio: ratio });

describe('autoplayOnView', () => {
  beforeEach(() => { vi.stubGlobal('IntersectionObserver', FakeObserver); });
  afterEach(() => {
    _resetAutoplayForTests();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('plays when on screen and pauses when scrolled away', () => {
    const v = makeVideo();
    autoplayVideoOnView(v);
    fire([seen(v, 0.8)]);
    expect(v.play).toHaveBeenCalledTimes(1);
    fire([seen(v, 0.1)]);
    expect(v.pause).toHaveBeenCalledTimes(1);
  });

  it('only plays the most visible player', () => {
    const a = makeVideo();
    const b = makeVideo();
    autoplayVideoOnView(a);
    autoplayVideoOnView(b);
    fire([seen(a, 0.6), seen(b, 1)]);
    expect(b.play).toHaveBeenCalled();
    expect(a.play).not.toHaveBeenCalled();
  });

  it('respects a manual pause until the player leaves the screen', () => {
    const v = makeVideo();
    autoplayVideoOnView(v);
    fire([seen(v, 1)]);
    v.pause(); // the user pressed pause
    fire([seen(v, 0.9)]);
    expect(v.play).toHaveBeenCalledTimes(1);
    fire([seen(v, 0)]);
    fire([seen(v, 1)]);
    expect(v.play).toHaveBeenCalledTimes(2);
  });

  it('falls back to muted when unmuted autoplay is blocked', async () => {
    const v = makeVideo({ reject: true });
    autoplayVideoOnView(v);
    fire([seen(v, 1)]);
    await flush();
    expect(v.muted).toBe(true);
    expect(v.play).toHaveBeenCalledTimes(2);
    expect(v.paused).toBe(false);
  });
});

describe('youtubeEmbedUrl', () => {
  it('turns off autoplay and enables the JS API', () => {
    const url = new URL(youtubeEmbedUrl('https://www.youtube-nocookie.com/embed/abc?enablejsapi=1&wmode=opaque&autoplay=1'));
    expect(url.searchParams.get('autoplay')).toBe('0');
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(url.searchParams.get('wmode')).toBe('opaque');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { wireMangaCardEvents, wireCardEvents } from '../src/lib/ui.js';

// Novel, classic and visual-novel cards reuse the .manga-card look but are
// plain links. The global manga-card handler used to open them as manga too,
// pushing #/manga/undefined into history, so Back landed on a broken page.
describe('global card click handlers', () => {
  let root;
  beforeEach(() => {
    window.location.hash = '#/vn';
    root = document.createElement('div');
    document.body.replaceChildren(root);
    wireMangaCardEvents(root);
    wireCardEvents(root);
  });

  it('leaves a link card that only shares the manga-card style alone', () => {
    root.innerHTML = '<a class="manga-card" href="#/vn/v24"><span class="card-title">Doki Doki</span></a>';
    root.querySelector('.card-title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(window.location.hash).not.toContain('undefined');
    expect(window.location.hash).not.toMatch(/^#\/manga\//);
  });

  it('still opens a real manga card', () => {
    root.innerHTML = '<div class="manga-card" data-manga-id="a1b2c3d4-0000-0000-0000-000000000000"><span class="card-title">Manga</span></div>';
    root.querySelector('.card-title').click();
    expect(window.location.hash).toBe('#/manga/a1b2c3d4-0000-0000-0000-000000000000');
  });

  it('still opens a real anime card, and ignores one without an id', () => {
    root.innerHTML = '<div class="anime-card"><span class="card-title">No id</span></div>';
    root.querySelector('.card-title').click();
    expect(window.location.hash).toBe('#/vn');
    root.innerHTML = '<div class="anime-card" data-id="270"><span class="card-title">Hellsing</span></div>';
    root.querySelector('.card-title').click();
    expect(window.location.hash).toBe('#/anime/270');
  });
});

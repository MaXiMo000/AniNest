import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { wirePowSelects, close } from '../src/lib/powSelect.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const options = (n) => Array.from({ length: n }, (_, i) => `<option value="${i}">Chapter ${i + 1}</option>`).join('');

describe('site dropdown (powSelect)', () => {
  beforeAll(() => wirePowSelects());
  beforeEach(() => { close(); document.body.innerHTML = ''; });

  async function mount(html) {
    document.body.innerHTML = html;
    await tick(); // the page watcher upgrades new selects
    return document.querySelector('.pow-select');
  }

  it('upgrades a select, keeping the real one as the source of truth', async () => {
    const wrap = await mount('<label for="ch">Chapter</label><select id="ch"><option value="a">Alpha</option><option value="b" selected>Beta</option></select>');
    const trigger = wrap.querySelector('.pow-select-trigger');
    expect(trigger.textContent).toContain('Beta');
    expect(trigger.getAttribute('aria-label')).toBe('Chapter: Beta');
    expect(wrap.querySelector('select').id).toBe('ch');
    expect(wrap.querySelector('select').tabIndex).toBe(-1);
  });

  it('choosing an option sets the select and fires change for page code', async () => {
    const wrap = await mount('<select id="s"><option value="a">Alpha</option><option value="b">Beta</option></select>');
    const sel = wrap.querySelector('select');
    let changed = null;
    sel.addEventListener('change', () => { changed = sel.value; });
    wrap.querySelector('.pow-select-trigger').click();
    expect(wrap.querySelector('.pow-select-trigger').getAttribute('aria-expanded')).toBe('true');
    const items = document.querySelectorAll('li[role="option"]');
    expect(items).toHaveLength(2);
    items[1].click();
    expect(changed).toBe('b');
    expect(document.querySelector('.pow-select-pop')).toBeNull();
    expect(wrap.querySelector('.pow-select-trigger').textContent).toContain('Beta');
  });

  it('works from the keyboard: open, move, choose, and Escape gives focus back', async () => {
    const wrap = await mount(`<select id="k">${options(5)}</select>`);
    const sel = wrap.querySelector('select');
    const trigger = wrap.querySelector('.pow-select-trigger');
    trigger.focus();
    key(trigger, 'ArrowDown');
    const list = document.querySelector('[role="listbox"]');
    expect(document.activeElement).toBe(list);
    key(list, 'ArrowDown');
    key(list, 'ArrowDown');
    key(list, 'Enter');
    expect(sel.value).toBe('2');
    expect(document.activeElement).toBe(trigger);
    key(trigger, 'Enter');
    key(document.querySelector('[role="listbox"]'), 'End');
    expect(document.querySelector('li.is-active').textContent).toBe('Chapter 5');
    key(document.querySelector('[role="listbox"]'), 'Escape');
    expect(document.querySelector('.pow-select-pop')).toBeNull();
    expect(sel.value).toBe('2');
    expect(document.activeElement).toBe(trigger);
  });

  it('long lists get a search box that filters', async () => {
    const wrap = await mount(`<select id="long">${options(40)}</select>`);
    wrap.querySelector('.pow-select-trigger').click();
    const search = document.querySelector('.pow-select-search');
    expect(search).not.toBeNull();
    search.value = '3';
    search.dispatchEvent(new Event('input'));
    const shown = [...document.querySelectorAll('li[role="option"]')].filter((li) => !li.hidden).map((li) => li.textContent);
    expect(shown).toEqual(['Chapter 3', 'Chapter 13', 'Chapter 23', 'Chapter 30', 'Chapter 31', 'Chapter 32', 'Chapter 33', 'Chapter 34', 'Chapter 35', 'Chapter 36', 'Chapter 37', 'Chapter 38', 'Chapter 39']);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelector('.pow-select-empty').hidden).toBe(false);
  });

  it('follows changes made by page code, and upgrades selects added later', async () => {
    const wrap = await mount('<select id="p"><option value="1">One</option><option value="2">Two</option></select>');
    const sel = wrap.querySelector('select');
    sel.value = '2';
    sel.dispatchEvent(new Event('change'));
    expect(wrap.querySelector('.pow-select-trigger').textContent).toContain('Two');
    const late = document.createElement('div');
    late.innerHTML = '<select id="late"><option>Later</option></select>';
    document.body.append(late);
    await tick();
    expect(late.querySelector('.pow-select-trigger')).not.toBeNull();
  });

  it('leaves multi-selects and opted-out selects native', async () => {
    document.body.innerHTML = '<select multiple><option>a</option></select><select data-native><option>b</option></select>';
    await tick();
    expect(document.querySelector('.pow-select')).toBeNull();
  });
});

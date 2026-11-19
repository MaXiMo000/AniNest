import { Auth } from './authStore.js';

// One tab bar for everything you read or play through: the same tabs, in the
// same order, on the light novel, classics, visual novel and free game pages.
const TABS = [
  ['light', '#/novels', '📚 Light Novels'],
  ['classics', '#/novels/free', '📜 Classics'],
  ['vn', '#/vn', '🎮 Visual Novels'],
  ['freevn', '#/vn?free=1', '🆓 Free Games'],
];

export function novelTabsHTML(active) {
  const tabs = Auth.get().user ? [...TABS, ['list', '#/novel-list', '📌 My Novels']] : TABS;
  return `
  <nav class="vibe-examples" aria-label="Novels and visual novels" style="margin-bottom:12px">
    ${tabs.map(([key, href, label]) => `<a class="chip${key === active ? ' active' : ''}" href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
  </nav>`;
}

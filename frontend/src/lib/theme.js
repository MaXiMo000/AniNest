// Light/dark theme toggle. Dark is the default; the choice is remembered per
// browser. public/theme-init.js applies a saved choice before first paint.

const KEY = 'aninest_theme';
const THEME_COLORS = { dark: '#120c22', light: '#fff6e0' };

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  try { localStorage.setItem(KEY, theme); } catch { /* not remembered */ }
}

export function wireThemeToggle(button) {
  if (!button) return;
  const sync = () => {
    const light = currentTheme() === 'light';
    button.textContent = light ? '🌙' : '☀️';
    button.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    button.setAttribute('title', button.getAttribute('aria-label'));
  };
  button.addEventListener('click', () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    sync();
  });
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[currentTheme()]);
  sync();
}

// Applies a saved light/dark choice before the page paints, so a light-theme
// visitor never sees a dark flash. Loaded as a plain script from index.html
// (the CSP allows 'self' scripts, not inline ones). lib/theme.js owns the toggle.
try {
  if (localStorage.getItem('aninest_theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch (e) { /* storage blocked: stay on the default dark theme */ }

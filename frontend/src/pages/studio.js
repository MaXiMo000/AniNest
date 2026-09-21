import { Api } from '../lib/api.js';
import { cardGrid, loadingHTML, errorHTML, escapeHtml, wireRetry, emptyHTML } from '../lib/ui.js';

export async function renderStudio(root, name) {
  document.title = `${name} — AniNest`;
  root.innerHTML = loadingHTML('LOOKING UP THE STUDIO');

  let data;
  try {
    data = await Api.studio(name);
  } catch (err) {
    if (err.status === 404) {
      root.innerHTML = emptyHTML(`No studio found matching "${name}".`, '🏢');
      return;
    }
    root.innerHTML = errorHTML('Couldn’t load this studio right now — try again shortly!');
    wireRetry(root, () => renderStudio(root, name));
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">🏢 ${escapeHtml(data.name)}</h1>
      <span class="section-sub">${data.media.length} anime on AniNest</span>
    </div>
    ${cardGrid(data.media)}
  `;
}

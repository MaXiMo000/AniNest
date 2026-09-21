import { Api } from '../lib/api.js';
import { cardGrid, loadingHTML, errorHTML, escapeHtml, wireRetry, emptyHTML } from '../lib/ui.js';

export async function renderPerson(root, name) {
  document.title = `${name} — AniNest`;
  root.innerHTML = loadingHTML('LOOKING UP THE VOICE ACTOR');

  let data;
  try {
    data = await Api.person(name);
  } catch (err) {
    if (err.status === 404) {
      root.innerHTML = emptyHTML(`No voice actor found matching "${name}".`, '🎙️');
      return;
    }
    root.innerHTML = errorHTML('Couldn’t load this person right now — try again shortly!');
    wireRetry(root, () => renderPerson(root, name));
    return;
  }

  const anime = data.roles.map((r) => r.anime);

  root.innerHTML = `
    <div class="account-page">
      <div class="account-avatar">
        ${data.image ? `<img src="${escapeHtml(data.image)}" alt="${escapeHtml(data.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : escapeHtml(data.name[0]?.toUpperCase() || '?')}
      </div>
      <h1 class="detail-title" style="-webkit-text-stroke:0.5px var(--ink)">${escapeHtml(data.name)}</h1>
      <p class="section-sub">🎙️ Voice actor</p>
    </div>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">🎭 Roles</h2>
        <span class="section-sub">${anime.length} anime on AniNest</span>
      </div>
      ${anime.length ? cardGrid(anime) : emptyHTML('No roles found.', '🎭')}
    </section>
  `;
}

import { Api, imageOf } from '../lib/api.js';
import { WatchSources } from '../lib/watchSourcesApi.js';
import { loadingHTML, errorHTML, escapeHtml, wireRetry, showToast } from '../lib/ui.js';
import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';

function formHTML(anime) {
  return `
    <div class="detail-hero" style="background:linear-gradient(160deg, rgba(123,47,247,0.25), rgba(18,12,34,0.9)), var(--panel)">
      ${imageOf(anime) ? `<img class="detail-poster" src="${escapeHtml(imageOf(anime))}" alt="${escapeHtml(anime.title)}" />` : ''}
      <div class="detail-main">
        <h1 class="detail-title">Suggest a free watch link</h1>
        <p class="detail-title-en">for ${escapeHtml(anime.title)}</p>
      </div>
    </div>

    <div class="watch-box">
      <h3>📺 Got an official free episode?</h3>
      <p style="color:var(--muted);font-weight:600;margin:0 0 12px">
        Only real YouTube links from official channels (Muse Asia, Ani-One Asia, Crunchyroll, etc.) — not scans/rips, not other sites.
        Every submission is reviewed before it goes live on the site.
      </p>
      <form id="submit-form">
        <div class="form-field">
          <label for="yt-url">YouTube link</label>
          <input type="text" id="yt-url" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off"
            style="width:100%;padding:12px 14px;border:2.5px solid var(--ink);border-radius:10px;background:var(--bg2);color:var(--text);font-family:var(--font-body);font-weight:600" />
        </div>
        <div class="form-field">
          <label for="yt-channel">Channel (optional)</label>
          <input type="text" id="yt-channel" placeholder="e.g. Muse Asia" autocomplete="off"
            style="width:100%;padding:12px 14px;border:2.5px solid var(--ink);border-radius:10px;background:var(--bg2);color:var(--text);font-family:var(--font-body);font-weight:600" />
        </div>
        <div class="hero-actions">
          <button type="submit" class="btn-pow btn-pow--pink">SUBMIT FOR REVIEW</button>
          <a href="#/anime/${anime.mal_id}" class="btn-pow btn-pow--outline">CANCEL</a>
        </div>
      </form>
    </div>`;
}

function loginPromptHTML(malId) {
  return `
    <div class="empty-state">
      <span class="big-emoji">🔒</span>
      Log in to suggest a free watch link.
      <div class="hero-actions" style="justify-content:center;margin-top:16px">
        <a href="#/login" class="btn-pow btn-pow--pink">LOG IN</a>
        <a href="#/anime/${malId}" class="btn-pow btn-pow--outline">BACK</a>
      </div>
    </div>`;
}

export async function renderWatchSourceSubmit(root, id) {
  if (!Auth.get().user) {
    root.innerHTML = loginPromptHTML(id);
    return;
  }

  root.innerHTML = loadingHTML('LOADING');
  try {
    const { data: anime } = await Api.fullById(id);
    document.title = `Suggest a link — ${anime.title} — AniNest`;
    root.innerHTML = formHTML(anime);

    root.querySelector('#submit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = root.querySelector('#yt-url').value.trim();
      const channel = root.querySelector('#yt-channel').value.trim();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        await WatchSources.submit(anime.mal_id, url, channel);
        showToast('Thanks! Submitted for review.');
        navigate(`#/anime/${anime.mal_id}`);
      } catch (err) {
        showToast(err.message || 'Something went wrong — try again.');
        submitBtn.disabled = false;
      }
    });
  } catch (err) {
    console.error(err);
    root.innerHTML = errorHTML('Couldn’t load this anime — try again shortly!');
    wireRetry(root, () => renderWatchSourceSubmit(root, id));
  }
}

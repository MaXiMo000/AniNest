import { escapeHtml, showToast } from './ui.js';
import { Auth } from './authStore.js';
import { navigate } from './router.js';
import { powSelectHTML } from './powSelect.js';

// The "Community Reviews" block (average, write/edit form, list), shared by
// the anime detail page and the manga detail page. It only differs in which
// API it talks to - `api` is { list(id), submit(id, rating, body), remove(id) }
// (see reviewsApi.js), and `id` is whatever identifies the title there (a MAL
// id for anime, a MangaDex UUID for manga).
const EMPTY = { reviews: [], average: null, count: 0, myReview: null };

function reviewCardHTML(r, isMine) {
  const date = new Date(r.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `
    <div class="review-card ${isMine ? 'review-mine' : ''}">
      <div class="review-head">
        <span class="badge-score small">${r.rating}</span>
        <a href="#/u/${encodeURIComponent(r.username)}"><strong>${escapeHtml(r.username)}</strong></a>
        <span class="review-date">${escapeHtml(date)}${isMine ? ' · you' : ''}</span>
      </div>
      ${r.body ? `<p class="review-body">${escapeHtml(r.body)}</p>` : ''}
    </div>`;
}

function reviewFormHTML(myReview) {
  const options = Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => ({ value: n, label: `${n} / 10` }));
  return `
    <div class="watch-box">
      <h3>${myReview ? '✏️ Edit Your Review' : '✍️ Write a Review'}</h3>
      <form id="review-form">
        <div class="form-field">
          <label>Your Rating</label>
          ${powSelectHTML({ id: 'review-rating', options, value: myReview?.rating ?? 10 })}
        </div>
        <div class="form-field">
          <label for="review-body">Your Thoughts (optional)</label>
          <textarea id="review-body" rows="3" maxlength="2000" style="width:100%;padding:12px 14px;border:2.5px solid var(--ink);border-radius:10px;background:var(--bg2);color:var(--text);font-family:var(--font-body);font-weight:600;resize:vertical">${escapeHtml(myReview?.body || '')}</textarea>
        </div>
        <div class="hero-actions">
          <button type="submit" class="btn-pow btn-pow--pink">${myReview ? 'UPDATE REVIEW' : 'POST REVIEW'}</button>
          ${myReview ? '<button type="button" id="review-delete" class="btn-pow btn-pow--outline">DELETE</button>' : ''}
        </div>
      </form>
    </div>`;
}

function reviewLoginPromptHTML() {
  return `
    <div class="watch-box">
      <h3>💬 Got thoughts on this one?</h3>
      <p style="color:var(--muted);font-weight:600;margin:0 0 12px">Log in to leave a rating and review.</p>
      <div class="hero-actions">
        <a href="#/login" class="btn-pow btn-pow--pink">LOG IN</a>
        <a href="#/register" class="btn-pow btn-pow--outline">SIGN UP</a>
      </div>
    </div>`;
}

export function createReviewsUi(api) {
  const load = (id) => api.list(id).catch(() => EMPTY);

  function sectionHTML(reviewsData) {
    const { reviews, average, count } = reviewsData;
    return `
    <section class="section" id="reviews-section">
      <div class="section-head">
        <h2 class="section-title">💬 Community Reviews</h2>
        <span class="section-sub">${count ? `★ ${average} average from ${count} review${count === 1 ? '' : 's'}` : 'No reviews yet — be the first!'}</span>
      </div>
      <div id="review-form-area">${Auth.get().user ? reviewFormHTML(reviewsData.myReview) : reviewLoginPromptHTML()}</div>
      <div id="review-list">${reviews.length ? reviews.map((r) => reviewCardHTML(r, r.username === Auth.get().user?.username)).join('') : ''}</div>
    </section>`;
  }

  async function reload(root, id) {
    const reviewsData = await load(id);
    const section = root.querySelector('#reviews-section');
    if (!section) return;
    section.outerHTML = sectionHTML(reviewsData);
    wire(root, id);
  }

  function wire(root, id) {
    const form = root.querySelector('#review-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rating = Number(root.querySelector('#review-rating').value);
      const body = root.querySelector('#review-body').value.trim();
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        await api.submit(id, rating, body);
        showToast('Review saved!');
        await reload(root, id);
      } catch (err) {
        if (err.status === 401) {
          showToast('Log in to save your review!');
          navigate('#/login');
          return;
        }
        showToast(err.message || 'Something went wrong — try again.');
        submitBtn.disabled = false;
      }
    });

    root.querySelector('#review-delete')?.addEventListener('click', async () => {
      try {
        await api.remove(id);
        showToast('Review deleted.');
        await reload(root, id);
      } catch {
        showToast('Something went wrong — try again.');
      }
    });
  }

  return { load, sectionHTML, wire };
}

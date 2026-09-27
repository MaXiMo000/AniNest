import { apiPost } from '../lib/http.js';
import { emptyHTML, errorHTML, loadingHTML } from '../lib/ui.js';

// The weekly digest's unsubscribe link. It needs no login: the token in the
// link turns that one email off. Link scanners don't run scripts, so doing it
// on load can't be triggered by a mail filter prefetching the link.
export async function renderUnsubscribe(root, params) {
  document.title = 'Unsubscribe — AniNest';
  root.innerHTML = loadingHTML('UNSUBSCRIBING');
  try {
    await apiPost('/api/notifications/unsubscribe', { token: params.get('token') || '' });
    root.innerHTML = `${emptyHTML('You won’t get the weekly email any more. You can turn it back on from your account page.', '✉️')}
      <div class="hero-actions" style="justify-content:center"><a class="btn-pow btn-pow--outline" href="#/account">MY ACCOUNT</a></div>`;
  } catch (err) {
    root.innerHTML = errorHTML(err.message || 'That unsubscribe link didn’t work.');
  }
}

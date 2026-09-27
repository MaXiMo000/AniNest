import { API_BASE } from './http.js';
import { showToast } from './ui.js';

// Share links point at the backend's preview pages (/api/share/...), which
// carry per-page og: tags for WhatsApp/Discord/X and then open the real
// hash-routed page. See backend/src/routes/share.js.
export function shareUrl(kind, id) {
  return `${API_BASE}/api/share/${kind}/${encodeURIComponent(id)}`;
}

export function shareButtonHTML(label = '📤 SHARE') {
  return `<button type="button" class="btn-pow btn-pow--outline" data-share>${label}</button>`;
}

export function wireShare(root, { kind, id, title }) {
  root.querySelectorAll('[data-share]').forEach((btn) => btn.addEventListener('click', async () => {
    const url = shareUrl(kind, id);
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied!');
    } catch {
      window.prompt('Copy this link:', url);
    }
  }));
}

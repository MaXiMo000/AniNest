import { Router } from 'express';
import { db } from '../lib/db.js';
import * as animeSource from '../lib/animeSource.js';
import { logger } from '../lib/logger.js';

// Link-preview pages. The SPA uses hash routes (#/anime/123), and link
// crawlers (WhatsApp, Discord, X...) never see anything after the #, so a
// shared anime link always previewed as the home page. These URLs sit under
// /api (which the frontend proxies to us, see render.yaml), carry the right
// og: tags for one anime or profile, and send people on to the real page.
export const shareRouter = Router();

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function origin() {
  return (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
}

function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function page({ title, description, image, hash }) {
  const target = `${origin()}/${hash}`;
  const img = image || `${origin()}/og-image.jpg`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AniNest">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(target)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="${image ? 'summary' : 'summary_large_image'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
</head><body><p><a href="${esc(target)}">Open ${esc(title)}</a></p></body></html>`;
}

function send(res, html) {
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.send(html);
}

shareRouter.get('/anime/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Not found.' });
  const hash = `#/anime/${id}`;
  try {
    const { data: a } = await animeSource.fullById(id);
    const image = a.images?.jpg?.large_image_url || a.images?.webp?.large_image_url || a.images?.jpg?.image_url;
    const score = a.score ? `★ ${Number(a.score).toFixed(1)} · ` : '';
    send(res, page({ title: `${a.title} — AniNest`, description: `${score}${clip(a.synopsis, 180)}`, image, hash }));
  } catch (err) {
    // The redirect matters more than the preview: fall back to the site card.
    logger.warn({ err, id }, 'share preview: anime lookup failed');
    send(res, page({ title: 'AniNest', description: 'Your anime & manga home base.', hash }));
  }
});

shareRouter.get('/u/:username', async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(404).json({ error: 'Not found.' });
  const found = await db.execute({
    sql: `SELECT u.username, u.is_private, (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) AS favs,
                 (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id AND r.hidden = 0) AS reviews
          FROM users u WHERE u.username = ? COLLATE NOCASE ORDER BY u.username = ? DESC LIMIT 1`,
    args: [username, username],
  }).catch(() => null);
  const u = found?.rows[0];
  if (!u) return send(res, page({ title: 'AniNest', description: 'Your anime & manga home base.', hash: '#/' }));
  send(res, page({
    title: `${u.username} on AniNest`,
    description: Number(u.is_private)
      ? 'Their level and badges on AniNest, your anime & manga home base.'
      : `${Number(u.favs)} anime on their list and ${Number(u.reviews)} reviews. See their taste, badges and XP.`,
    hash: `#/u/${encodeURIComponent(u.username)}`,
  }));
});

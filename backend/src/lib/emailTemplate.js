// Every email AniNest sends, as HTML (for mail apps) and plain text (the
// fallback part), built from one description so the two never drift apart.
//
// Email HTML is its own world: tables for layout, inline styles only, no web
// fonts, no remote images (often blocked, and they'd let us track opens).
// This keeps to what Gmail, Outlook and Apple Mail all render the same way.
//
// renderEmail({
//   preheader: the grey preview line in the inbox,
//   heading, greeting?, paragraphs: [text],
//   button?: { label, url },
//   details?: [{ label, value }],   a small facts table (device, time...)
//   sections?: [{ title, emoji?, items: [{ text, url?, sub? }], more?: { label, url } }],
//   note?: text, a quieter line under the main content,
//   footer: [text], footerLinks?: [{ label, url }],
// }) -> { html, text }

const INK = '#16101f';
const PINK = '#e0115f';
const PURPLE = '#7b2ff7';
const MUTED = '#6b5f86';
const PAPER = '#f4f1fb';

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function buttonHTML({ label, url }) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px">
      <tr><td style="background:${PINK};border:3px solid ${INK};border-radius:12px">
        <a href="${esc(url)}" style="display:inline-block;padding:14px 28px;${FONT};font-size:16px;font-weight:800;letter-spacing:.3px;color:#ffffff;text-decoration:none">${esc(label)}</a>
      </td></tr>
    </table>
    <p style="margin:0 0 4px;${FONT};font-size:12px;color:${MUTED}">Button not working? Copy this link:<br><a href="${esc(url)}" style="color:${PURPLE};word-break:break-all">${esc(url)}</a></p>`;
}

function detailsHTML(details) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 4px;background:${PAPER};border-radius:12px">
      ${details.map((d) => `
      <tr>
        <td style="padding:10px 16px;${FONT};font-size:13px;font-weight:700;color:${MUTED};width:110px;vertical-align:top">${esc(d.label)}</td>
        <td style="padding:10px 16px 10px 0;${FONT};font-size:14px;color:${INK}">${esc(d.value)}</td>
      </tr>`).join('')}
    </table>`;
}

function sectionHTML(s) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 0">
      <tr><td style="padding:0 0 8px;border-bottom:2px solid ${INK};${FONT};font-size:13px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:${INK}">${s.emoji ? `${esc(s.emoji)}&nbsp; ` : ''}${esc(s.title)}</td></tr>
      ${s.items.map((i) => `
      <tr><td style="padding:12px 0;border-bottom:1px solid #e6e0f2;${FONT}">
        ${i.url ? `<a href="${esc(i.url)}" style="font-size:15px;font-weight:700;color:${INK};text-decoration:none">${esc(i.text)}</a>` : `<span style="font-size:15px;font-weight:600;color:${INK}">${esc(i.text)}</span>`}
        ${i.sub ? `<div style="margin-top:3px;font-size:13px;color:${MUTED}">${esc(i.sub)}</div>` : ''}
      </td></tr>`).join('')}
      ${s.more ? `<tr><td style="padding:12px 0 0;${FONT};font-size:14px"><a href="${esc(s.more.url)}" style="color:${PURPLE};font-weight:700;text-decoration:none">${esc(s.more.label)} &rarr;</a></td></tr>` : ''}
    </table>`;
}

export function renderEmail(m) {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(m.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.preheader || '')}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAPER}">
    <tr><td align="center" style="padding:28px 14px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">
        <tr><td style="background:${INK};border-radius:16px 16px 0 0;padding:18px 28px">
          <span style="font-family:Impact,'Arial Black',Arial,sans-serif;font-size:26px;letter-spacing:1px;color:#ffffff">ANI<span style="color:#ff2d78">NEST</span></span>
        </td></tr>
        <tr><td style="background:#ffffff;border:3px solid ${INK};border-top:0;border-radius:0 0 16px 16px;padding:30px 28px 28px">
          <h1 style="margin:0 0 14px;${FONT};font-size:24px;line-height:1.25;font-weight:800;color:${INK}">${esc(m.heading)}</h1>
          ${m.greeting ? `<p style="margin:0 0 12px;${FONT};font-size:16px;line-height:1.55;color:${INK}">${esc(m.greeting)}</p>` : ''}
          ${(m.paragraphs || []).map((p) => `<p style="margin:0 0 12px;${FONT};font-size:16px;line-height:1.55;color:${INK}">${esc(p)}</p>`).join('')}
          ${m.details ? detailsHTML(m.details) : ''}
          ${m.button ? buttonHTML(m.button) : ''}
          ${(m.sections || []).map(sectionHTML).join('')}
          ${m.note ? `<p style="margin:22px 0 0;${FONT};font-size:14px;line-height:1.5;color:${MUTED}">${esc(m.note)}</p>` : ''}
        </td></tr>
        <tr><td style="padding:18px 10px 0;${FONT};font-size:12px;line-height:1.6;color:${MUTED};text-align:center">
          ${(m.footer || []).map(esc).join('<br>')}
          ${m.footerLinks?.length ? `<br>${m.footerLinks.map((l) => `<a href="${esc(l.url)}" style="color:${MUTED};text-decoration:underline">${esc(l.label)}</a>`).join(' &nbsp;·&nbsp; ')}` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const lines = [m.heading.toUpperCase(), ''];
  if (m.greeting) lines.push(m.greeting, '');
  for (const p of m.paragraphs || []) lines.push(p, '');
  if (m.details) { for (const d of m.details) lines.push(`  ${d.label}: ${d.value}`); lines.push(''); }
  if (m.button) lines.push(`${m.button.label}: ${m.button.url}`, '');
  for (const s of m.sections || []) {
    lines.push(s.title.toUpperCase());
    for (const i of s.items) lines.push(`- ${i.text}${i.sub ? ` (${i.sub})` : ''}${i.url ? `\n  ${i.url}` : ''}`);
    if (s.more) lines.push(`${s.more.label}: ${s.more.url}`);
    lines.push('');
  }
  if (m.note) lines.push(m.note, '');
  lines.push('--', ...(m.footer || []), ...(m.footerLinks || []).map((l) => `${l.label}: ${l.url}`));
  return { html, text: lines.join('\n').trim() };
}

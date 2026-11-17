// A square, shareable image of a passage from a classic: the quote, the book
// and its author, in AniNest's comic style. Drawn on a canvas, so it needs no
// library and no network.

const SIZE = 1080;
const PAD = 96;

// Words -> lines that fit `width` at the context's current font.
export function wrapLines(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function quoteCardBlob({ quote, title, author, chapter }) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, '#2a1450');
  bg.addColorStop(1, '#120c22');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Comic panel: a thick ink border with an offset shadow.
  ctx.fillStyle = '#000';
  ctx.fillRect(PAD / 2 + 14, PAD / 2 + 14, SIZE - PAD, SIZE - PAD);
  ctx.fillStyle = '#1d1238';
  ctx.fillRect(PAD / 2, PAD / 2, SIZE - PAD, SIZE - PAD);
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffd23f';
  ctx.strokeRect(PAD / 2, PAD / 2, SIZE - PAD, SIZE - PAD);

  ctx.fillStyle = '#ff4fa3';
  ctx.font = 'bold 200px Georgia, serif';
  ctx.fillText('“', PAD, PAD + 170);

  // The largest size that fits the quote in the space left.
  const width = SIZE - PAD * 2 - 20;
  const room = SIZE - PAD * 2 - 330;
  let size = 60;
  let lines;
  for (; size > 26; size -= 2) {
    ctx.font = `${size}px Georgia, serif`;
    lines = wrapLines(ctx, quote, width);
    if (lines.length * size * 1.35 <= room) break;
  }
  ctx.fillStyle = '#fff8e7';
  lines.forEach((l, i) => ctx.fillText(l, PAD + 10, PAD + 230 + i * size * 1.35));

  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 40px system-ui, sans-serif';
  const meta = wrapLines(ctx, title, width).slice(0, 2);
  const metaTop = SIZE - PAD - 150 - (meta.length - 1) * 48;
  meta.forEach((l, i) => ctx.fillText(l, PAD + 10, metaTop + i * 48));
  ctx.fillStyle = '#c9b8f0';
  ctx.font = '32px system-ui, sans-serif';
  ctx.fillText([author, chapter].filter(Boolean).join(' · ').slice(0, 60), PAD + 10, SIZE - PAD - 90);
  ctx.fillStyle = '#ff4fa3';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText('📜 Read it free on AniNest', PAD + 10, SIZE - PAD - 30);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas export failed'))), 'image/png'));
}

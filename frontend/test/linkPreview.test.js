import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Link previews (WhatsApp, Discord, X...) showed a blank image because
// index.html pointed og:image at a file that was never committed. The SPA
// catch-all rewrite in render.yaml then answered /og-image.* with index.html,
// so crawlers got HTML where they expected an image.
const root = `${resolve(__dirname, '..')}/`;
const html = readFileSync(`${root}index.html`, 'utf8');
const SITE = 'https://aninest-frontend.onrender.com/';

function meta(attr, key) {
  const m = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`));
  return m?.[1];
}

// JPEG stores its size in the SOF0/SOF2 frame header; PNG in the IHDR chunk.
function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        return { type: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

describe('link preview image', () => {
  const image = meta('property', 'og:image');

  it('uses an absolute URL on the site origin', () => {
    expect(image).toMatch(new RegExp(`^${SITE}`));
    expect(meta('name', 'twitter:image')).toBe(image);
  });

  it('points at a real file shipped from public/', () => {
    const file = `${root}public/${image.slice(SITE.length)}`;
    expect(existsSync(file), `${file} is missing`).toBe(true);

    const buf = readFileSync(file);
    const size = imageSize(buf);
    expect(size, 'not a PNG or JPEG').not.toBeNull();
    expect(size.type).toBe(meta('property', 'og:image:type'));
    expect(String(size.width)).toBe(meta('property', 'og:image:width'));
    expect(String(size.height)).toBe(meta('property', 'og:image:height'));
    // WhatsApp drops preview images much over ~300 KB.
    expect(buf.length).toBeLessThan(300 * 1024);
  });
});

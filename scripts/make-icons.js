/**
 * Generates every logo asset from one vector definition of the Life OS mark:
 * the folded "L" - two crimson planks meeting at the lower right, each fading
 * darker toward the fold.
 *
 * No image tooling: polygons are rasterised here with 4x4 supersampling and
 * written with a tiny PNG encoder over node:zlib. The SVGs are emitted from the
 * same points, so the favicon, the Home Screen icon and the sign-in page mark
 * can never drift apart. Run `npm run icons` after changing the geometry.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/* ------------------------------------------------------------------ *
 * The mark, in a 100x100 design space
 * ------------------------------------------------------------------ */

// Vertical plank: slanted top edge rising to the right, down to the fold.
const VERTICAL = [
  [62, 14],
  [80, 4],
  [82, 84],
  [64, 74],
];
// Horizontal plank: skewed base running into the fold.
const HORIZONTAL = [
  [30, 76],
  [64, 74],
  [82, 84],
  [14, 96],
];

// Each plank is bright at its outer end and dark at the fold.
const BRIGHT = [0xc8, 0x16, 0x40];
const DARK = [0x4a, 0x07, 0x18];
const GRADIENTS = {
  vertical: { from: [71, 8], to: [73, 80] },
  horizontal: { from: [20, 88], to: [76, 80] },
};

const BG = [0x09, 0x09, 0x0c];

/* ------------------------------------------------------------------ *
 * SVG
 * ------------------------------------------------------------------ */

const pts = (poly) => poly.map(([x, y]) => `${x},${y}`).join(' ');
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function markSvg({ background, padding = 0, rounded = 0 }) {
  const size = 100 + padding * 2;
  const g = (id, { from, to }) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}"><stop offset="0" stop-color="${hex(BRIGHT)}"/><stop offset="1" stop-color="${hex(DARK)}"/></linearGradient>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-padding} ${-padding} ${size} ${size}" role="img" aria-label="Life OS">`,
    `<defs>${g('lv', GRADIENTS.vertical)}${g('lh', GRADIENTS.horizontal)}</defs>`,
    background ? `<rect x="${-padding}" y="${-padding}" width="${size}" height="${size}" rx="${rounded}" fill="${hex(BG)}"/>` : '',
    `<polygon points="${pts(HORIZONTAL)}" fill="url(#lh)"/>`,
    `<polygon points="${pts(VERTICAL)}" fill="url(#lv)"/>`,
    `</svg>\n`,
  ].join('');
}

/* ------------------------------------------------------------------ *
 * Raster
 * ------------------------------------------------------------------ */

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function gradientAt({ from, to }, x, y) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const t = Math.max(0, Math.min(1, ((x - from[0]) * dx + (y - from[1]) * dy) / (dx * dx + dy * dy)));
  return BRIGHT.map((b, c) => b + (DARK[c] - b) * t);
}

/**
 * @param size   output pixels
 * @param markFraction  how much of the icon width the 100-unit design space fills
 * @param rounded       corner radius as a fraction of size (0 = square)
 */
function render(size, { markFraction, rounded }) {
  const SS = 4;
  const out = new Uint8Array(size * size * 4);
  const offset = (1 - markFraction) / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cover = 0;
      const rgb = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          if (rounded > 0) {
            const qx = Math.max(Math.abs(u - 0.5) - (0.5 - rounded), 0);
            const qy = Math.max(Math.abs(v - 0.5) - (0.5 - rounded), 0);
            if (qx * qx + qy * qy > rounded * rounded) continue;
          }
          cover++;
          // Into the 100-unit design space.
          const x = ((u - offset) / markFraction) * 100;
          const y = ((v - offset) / markFraction) * 100;
          // Vertical plank is drawn over the horizontal one at the fold.
          const color = inside(VERTICAL, x, y)
            ? gradientAt(GRADIENTS.vertical, x, y)
            : inside(HORIZONTAL, x, y)
              ? gradientAt(GRADIENTS.horizontal, x, y)
              : BG;
          for (let c = 0; c < 3; c++) rgb[c] += color[c];
        }
      }
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = cover ? Math.round(rgb[c] / cover) : 0;
      out[i + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  return encodePng(size, out);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

mkdirSync('public/icons', { recursive: true });

// iOS rounds Home Screen icons itself and renders transparency as black, so the
// touch icon is a full-bleed opaque square.
writeFileSync('public/apple-touch-icon.png', render(180, { markFraction: 0.62, rounded: 0 }));
writeFileSync('public/icons/icon-192.png', render(192, { markFraction: 0.6, rounded: 0.22 }));
writeFileSync('public/icons/icon-512.png', render(512, { markFraction: 0.6, rounded: 0.22 }));
// Maskable: Android may crop to a circle, so the mark sits well inside the safe zone.
writeFileSync('public/icons/icon-maskable-512.png', render(512, { markFraction: 0.46, rounded: 0 }));

// Favicon on a dark tile, so it reads on light browser tab strips too.
writeFileSync('public/favicon.svg', markSvg({ background: true, padding: 14, rounded: 26 }));
// Bare mark for the sign-in page and in-app use.
writeFileSync('public/logo-mark.svg', markSvg({ background: false }));

console.log('logo assets written');

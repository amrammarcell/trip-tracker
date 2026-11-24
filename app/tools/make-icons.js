// Generates the PWA icons (no dependencies): node app/tools/make-icons.js
// Suitcase on a teal→blue gradient, anti-aliased with signed distance functions.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// --- tiny PNG encoder ---
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// --- shapes (coordinates in 0..1 space) ---
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const mix = (a, b, t) => a + (b - a) * t;
const C1 = [15, 118, 110], C2 = [29, 78, 216]; // teal-700 → blue-700

function draw(size, { maskable = false, rounded = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const s = maskable ? 0.8 : 1;           // keep artwork inside the maskable safe zone
  const aa = 1.2 / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + 0.5) / size, y = (j + 0.5) / size;
    // background
    const t = Math.min(1, Math.max(0, (x + y) / 2));
    let col = [mix(C1[0], C2[0], t), mix(C1[1], C2[1], t), mix(C1[2], C2[2], t)];
    let alpha = 1;
    if (rounded && !maskable) alpha = Math.min(1, Math.max(0, 0.5 - sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22) / aa));
    // artwork, scaled around the centre
    const u = 0.5 + (x - 0.5) / s, v = 0.5 + (y - 0.5) / s;
    const body = sdRoundRect(u, v, 0.5, 0.58, 0.27, 0.2, 0.07);
    const handleOuter = sdRoundRect(u, v, 0.5, 0.33, 0.11, 0.08, 0.05);
    const handleInner = sdRoundRect(u, v, 0.5, 0.35, 0.065, 0.05, 0.02);
    const handle = Math.max(handleOuter, -handleInner, v - 0.39);
    const white = Math.min(body, handle);
    const stripe = Math.min(sdRoundRect(u, v, 0.38, 0.58, 0.022, 0.2, 0.01), sdRoundRect(u, v, 0.62, 0.58, 0.022, 0.2, 0.01));
    const cover = a => Math.min(1, Math.max(0, 0.5 - a / (aa / s)));
    const w = cover(white), st = cover(Math.max(stripe, body)) * 0.9;
    col = col.map(c => mix(c, 255, w));
    const stripeCol = [mix(C1[0], C2[0], 0.5), mix(C1[1], C2[1], 0.5), mix(C1[2], C2[2], 0.5)];
    col = col.map((c, k) => mix(c, stripeCol[k], st));
    const o = (j * size + i) * 4;
    px[o] = Math.round(col[0]); px[o + 1] = Math.round(col[1]); px[o + 2] = Math.round(col[2]); px[o + 3] = Math.round(alpha * 255);
  }
  return png(size, px);
}

const files = {
  'icon-192.png': draw(192),
  'icon-512.png': draw(512),
  'icon-maskable-512.png': draw(512, { maskable: true }),
  'apple-touch-icon.png': draw(180, { rounded: false }), // iOS rounds the corners itself and dislikes transparency
  'favicon-32.png': draw(32),
};
for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), buf);
console.log('Icons written to', OUT, Object.keys(files).join(', '));

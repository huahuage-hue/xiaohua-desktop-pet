// Matte a near-white background with a border flood fill, preserving interior whites.
// usage: node tools/matte.js <in.png> <out.png> [lumTol] [satTol]
'use strict';
const fs = require('fs');
const { decodePNG, encodePNG } = require('./psdlib');

const inPath = process.argv[2], outPath = process.argv[3];
const lumTol = Number(process.argv[4] || 200);
const satTol = Number(process.argv[5] || 24);
if (!inPath || !outPath) { console.error('usage: node tools/matte.js <in.png> <out.png> [lumTol] [satTol]'); process.exit(1); }

const { width: w, height: h, rgba: px } = decodePNG(fs.readFileSync(inPath));
const N = w * h;
const bg = new Uint8Array(N);
const q = new Int32Array(N); let qh = 0, qt = 0;

function isBg(i) {
  const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return lum >= lumTol && (mx - mn) <= satTol;
}
function push(i) { if (!bg[i] && isBg(i)) { bg[i] = 1; q[qt++] = i; } }

for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
while (qh < qt) {
  const i = q[qh++], x = i % w, y = (i / w) | 0;
  if (x > 0) push(i - 1);
  if (x < w - 1) push(i + 1);
  if (y > 0) push(i - w);
  if (y < h - 1) push(i + w);
}

let removed = 0;
for (let i = 0; i < N; i++) if (bg[i]) { px[i * 4 + 3] = 0; removed++; }

// Bleed edge RGB inward so bilinear sampling never picks up white.
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = y * w + x; if (!bg[i]) continue;
  let r = 0, g = 0, b = 0, n = 0;
  for (const j of [i - 1, i + 1, i - w, i + w]) if (!bg[j]) { r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; n++; }
  if (n) { px[i * 4] = (r / n) | 0; px[i * 4 + 1] = (g / n) | 0; px[i * 4 + 2] = (b / n) | 0; }
}
// Soften only the silhouette by one ring.
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = y * w + x; if (bg[i]) continue;
  let n = 0; for (const j of [i - 1, i + 1, i - w, i + w]) if (bg[j]) n++;
  if (n) px[i * 4 + 3] = 225;
}

fs.writeFileSync(outPath, encodePNG(w, h, px));
console.log(`${inPath} -> ${outPath}  ${w}x${h}  bg=${(removed / N * 100).toFixed(1)}%`);

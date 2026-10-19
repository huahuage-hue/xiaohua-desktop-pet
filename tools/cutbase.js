// Split the standing side view into body + far/near legs for a 2D walk puppet.
// usage: node tools/cutbase.js psd/raw/gen/walk_side_base_cut.png psd/raw/gen/puppet
'use strict';
const fs = require('fs');
const path = require('path');
const { decodePNG, encodePNG } = require('./psdlib');

const src = process.argv[2], outDir = process.argv[3];
if (!src || !outDir) { console.error('usage: node tools/cutbase.js <base_cut.png> <outDir>'); process.exit(1); }
const { width: w, height: h, rgba } = decodePNG(fs.readFileSync(src));
fs.mkdirSync(outDir, { recursive: true });

const LEG_TOP = 1480;
const body = Buffer.from(rgba);
const far = Buffer.alloc(w * h * 4);
const near = Buffer.alloc(w * h * 4);

function splitX(y) {
  if (y < 1860) return 548;
  if (y < 1905) return Math.round(548 + (580 - 548) * (y - 1860) / 45);
  return 580;
}

for (let y = 0; y < h; y++) {
  const sx = splitX(y);
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = rgba[i + 3];
    if (!a) continue;
    const capsule = y < 1510 || (y < 1590 && (x < 455 || x > 700));
    if (!capsule) body[i + 3] = 0;
    if (y >= LEG_TOP && x >= 450 && x <= 800) {
      const dst = x < sx ? far : near;
      dst[i] = rgba[i]; dst[i + 1] = rgba[i + 1]; dst[i + 2] = rgba[i + 2]; dst[i + 3] = a;
    }
  }
}
fs.writeFileSync(path.join(outDir, 'body.png'), encodePNG(w, h, body));
fs.writeFileSync(path.join(outDir, 'leg_far.png'), encodePNG(w, h, far));
fs.writeFileSync(path.join(outDir, 'leg_near.png'), encodePNG(w, h, near));
console.log('puppet parts ->', outDir);



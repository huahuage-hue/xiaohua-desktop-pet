/* 生成换装面板缩略图：按预设把套装 + 配饰合成为 1200×2133 后，取头部方框缩放到 216×216。
   用法：node tools/thumbs.js
   依赖 tools/preview_dress.js 的合成逻辑（通过子进程调用，避免复制图层顺序代码）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const P = require('./psdlib.js');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets/wardrobe');
const TMP = path.join(require('os').tmpdir(), 'xh-thumbs');
const NODE = process.execPath;

const CROP = [150, 40, 1050, 940];
const SIZE = 216;

/* 与 app-dress.js 的 PRESETS 保持一致 */
const SETS = {
  classic: { file: 'classic', acc: 'flower' },
  cream: { file: 'o_cream', acc: 'flower' },
  plaid: { file: 'o_plaid', acc: 'scarf' },
  moon: { file: 'o_moon', acc: 'ribbon,charm' },
  star: { file: 'o_star', acc: 'fur,charm' },
  spring: { file: 'f_spring', acc: 'lantern,knot' },
  valentine: { file: 'f_valentine', acc: 'heart' },
  dragon: { file: 'f_dragon', acc: 'sachet' },
  midautumn: { file: 'f_midautumn', acc: 'bunny' },
  halloween: { file: 'f_halloween', acc: 'witch' },
  xmas: { file: 'f_xmas', acc: 'antler,bell' },
};

function areaScale(img, box, size) {
  const [x0, y0, x1, y1] = box;
  const sw = x1 - x0, sh = y1 - y0, out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const ax = x0 + x * sw / size, bx = x0 + (x + 1) * sw / size;
    const ay = y0 + y * sh / size, by = y0 + (y + 1) * sh / size;
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let Y = Math.floor(ay); Y < Math.ceil(by); Y++) for (let X = Math.floor(ax); X < Math.ceil(bx); X++) {
      if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) continue;
      const w = (Math.min(bx, X + 1) - Math.max(ax, X)) * (Math.min(by, Y + 1) - Math.max(ay, Y));
      if (w <= 0) continue;
      const q = (Y * img.width + X) * 4, al = img.rgba[q + 3] / 255 * w;
      r += img.rgba[q] * al; g += img.rgba[q + 1] * al; b += img.rgba[q + 2] * al; a += al; n += w;
    }
    const o = (y * size + x) * 4;
    out[o] = a > 0 ? Math.round(r / a) : 0;
    out[o + 1] = a > 0 ? Math.round(g / a) : 0;
    out[o + 2] = a > 0 ? Math.round(b / a) : 0;
    out[o + 3] = Math.round(a / n * 255);
  }
  return { width: size, height: size, rgba: out };
}

fs.mkdirSync(TMP, { recursive: true });
for (const [id, set] of Object.entries(SETS)) {
  const full = path.join(TMP, id + '.png');
  if (!fs.existsSync(full)) {
    execFileSync(NODE, [path.join(__dirname, 'preview_dress.js'), set.file + '|' + set.acc, full, '0,0,1200,2133', '1'], { cwd: ROOT, stdio: 'inherit' });
  }
  const img = P.decodePNG(fs.readFileSync(full));
  const thumb = areaScale(img, CROP, SIZE);
  const dst = path.join(OUT, 'thumb_' + id + '.png');
  fs.writeFileSync(dst, P.encodePNG(SIZE, SIZE, thumb.rgba));
  console.log('thumb', id, '->', dst);
}

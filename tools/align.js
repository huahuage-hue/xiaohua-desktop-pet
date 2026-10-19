/* 配准：把 Seedream 生成图对齐回原画（assets/xiaohua_ref.png，3040×5404）坐标
   模型：原画坐标 = 裁切左上角 + d + s × 生成图坐标（只做平移 + 等比缩放，粗到细搜索，梯度 NCC）
   输出：psd/raw/gen/aligned_<name>.png（裁切区域大小，原画坐标）与 psd/raw/gen/align.json
   用法：node tools/align.js [name ...] */
'use strict';
const fs = require('fs'), path = require('path');
const P = require('./psdlib.js');
const ROOT = path.resolve(__dirname, '..');
const GEN = path.join(ROOT, 'psd/raw/gen');

/* 生成图 → 原画裁切区域（原画像素） */
const JOBS = {
  eye_close: { crop: [912, 1064, 1216, 912] },
  eye_smile: { crop: [912, 1064, 1216, 912] },
  mouth_close: { crop: [912, 1064, 1216, 912] },
  mouth_smile: { crop: [912, 1064, 1216, 912] },
  mouth_cat: { crop: [912, 1064, 1216, 912] },
  mouth_pout: { crop: [912, 1064, 1216, 912] },
  mouth_wavy: { crop: [912, 1064, 1216, 912] },
  body_nohands: { crop: [507, 2027, 2027, 1520] },
  hood_empty: { crop: [253, 0, 2533, 3377] },
  cloud_happy: { crop: [2229, 1991, 760, 760] },
};
/* arm_up（抬手臂）构图被模型放大过，自动搜索对不上；已用“只看头部 + 兜帽”的 NCC 手动配准，
   参数 s=1.78906 dx=-120 dy=0 写在 align.json，aligned_arm_up.png 已生成，这里不再重跑 */

const log = (...a) => process.stderr.write(a.join(' ') + '\n');
let REF = null;
function ref() { if (!REF) REF = P.decodePNG(fs.readFileSync(path.join(ROOT, 'assets/xiaohua_ref.png'))); return REF; }

/* 灰度 + 盒式缩小 */
function grayDown(img, x0, y0, w, h, f) {
  const W = Math.floor(w / f), H = Math.floor(h / f), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const X = x0 + x * f + i, Y = y0 + y * f + j;
      if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) continue;
      const q = (Y * img.width + X) * 4; s += 0.3 * img.rgba[q] + 0.59 * img.rgba[q + 1] + 0.11 * img.rgba[q + 2]; n++;
    }
    out[y * W + x] = n ? s / n : 245;
  }
  return { w: W, h: H, d: out };
}
function grad(g) {
  const o = new Float32Array(g.w * g.h);
  for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
    const k = y * g.w + x;
    o[k] = Math.hypot(g.d[k + 1] - g.d[k - 1], g.d[k + g.w] - g.d[k - g.w]);
  }
  return { w: g.w, h: g.h, d: o };
}
function samp(g, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  if (x0 < 0 || y0 < 0 || x0 >= g.w - 1 || y0 >= g.h - 1) return NaN;
  const k = y0 * g.w + x0;
  return (g.d[k] * (1 - fx) + g.d[k + 1] * fx) * (1 - fy) + (g.d[k + g.w] * (1 - fx) + g.d[k + g.w + 1] * fx) * fy;
}
/* NCC：ref 网格上每点 → 生成图坐标 (X - d) / s */
function score(R, G, s, dx, dy, step) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = 2; y < R.h - 2; y += step) for (let x = 2; x < R.w - 2; x += step) {
    const b = samp(G, (x - dx) / s, (y - dy) / s); if (b !== b) continue;
    const a = R.d[y * R.w + x];
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  if (n < 100) return -1;
  const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  return (sab - sa * sb / n) / Math.sqrt(va * vb + 1e-9);
}

function align(name) {
  const J = JOBS[name] || (/^worn_/.test(name) ? { crop: [0, 0, 3040, 5404] } : null), [cx, cy, cw, ch] = J.crop;
  const gen = P.decodePNG(fs.readFileSync(path.join(GEN, name + '.png')));
  const s0 = cw / gen.width;
  let best = { s: s0, dx: 0, dy: 0, sc: -2 };
  /* 三级：f 为原画缩小倍数 */
  const levels = [[16, 0.06, 13, 0.06], [6, 0.012, 9, 0.02], [3, 0.004, 5, 0.006]];
  for (const [f, sr, sn, dr] of levels) {
    const R = grad(grayDown(ref(), cx, cy, cw, ch, f));
    const gf = Math.max(1, Math.round(f / s0));
    const G = grad(grayDown(gen, 0, 0, gen.width, gen.height, gf));
    const sScale = gf / f; // 生成图缩小格 → 原画缩小格 的基准倍数
    const c = { ...best }; let top = { ...best, sc: -2 };
    const dpx = Math.max(1, Math.round(dr * cw / f));
    for (let si = 0; si < sn; si++) {
      const s = c.s * (1 - sr + (2 * sr * si) / (sn - 1));
      for (let oy = -dpx; oy <= dpx; oy++) for (let ox = -dpx; ox <= dpx; ox++) {
        const dx = c.dx / f + ox, dy = c.dy / f + oy;
        const v = score(R, G, s * sScale, dx, dy, f >= 16 ? 1 : 2);
        if (v > top.sc) top = { s, dx: dx * f, dy: dy * f, sc: v };
      }
    }
    best = top;
    log(name, 'f', f, 's', (best.s / s0).toFixed(4), 'd', best.dx.toFixed(1), best.dy.toFixed(1), 'ncc', best.sc.toFixed(3));
  }
  /* 输出对齐后的全分辨率局部图 */
  const out = Buffer.alloc(cw * ch * 4);
  const s = best.s;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const gx = (x + 0.5 - best.dx) / s - 0.5, gy = (y + 0.5 - best.dy) / s - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, k = (y * cw + x) * 4;
    if (x0 < 0 || y0 < 0 || x0 >= gen.width - 1 || y0 >= gen.height - 1) continue;
    for (let c = 0; c < 3; c++) {
      const q = (y0 * gen.width + x0) * 4 + c;
      out[k + c] = (gen.rgba[q] * (1 - fx) + gen.rgba[q + 4] * fx) * (1 - fy) + (gen.rgba[q + gen.width * 4] * (1 - fx) + gen.rgba[q + gen.width * 4 + 4] * fx) * fy;
    }
    out[k + 3] = 255;
  }
  fs.writeFileSync(path.join(GEN, 'aligned_' + name + '.png'), P.encodePNG(cw, ch, out));
  return { crop: J.crop, scale: best.s, scaleRel: best.s / s0, dx: best.dx, dy: best.dy, ncc: best.sc };
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(JOBS);
const jf = path.join(GEN, 'align.json');
const res = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : {};
for (const n of names) { res[n] = align(n); fs.writeFileSync(jf, JSON.stringify(res, null, 1)); }
log('done');

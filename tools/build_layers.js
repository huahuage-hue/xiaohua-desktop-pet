/* 小嬅分层构建 v2（图层定义见 tools/layer_defs.js）
   来源：原画像素（可见处）+ Seedream 补画（兜帽内壁 / 手后的毛衣斗篷 / 闭眼 / 笑眼 / 闭嘴 / 云朵笑脸，tools/align.js 对齐）
        + See-through（形状 + 其余被遮挡处）+ 本地切分
   流程：在网页坐标（1200×2133）判定像素归属 → 网页图集；再按来源把每层重采样到原图 3040×5404 → PSD / PNG
   用法：node tools/build_layers.js [--debug] [--no-hires]
   旧版（42 层）保留在 tools/build_layers_v1.js */
'use strict';
const C = require('./common.js');
const { fs, path, P, ROOT, IW, IH } = C;
const LD = require('./layer_defs.js');
const { lum, isBrown, hoodBox, inCloud, cloudFace, starOf, BLUSH, GROUPS, PARENT } = LD;
const DEBUG = process.argv.includes('--debug'), HIRES = !process.argv.includes('--no-hires');
const N = IW * IH;
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const T0 = Date.now(), tick = (s) => log(((Date.now() - T0) / 1000).toFixed(1) + 's', s);
const PAPER = [245, 241, 230];
const paperDist = (r, g, b) => Math.abs(r - PAPER[0]) + Math.abs(g - PAPER[1]) + Math.abs(b - PAPER[2]);

/* ---------- 读入 ---------- */
const web = C.loadWeb();
const stpsd = P.readPSD(fs.readFileSync(path.join(ROOT, 'psd/raw/seethrough_output.psd')));
const ST = {};
for (const L of stpsd.layers) {
  const S = C.stSampler(L), b = C.stBox(L), a = new Uint8Array(N), col = new Uint8Array(N * 3);
  for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
    const s = S(x, y); if (!s[3]) continue;
    const k = y * IW + x; a[k] = Math.round(s[3] * 255); col[k * 3] = s[0]; col[k * 3 + 1] = s[1]; col[k * 3 + 2] = s[2];
  }
  ST[L.name] = { a, col };
}
const REF = P.decodePNG(fs.readFileSync(path.join(ROOT, 'assets/xiaohua_ref.png')));
const RW = REF.width, RH = REF.height, KX = RW / IW, KY = RH / IH;
const ALIGN = JSON.parse(fs.readFileSync(path.join(ROOT, 'psd/raw/gen/align.json'), 'utf8'));
const GEN = {};
for (const n in ALIGN) GEN[n] = { im: P.decodePNG(fs.readFileSync(path.join(ROOT, 'psd/raw/gen/aligned_' + n + '.png'))), cx: ALIGN[n].crop[0], cy: ALIGN[n].crop[1] };
function genHi(n, X, Y) {
  const g = GEN[n], x = Math.round(X - g.cx), y = Math.round(Y - g.cy);
  if (x < 0 || y < 0 || x >= g.im.width || y >= g.im.height) return null;
  const q = (y * g.im.width + x) * 4; return [g.im.rgba[q], g.im.rgba[q + 1], g.im.rgba[q + 2]];
}
function genWeb(n, x, y) { // 网页像素 ↔ 原图 2.53×2.53 块的均值
  const X = (x + 0.5) * KX - 0.5, Y = (y + 0.5) * KY - 0.5, s = [0, 0, 0]; let c = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = genHi(n, X + i, Y + j); if (v) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; c++; } }
  return c ? s.map((v) => v / c) : null;
}
tick('loaded');

/* ---------- 背景 ---------- */
const anyST = new Uint8Array(N);
for (const k in ST) { const a = ST[k].a; for (let i = 0; i < N; i++) if (a[i] > anyST[i]) anyST[i] = a[i]; }
const bg = new Uint8Array(N);
{
  const q = new Int32Array(N); let h = 0, t = 0;
  const push = (i) => { if (!bg[i] && anyST[i] < 128 && paperDist(web[i * 4], web[i * 4 + 1], web[i * 4 + 2]) < 26) { bg[i] = 1; q[t++] = i; } };
  for (let x = 0; x < IW; x++) { push(x); push((IH - 1) * IW + x); }
  for (let y = 0; y < IH; y++) { push(y * IW); push(y * IW + IW - 1); }
  while (h < t) { const i = q[h++], x = i % IW; if (x > 0) push(i - 1); if (x < IW - 1) push(i + 1); if (i >= IW) push(i - IW); if (i < N - IW) push(i + IW); }
}
function dilate(m, r) {
  let a = m;
  for (let k = 0; k < r; k++) { const b = new Uint8Array(a); for (let i = 0; i < N; i++) if (a[i]) { const x = i % IW; if (x > 0) b[i - 1] = 1; if (x < IW - 1) b[i + 1] = 1; if (i >= IW) b[i - IW] = 1; if (i < N - IW) b[i + IW] = 1; } a = b; }
  return a;
}
/* 兜帽沿：紧挨棕色内衬的那圈白边 */
const hoodBrown = new Uint8Array(N);
for (let i = 0; i < N; i++) { const x = i % IW, y = (i / IW) | 0; if (y < 760 && hoodBox(x, y) && isBrown(web[i * 4], web[i * 4 + 1], web[i * 4 + 2])) hoodBrown[i] = 1; }
const DEFS = LD(dilate(hoodBrown, 12));
/* 本地切分层只在贴近背景的 4px 内去底色，内部（白兜帽、白云朵）保持不透明 */
const bgNear = dilate(bg, 4);
const byEn = Object.fromEntries(DEFS.map((d, i) => [d.en, i]));
const ownable = (d) => d.src !== 'gen' && d.src !== 'genfill' && d.src !== 'genline' && d.src !== 'genarm';
/* 抬手臂遮罩（tools/arm_mask.js，生成图坐标）→ 原图坐标采样 */
const ARM = (() => {
  const f = path.join(ROOT, 'psd/raw/gen/arm_up_mask.png');
  if (!fs.existsSync(f) || !ALIGN.arm_up) return null;
  const M = P.decodePNG(fs.readFileSync(f)), A = ALIGN.arm_up;
  return (X, Y) => { const gx = Math.round((X + 0.5 - A.dx) / A.scale - 0.5), gy = Math.round((Y + 0.5 - A.dy) / A.scale - 0.5); return gx < 0 || gy < 0 || gx >= M.width || gy >= M.height ? 0 : M.rgba[(gy * M.width + gx) * 4] / 255; };
})();

/* ---------- 遮罩 ---------- */
const masks = DEFS.map((d) => {
  if (!ownable(d) || d.src === 'res') return null;
  const S = ST[d.src], m = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (S.a[i] < 128) continue;
    const x = i % IW, y = (i / IW) | 0;
    if (inCloud(x, y) || starOf(x, y) >= 0) continue;
    if (!d.pred || d.pred(x, y, S.col[i * 3], S.col[i * 3 + 1], S.col[i * 3 + 2], i)) m[i] = 1;
  }
  return m;
});
/* 手后面：body_nohands 补画扩展毛衣 / 斗篷前片 */
const handZone = (() => { const m = new Uint8Array(N); for (const n of ['handwear-r', 'handwear-l']) { const a = ST[n].a; for (let i = 0; i < N; i++) if (a[i] >= 64) m[i] = 1; } return dilate(m, 4); })();
const fillCol = {};
DEFS.forEach((d, li) => {
  if (!d.fill) return;
  const G = fillCol[d.fill] || (fillCol[d.fill] = new Float32Array(N * 3).fill(NaN)), m = masks[li];
  for (let i = 0; i < N; i++) {
    if (!handZone[i] || bg[i]) continue;
    const x = i % IW, y = (i / IW) | 0, c = genWeb(d.fill, x, y);
    if (!c || paperDist(c[0], c[1], c[2]) < 22 || !d.pred(x, y, c[0], c[1], c[2], i)) continue;
    m[i] = 1; G[i * 3] = c[0]; G[i * 3 + 1] = c[1]; G[i * 3 + 2] = c[2];
  }
});
const own = DEFS.map((d, i) => (masks[i] && d.dil ? dilate(masks[i], d.dil) : masks[i]));
tick('masks');

/* ---------- 归属 ---------- */
const owner = new Int16Array(N).fill(-1);
for (let li = 0; li < DEFS.length; li++) if (own[li]) { const m = own[li]; for (let i = 0; i < N; i++) if (m[i] && !bg[i]) owner[i] = li; }
for (let i = 0; i < N; i++) {
  if (bg[i] || owner[i] >= 0) continue;
  const x = i % IW, y = (i / IW) | 0;
  for (let li = DEFS.length - 1; li >= 0; li--) if (DEFS[li].src === 'res' && DEFS[li].pred(x, y, web[i * 4], web[i * 4 + 1], web[i * 4 + 2], i)) { owner[i] = li; break; }
}
{ // 本地切分里的零碎噪点 → 背景
  const seen = new Uint8Array(N), q = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (seen[s] || owner[s] < 0 || DEFS[owner[s]].src !== 'res') continue;
    const li = owner[s]; let h = 0, t = 0, dsum = 0; q[t++] = s; seen[s] = 1;
    while (h < t) {
      const i = q[h++], x = i % IW; dsum += paperDist(web[i * 4], web[i * 4 + 1], web[i * 4 + 2]);
      for (const j of [i - 1, i + 1, i - IW, i + IW]) {
        if (j < 0 || j >= N || seen[j] || owner[j] !== li || (j === i - 1 && x === 0) || (j === i + 1 && x === IW - 1)) continue;
        seen[j] = 1; q[t++] = j;
      }
    }
    if (t < 600 && dsum / t < 70) for (let k = 0; k < t; k++) { owner[q[k]] = -1; bg[q[k]] = 1; }
  }
}
tick('ownership');

/* ---------- 每层像素（网页分辨率）+ 来源标记 flag：0 计算 1 原画 2 原画去底色 3 生成图 4 生成图抽线 ---------- */
const layers = DEFS.map((d) => ({ ...d }));
function finish(l, rgba, flag) {
  let x0 = IW, y0 = IH, x1 = -1, y1 = -1;
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) if (rgba[(y * IW + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { l.empty = true; return; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = Buffer.alloc(w * h * 4), fl = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    Buffer.from(rgba.buffer).copy(out, y * w * 4, ((y + y0) * IW + x0) * 4, ((y + y0) * IW + x1 + 1) * 4);
    fl.set(flag.subarray((y + y0) * IW + x0, (y + y0) * IW + x1 + 1), y * w);
  }
  Object.assign(l, { left: x0, top: y0, width: w, height: h, crop: out, flag: fl });
}
function fillHoles(rgba, flag, hole) {
  let todo = []; for (let i = 0; i < N; i++) if (hole[i] && rgba[i * 4 + 3] < 250) todo.push(i);
  for (let it = 0; it < 60 && todo.length; it++) {
    const next = [], set = [];
    for (const i of todo) {
      let r = 0, g = 0, b = 0, n = 0; const x = i % IW;
      for (const j of [i - 1, i + 1, i - IW, i + IW, i - IW - 1, i - IW + 1, i + IW - 1, i + IW + 1]) {
        if (j < 0 || j >= N || Math.abs((j % IW) - x) > 1 || rgba[j * 4 + 3] < 250) continue;
        r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
      }
      if (n) set.push([i, r / n, g / n, b / n]); else next.push(i);
    }
    for (const [i, r, g, b] of set) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255; flag[i] = 0; hole[i] = 0; }
    todo = next;
  }
}
for (let li = 0; li < DEFS.length; li++) {
  const d = DEFS[li], l = layers[li];
  if (d.src === 'gen' || d.src === 'genline') continue;
  const rgba = new Uint8ClampedArray(N * 4), flag = new Uint8Array(N);
  if (d.src === 'genarm') {
    if (ARM) for (let y = 0; y < 900; y++) for (let x = 0; x < 600; x++) {
      const X = (x + 0.5) * KX - 0.5, Y = (y + 0.5) * KY - 0.5;
      let a = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) a += ARM(X + i, Y + j); a /= 9;
      if (a < 0.02) continue;
      const c = genWeb(d.gen, x, y); if (!c) continue;
      const k = (y * IW + x) * 4; rgba[k] = c[0]; rgba[k + 1] = c[1]; rgba[k + 2] = c[2]; rgba[k + 3] = Math.round(a * 255); flag[k / 4] = 3;
    }
    finish(l, rgba, flag); continue;
  }
  if (d.src === 'genfill') {
    for (let i = 0; i < N; i++) {
      if (bg[i]) continue; const x = i % IW, y = (i / IW) | 0;
      if (!d.pred(x, y)) continue;
      const c = genWeb(d.gen, x, y); if (!c || paperDist(c[0], c[1], c[2]) < 26) continue;
      rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255; flag[i] = 3;
    }
    finish(l, rgba, flag); continue;
  }
  const corr = [0, 0, 0];
  if (masks[li]) {
    const S = ST[d.src]; let n = 0;
    for (let i = 0; i < N; i++) if (owner[i] === li && masks[li][i] && S.a[i] > 230) { for (let c = 0; c < 3; c++) corr[c] += web[i * 4 + c] - S.col[i * 3 + c]; n++; }
    if (n > 50) for (let c = 0; c < 3; c++) corr[c] /= n; else corr.fill(0);
  }
  l.corr = corr.map(Math.round);
  const G = d.fill ? fillCol[d.fill] : null;
  let vis = 0, hid = 0;
  for (let i = 0; i < N; i++) {
    if (bg[i]) continue;
    if (owner[i] === li) {
      if (d.src === 'res' && bgNear[i]) {
        const A = Math.round(255 * Math.min(1, Math.max(0, (paperDist(web[i * 4], web[i * 4 + 1], web[i * 4 + 2]) - 10) / 30)));
        if (!A) continue;
        const a = A / 255;
        for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (web[i * 4 + c] - PAPER[c] * (1 - a)) / a;
        rgba[i * 4 + 3] = A; flag[i] = 2;
      } else { rgba[i * 4] = web[i * 4]; rgba[i * 4 + 1] = web[i * 4 + 1]; rgba[i * 4 + 2] = web[i * 4 + 2]; rgba[i * 4 + 3] = 255; flag[i] = 1; }
      vis++;
    } else if (masks[li] && masks[li][i] && owner[i] > li) {
      if (G && G[i * 3] === G[i * 3]) { rgba[i * 4] = G[i * 3]; rgba[i * 4 + 1] = G[i * 3 + 1]; rgba[i * 4 + 2] = G[i * 3 + 2]; rgba[i * 4 + 3] = 255; flag[i] = 3; }
      else { const S = ST[d.src]; for (let c = 0; c < 3; c++) rgba[i * 4 + c] = S.col[i * 3 + c] + corr[c]; rgba[i * 4 + 3] = S.a[i]; }
      hid++;
    }
  }
  if (masks[li]) { // 补画区柔边
    const S = ST[d.src];
    for (let i = 0; i < N; i++) {
      if (rgba[i * 4 + 3] || bg[i] || !S.a[i] || S.a[i] >= 128 || owner[i] <= li) continue;
      const x = i % IW, y = (i / IW) | 0;
      if (d.pred && !d.pred(x, y, S.col[i * 3], S.col[i * 3 + 1], S.col[i * 3 + 2], i)) continue;
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = S.col[i * 3 + c] + corr[c];
      rgba[i * 4 + 3] = S.a[i];
    }
  }
  /* 接缝：同一部件被切成相邻两层时，交界处两边各只有半透明边，叠起来会露出底色细线。
     把每层向外扩 2px（用原画像素），扩出的部分正好被相邻层盖住，静止时看不出 */
  if (!/^(E[LR]|DM)$/.test(d.group)) {
    for (let it = 0; it < 2; it++) {
      const add = [];
      for (let i = 0; i < N; i++) {
        if (bg[i] || rgba[i * 4 + 3] >= 250 || owner[i] <= li || DEFS[owner[i]].group !== d.group) continue;
        const x = i % IW;
        if ((x > 0 && rgba[(i - 1) * 4 + 3] >= 250) || (x < IW - 1 && rgba[(i + 1) * 4 + 3] >= 250) || (i >= IW && rgba[(i - IW) * 4 + 3] >= 250) || (i < N - IW && rgba[(i + IW) * 4 + 3] >= 250)) add.push(i);
      }
      for (const i of add) { rgba[i * 4] = web[i * 4]; rgba[i * 4 + 1] = web[i * 4 + 1]; rgba[i * 4 + 2] = web[i * 4 + 2]; rgba[i * 4 + 3] = 255; flag[i] = 1; }
    }
  }
  if (d.holes) {
    const hole = new Uint8Array(N);
    for (const en of d.holes) { const hi = byEn[en]; for (let i = 0; i < N; i++) if (owner[i] === hi) hole[i] = 1; }
    fillHoles(rgba, flag, dilate(hole, 1));
  }
  l.vis = vis; l.hid = hid;
  finish(l, rgba, flag);
}
tick('compose');

/* ---------- 生成图抽线：闭眼 / 笑眼 / 闭嘴 / 云朵笑脸 ---------- */
const lineA = (c) => Math.max(0, Math.min(1, (205 - lum(c[0], c[1], c[2])) / 85));
const isPink = (c) => c[0] - c[1] > 22 && lum(c[0], c[1], c[2]) > 140;
for (const l of layers) {
  if (l.src !== 'genline') continue;
  const [bx0, by0, bx1, by1] = l.box, w = bx1 - bx0, h = by1 - by0;
  const A = new Float32Array(w * h), Cc = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (l.cloud && !cloudFace(x + bx0, y + by0)) continue;
    const c = genWeb(l.gen, x + bx0, y + by0); if (!c) continue;
    A[y * w + x] = isPink(c) ? 0 : lineA(c); Cc.set(c, (y * w + x) * 3);
  }
  const lab = new Int32Array(w * h).fill(-1), keep = new Uint8Array(w * h);
  for (let s = 0, nl = 0; s < w * h; s++, nl++) {
    if (lab[s] >= 0 || A[s] < 0.3) continue;
    const q = [s]; lab[s] = nl; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % w, y = (i / w) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X; if (lab[j] < 0 && A[j] >= 0.3) { lab[j] = nl; q.push(j); }
      }
    }
    const okc = x1 - x0 + 1 >= l.minW && (l.cloud || y1 - y0 + 1 <= 60);
    if (DEBUG && q.length > 20) log(l.en, 'blob', x0 + bx0, y0 + by0, x1 - x0 + 1, y1 - y0 + 1, q.length, okc);
    if (okc) for (const i of q) keep[i] = 1;
  }
  let near = keep;
  for (let it = 0; it < 2; it++) { const b = new Uint8Array(near); for (let i = 0; i < w * h; i++) if (near[i]) { const x = i % w; if (x > 0) b[i - 1] = 1; if (x < w - 1) b[i + 1] = 1; if (i >= w) b[i - w] = 1; if (i < w * h - w) b[i + w] = 1; } near = b; }
  l.lineMask = { bx0, by0, w, h, near };
  const rgba = new Uint8ClampedArray(N * 4), flag = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!near[k] || A[k] <= 0.02) continue;
    const i = (y + by0) * IW + x + bx0;
    rgba[i * 4] = Cc[k * 3]; rgba[i * 4 + 1] = Cc[k * 3 + 1]; rgba[i * 4 + 2] = Cc[k * 3 + 2]; rgba[i * 4 + 3] = A[k] * 255; flag[i] = 4;
  }
  finish(l, rgba, flag);
}
{ // 腮红加深（程序画）
  const l = layers[byEn.Cheek_Blush], rgba = new Uint8ClampedArray(N * 4);
  const over = (x, y, col, a) => {
    if (x < 0 || y < 0 || x >= IW || y >= IH || a <= 0) return;
    const i = (y * IW + x) * 4, A = rgba[i + 3] / 255, na = a + A * (1 - a);
    for (let c = 0; c < 3; c++) rgba[i + c] = (col[c] * a + rgba[i + c] * A * (1 - a)) / na;
    rgba[i + 3] = na * 255;
  };
  for (const B of BLUSH) for (let y = B.y - B.r; y <= B.y + B.r; y++) for (let x = Math.round(B.x - B.r * 1.25); x <= B.x + B.r * 1.25; x++) {
    const d = Math.hypot((x - B.x) / 1.25, y - B.y) / B.r; if (d >= 1) continue;
    over(x, y, [248, 124, 130], d < 0.6 ? 0.42 - d * 0.33 : 0.22 * (1 - d) / 0.4);
  }
  for (const B of BLUSH) for (let k = -1; k <= 1; k++) {
    const ax = B.x + k * 16 - 6, ay = B.y + 10, bx = B.x + k * 16 + 6, by = B.y - 10;
    for (let y = by - 3; y <= ay + 3; y++) for (let x = ax - 3; x <= bx + 3; x++) {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      over(x, y, [224, 96, 106], Math.max(0, Math.min(1, 2 - Math.hypot(x - ax - t * dx, y - ay - t * dy))) * 0.75);
    }
  }
  finish(l, rgba, new Uint8Array(N));
}
const used = layers.filter((l) => !l.empty);
let unowned = 0; for (let i = 0; i < N; i++) if (!bg[i] && owner[i] < 0) unowned++;
log('layers', used.length, '/', layers.length, '| empty:', layers.filter((l) => l.empty).map((l) => l.en).join(' ') || '-', '| unowned', unowned);
tick('lines');

/* ---------- 密封被误判为底色的原画空洞（白缎带 / 桦枝等纸色区域）
   底色泛洪会把与纸色接近的白缎带连成背景，留下缺口；
   合成后找出四周都有不透明像素的封闭小洞，用原画颜色补进包围它最多的一层 */
{
  const A = new Uint8Array(N);
  for (const l of used) for (let y = 0; y < l.height; y++) {
    const row = (l.top + y) * IW + l.left;
    for (let x = 0; x < l.width; x++) { const a = l.crop[(y * l.width + x) * 4 + 3]; if (a > A[row + x]) A[row + x] = a; }
  }
  const seen = new Uint8Array(N), q = new Int32Array(N);
  let h = 0, t = 0;
  const push = (i) => { if (A[i] < 8 && !seen[i]) { seen[i] = 1; q[t++] = i; } };
  for (let x = 0; x < IW; x++) { push(x); push((IH - 1) * IW + x); }
  for (let y = 0; y < IH; y++) { push(y * IW); push(y * IW + IW - 1); }
  while (h < t) { const i = q[h++], x = i % IW; if (x > 0) push(i - 1); if (x < IW - 1) push(i + 1); if (i >= IW) push(i - IW); if (i < N - IW) push(i + IW); }
  let fixed = 0;
  for (let s = 0; s < N; s++) {
    if (A[s] >= 8 || seen[s]) continue;
    const comp = []; let t2 = 0; q[t2++] = s; seen[s] = 1;
    let x0 = IW, x1 = -1, y0 = IH, y1 = -1;
    while (t2) {
      const i = q[--t2], x = i % IW, y = (i / IW) | 0; comp.push(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - IW, i + IW]) if (j >= 0 && j < N && A[j] < 8 && !seen[j]) { seen[j] = 1; q[t2++] = j; }
    }
    if (comp.length < 5 || comp.length > 5000) continue;
    /* 外圈 2px 内，各层不透明像素数 → 选包围最多的一层（同票取上层） */
    const vote = new Map(); let ring = 0;
    for (const i of comp) {
      const x = i % IW, y = (i / IW) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy; if (X < x0 - 2 || X > x1 + 2 || Y < y0 - 2 || Y > y1 + 2) continue;
        const k = Y * IW + X; if (A[k] < 8) continue;
        ring++;
        for (let li = 0; li < used.length; li++) {
          const l = used[li];
          if (X < l.left || Y < l.top || X >= l.left + l.width || Y >= l.top + l.height) continue;
          if (l.crop[((Y - l.top) * l.width + (X - l.left)) * 4 + 3] >= 250) vote.set(li, (vote.get(li) || 0) + 1);
        }
      }
    }
    let best = -1, bv = 0;
    for (const [li, v] of vote) if (v >= bv) { bv = v; best = li; }
    if (best < 0 || bv < 6 || bv < ring * 0.2) continue;
    const l = used[best];
    for (const i of comp) {
      const x = i % IW, y = (i / IW) | 0;
      const k = ((y - l.top) * l.width + (x - l.left)) * 4;
      l.crop[k] = web[i * 4]; l.crop[k + 1] = web[i * 4 + 1]; l.crop[k + 2] = web[i * 4 + 2]; l.crop[k + 3] = 255;
      l.flag[k >> 2] = 1;
    }
    fixed++;
  }
  log('sealed holes', fixed);
  tick('seal');
}

/* ---------- 呆毛根部的兜帽补洞
   分层时呆毛画在兜帽上面，兜帽前片被照着呆毛形状挖掉了；呆毛一动就露出背景。
   只在呆毛附近找“四个方向 40px 内都有不透明像素”的透明点，用原画颜色补进兜帽前片 */
{
  const l = used.find((u) => u.en === 'Hood_Front');
  if (l) {
    const RX0 = 480, RY0 = 60, RX1 = 700, RY1 = 230;
    const x0 = Math.max(0, RX0 - l.left), x1 = Math.min(l.width, RX1 - l.left);
    const y0 = Math.max(0, RY0 - l.top), y1 = Math.min(l.height, RY1 - l.top);
    const A = (x, y) => l.crop[(y * l.width + x) * 4 + 3];
    const hole = new Uint8Array(l.width * l.height);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (A(x, y) > 230) continue;
      let u = 0, dn = 0, le = 0, ri = 0;
      for (let k = 1; k <= 40; k++) {
        if (!u && y - k >= 0 && A(x, y - k) > 230) u = 1;
        if (!dn && y + k < l.height && A(x, y + k) > 230) dn = 1;
        if (!le && x - k >= 0 && A(x - k, y) > 230) le = 1;
        if (!ri && x + k < l.width && A(x + k, y) > 230) ri = 1;
      }
      if (u && dn && le && ri) hole[y * l.width + x] = 1;
    }
    let n = 0;
    for (let it = 0; it < 60; it++) {
      const fill = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * l.width + x; if (!hole[i]) continue;
        let c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < l.width && yy < l.height && A(xx, yy) > 230) c++;
        }
        if (c >= 2) fill.push(i);
      }
      if (!fill.length) break;
      for (const i of fill) {
        const x = i % l.width, y = (i / l.width) | 0, q = ((y + l.top) * IW + x + l.left) * 4;
        l.crop[i * 4] = web[q]; l.crop[i * 4 + 1] = web[q + 1]; l.crop[i * 4 + 2] = web[q + 2]; l.crop[i * 4 + 3] = 255;
        l.flag[i] = 1; hole[i] = 0; n++;
      }
    }
    log('ahoge seal', n);
    tick('ahoge');
  }
}

/* ---------- 呆毛下方的兜帽沿外扩
   呆毛压在兜帽沿外侧，摆动时两者之间会裂开一条缝、露出背景（洋红）。
   把兜帽沿向呆毛覆盖的区域外扩 26px（只在呆毛底下、静止时不可见），
   这样呆毛甩开时看到的是奶油色帽沿而不是背景。 */
{
  const rim = used.find((u) => u.en === 'Hood_Rim');
  const ah = used.find((u) => u.en === 'Ahoge');
  if (rim && ah) {
    const RX0 = 460, RY0 = 90, RX1 = 650, RY1 = 240, MAXD = 20;
    const inROI = (X, Y) => X >= RX0 && X < RX1 && Y >= RY0 && Y < RY1;
    const aA = (X, Y) => {
      const x = X - ah.left, y = Y - ah.top;
      return x >= 0 && y >= 0 && x < ah.width && y < ah.height ? ah.crop[(y * ah.width + x) * 4 + 3] : 0;
    };
    const A = (x, y) => rim.crop[(y * rim.width + x) * 4 + 3];
    const dist = new Int16Array(rim.width * rim.height).fill(-1);
    /* 只补“呆毛底下”的透明点：先入队紧贴帽沿的一圈，之后每轮只从已填实的像素往外扩，
       保证每个入队点都有已填邻居可取色（旧版整圈同时入队会让深处点取不到色而漏补） */
    const queue = [];
    for (let y = 0; y < rim.height; y++) for (let x = 0; x < rim.width; x++) {
      if (A(x, y) > 230) continue;
      const X = x + rim.left, Y = y + rim.top;
      if (!inROI(X, Y) || aA(X, Y) < 128) continue;
      let near = 0;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < rim.width && yy < rim.height && A(xx, yy) > 230) { near = 1; break; }
      }
      if (near) { dist[y * rim.width + x] = 1; queue.push(y * rim.width + x); }
    }
    let head = 0, n = 0;
    while (head < queue.length) {
      const i = queue[head++], x = i % rim.width, y = (i / rim.width) | 0, d = dist[i];
      let sr = 0, sg = 0, sb = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= rim.width || yy >= rim.height) continue;
        const k = (yy * rim.width + xx) * 4;
        if (rim.crop[k + 3] > 230) { sr += rim.crop[k]; sg += rim.crop[k + 1]; sb += rim.crop[k + 2]; c++; }
      }
      if (!c) continue;
      const k = (y * rim.width + x) * 4;
      rim.crop[k] = sr / c; rim.crop[k + 1] = sg / c; rim.crop[k + 2] = sb / c; rim.crop[k + 3] = 255;
      rim.flag[y * rim.width + x] = 1; n++;
      if (d >= MAXD) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= rim.width || yy >= rim.height) continue;
        const j = yy * rim.width + xx;
        if (dist[j] !== -1 || A(xx, yy) > 230) continue;
        if (!inROI(xx + rim.left, yy + rim.top) || aA(xx + rim.left, yy + rim.top) < 128) continue;
        dist[j] = d + 1; queue.push(j);
      }
    }
    log('rim under-ahoge', n, 'queued', queue.length);
    tick('rim');
  }
}

if (DEBUG) {
  const dbg = Buffer.alloc(N * 4);
  const hue = (k) => { const h = (k * 0.618034) % 1; const f = (n) => { const kk = (n + h * 6) % 6; return 255 * (1 - Math.max(0, Math.min(kk, 4 - kk, 1)) * 0.75); }; return [f(5), f(3), f(1)]; };
  for (let i = 0; i < N; i++) {
    const c = bg[i] ? [255, 255, 255] : owner[i] < 0 ? [0, 0, 0] : hue(owner[i]), g = lum(web[i * 4], web[i * 4 + 1], web[i * 4 + 2]) / 255;
    for (let k = 0; k < 3; k++) dbg[i * 4 + k] = c[k] * (0.45 + 0.55 * g); dbg[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(process.env.TEMP, 'opencode', 'owner.png'), P.encodePNG(IW, IH, dbg, 3));
}

/* ---------- 网页图集：1200 画布坐标，shelf 装箱到 2048² 页（单页 ≤ 2048，兼容弱 GPU） ---------- */
const PAGE = 2048, PADX = 2;
const pages = [];
for (const l of [...used].sort((a, b) => b.height - a.height)) {
  let placed = false;
  for (let p = 0; p < pages.length && !placed; p++) {
    const pg = pages[p];
    for (const sh of pg.shelves) if (l.height + PADX <= sh.h && sh.x + l.width + PADX <= PAGE) { l.atlas = { page: p, x: sh.x, y: sh.y }; sh.x += l.width + PADX; placed = true; break; }
    if (!placed && pg.y + l.height + PADX <= PAGE) { pg.shelves.push({ y: pg.y, h: l.height + PADX, x: l.width + PADX }); l.atlas = { page: p, x: 0, y: pg.y }; pg.y += l.height + PADX; placed = true; }
  }
  if (!placed) { pages.push({ shelves: [{ y: 0, h: l.height + PADX, x: l.width + PADX }], y: l.height + PADX }); l.atlas = { page: pages.length - 1, x: 0, y: 0 }; }
}
const pageBufs = pages.map((pg) => { let hh = 256; while (hh < Math.min(PAGE, pg.y)) hh <<= 1; return { h: hh, buf: Buffer.alloc(PAGE * hh * 4) }; });
for (const l of used) { const pb = pageBufs[l.atlas.page]; for (let y = 0; y < l.height; y++) l.crop.copy(pb.buf, ((l.atlas.y + y) * PAGE + l.atlas.x) * 4, y * l.width * 4, (y + 1) * l.width * 4); }
const js = [
  '/* 由 tools/build_layers.js 生成：小嬅分层图集（原画 + Seedream 补画 + See-through + 本地切分）。请勿手改 */',
  'window.XH_LAYERS = ' + JSON.stringify({
    canvas: { width: IW, height: IH }, psd: { width: RW, height: RH },
    pages: pageBufs.map((pb) => ({ w: PAGE, h: pb.h })),
    layers: used.map((l) => ({ id: l.en, name: `${l.cn} | ${l.en}`, group: GROUPS[l.group], x: l.left, y: l.top, w: l.width, h: l.height, page: l.atlas.page, u: l.atlas.x, v: l.atlas.y, hidden: !!l.hidden, prop: !!l.prop })),
  }) + ';',
  'window.XH_ATLAS = [' + pageBufs.map((pb) => '"data:image/png;base64,' + P.encodePNG(PAGE, pb.h, pb.buf).toString('base64') + '"').join(',\n') + '];',
].join('\n');
fs.writeFileSync(path.join(ROOT, 'assets', 'xiaohua_layers.js'), js);
log('atlas pages', pageBufs.map((p) => PAGE + 'x' + p.h).join(', '), 'js MB', (js.length / 1e6).toFixed(2));
tick('web atlas');
if (!HIRES) process.exit(0);

/* ---------- 高清：每层重采样到原图分辨率 ----------
   alpha：网页 alpha 双线性放大；颜色：原画可见处取原图像素，生成图处取生成图原像素，其余放大插值 */
function hiLayer(l) {
  const X0 = Math.max(0, Math.floor(l.left * KX) - 1), Y0 = Math.max(0, Math.floor(l.top * KY) - 1);
  const X1 = Math.min(RW, Math.ceil((l.left + l.width) * KX) + 1), Y1 = Math.min(RH, Math.ceil((l.top + l.height) * KY) + 1);
  const w = X1 - X0, h = Y1 - Y0, out = Buffer.alloc(w * h * 4), lw = l.width, lh = l.height, cr = l.crop, fl = l.flag;
  const at = (x, y) => (Math.min(lh - 1, Math.max(0, y)) * lw + Math.min(lw - 1, Math.max(0, x)));
  for (let y = 0; y < h; y++) {
    const fy = (Y0 + y + 0.5) / KY - 0.5 - l.top, iy = Math.floor(fy), ty = fy - iy;
    for (let x = 0; x < w; x++) {
      const fx = (X0 + x + 0.5) / KX - 0.5 - l.left, ix = Math.floor(fx), tx = fx - ix;
      const k00 = at(ix, iy), k10 = at(ix + 1, iy), k01 = at(ix, iy + 1), k11 = at(ix + 1, iy + 1);
      const inb = (xx, yy) => xx >= 0 && yy >= 0 && xx < lw && yy < lh;
      const a00 = inb(ix, iy) ? cr[k00 * 4 + 3] : 0, a10 = inb(ix + 1, iy) ? cr[k10 * 4 + 3] : 0, a01 = inb(ix, iy + 1) ? cr[k01 * 4 + 3] : 0, a11 = inb(ix + 1, iy + 1) ? cr[k11 * 4 + 3] : 0;
      let A = (a00 * (1 - tx) + a10 * tx) * (1 - ty) + (a01 * (1 - tx) + a11 * tx) * ty;
      if (A < 1) continue;
      const nk = at(Math.round(fx), Math.round(fy)), f = inb(Math.round(fx), Math.round(fy)) ? fl[nk] : 0;
      const X = X0 + x, Y = Y0 + y, o = (y * w + x) * 4, q = (Y * RW + X) * 4;
      let col = null;
      if (f === 1) col = [REF.rgba[q], REF.rgba[q + 1], REF.rgba[q + 2]];
      else if (f === 2) {
        const pd = paperDist(REF.rgba[q], REF.rgba[q + 1], REF.rgba[q + 2]);
        const a = Math.min(1, Math.max(0, (pd - 10) / 30)); A = Math.min(A, a * 255 + 0.5);
        if (a > 0.02) col = [0, 1, 2].map((c) => (REF.rgba[q + c] - PAPER[c] * (1 - a)) / a); else continue;
      } else if (f === 3 || f === 4) {
        col = genHi(l.gen || l.fill, X, Y);
        if (col && f === 4) A = Math.min(255, Math.max(0, lineA(col) * 255)) * Math.min(1, A / 40);
      }
      if (!col) { // 放大插值（预乘）
        let r = 0, g = 0, b = 0, s = 0;
        for (const [kk, ww] of [[k00, (1 - tx) * (1 - ty) * a00], [k10, tx * (1 - ty) * a10], [k01, (1 - tx) * ty * a01], [k11, tx * ty * a11]]) { r += cr[kk * 4] * ww; g += cr[kk * 4 + 1] * ww; b += cr[kk * 4 + 2] * ww; s += ww; }
        col = s ? [r / s, g / s, b / s] : [0, 0, 0];
      }
      out[o] = Math.max(0, Math.min(255, col[0])); out[o + 1] = Math.max(0, Math.min(255, col[1])); out[o + 2] = Math.max(0, Math.min(255, col[2])); out[o + 3] = Math.max(0, Math.min(255, A));
    }
  }
  return { left: X0, top: Y0, width: w, height: h, rgba: out };
}
const OUT = path.join(ROOT, 'psd'), LDIR = path.join(OUT, 'layers');
fs.mkdirSync(LDIR, { recursive: true });
for (const f of fs.readdirSync(LDIR)) fs.unlinkSync(path.join(LDIR, f));
const comp = Buffer.alloc(RW * RH * 4);
for (let i = 0; i < RW * RH; i++) { comp[i * 4] = PAPER[0]; comp[i * 4 + 1] = PAPER[1]; comp[i * 4 + 2] = PAPER[2]; comp[i * 4 + 3] = 255; }
const root = { children: [] }, gnode = {}, meta = [];
used.forEach((l, i) => {
  const H = hiLayer(l);
  const file = `${String(i + 1).padStart(2, '0')}_${l.en}.png`;
  fs.writeFileSync(path.join(LDIR, file), P.encodePNG(H.width, H.height, H.rgba, 6));
  meta.push({ order: i + 1, id: l.en, name: `${l.cn} | ${l.en}`, group: GROUPS[l.group], file, src: l.src, gen: l.gen || l.fill || null, left: H.left, top: H.top, width: H.width, height: H.height, hidden: !!l.hidden, prop: !!l.prop, visiblePx: l.vis || 0, inpaintPx: l.hid || 0 });
  if (!gnode[l.group]) {
    const node = { name: GROUPS[l.group], group: true, children: [] }; gnode[l.group] = node;
    const p = PARENT[l.group];
    if (p) { if (!gnode[p]) { gnode[p] = { name: GROUPS[p], group: true, children: [] }; root.children.push(gnode[p]); } gnode[p].children.push(node); } else root.children.push(node);
  }
  gnode[l.group].children.push({ name: `${l.cn} | ${l.en}`, ...H, hidden: !!l.hidden });
  if (!l.hidden) for (let y = 0; y < H.height; y++) for (let x = 0; x < H.width; x++) {
    const q = (y * H.width + x) * 4, a = H.rgba[q + 3] / 255; if (!a) continue;
    const k = ((y + H.top) * RW + x + H.left) * 4;
    for (let c = 0; c < 3; c++) comp[k + c] = comp[k + c] * (1 - a) + H.rgba[q + c] * a;
  }
  if (i % 10 === 9) tick('hires ' + (i + 1) + '/' + used.length);
});
fs.writeFileSync(path.join(OUT, 'layers.json'), JSON.stringify({ canvas: { width: RW, height: RH }, webCanvas: { width: IW, height: IH }, layers: meta }, null, 1));
const paper = Buffer.alloc(RW * RH * 4); for (let i = 0; i < RW * RH; i++) { paper[i * 4] = PAPER[0]; paper[i * 4 + 1] = PAPER[1]; paper[i * 4 + 2] = PAPER[2]; paper[i * 4 + 3] = 255; }
root.children.unshift({ name: '底色（可删） | Paper', left: 0, top: 0, width: RW, height: RH, rgba: paper });
fs.writeFileSync(path.join(OUT, 'xiaohua_layers.psd'), P.writePSD(RW, RH, root, comp));
tick('psd');
const cw = 1200, chh = 2133, small = Buffer.alloc(cw * chh * 4); let err = 0;
for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
  const q = (Math.floor((y + 0.5) * KY) * RW + Math.floor((x + 0.5) * KX)) * 4, k = (y * cw + x) * 4;
  comp.copy(small, k, q, q + 4);
  for (let c = 0; c < 3; c++) err += Math.abs(comp[q + c] - REF.rgba[q + c]);
}
fs.writeFileSync(path.join(OUT, 'composite_check.png'), P.encodePNG(RW, RH, comp, 6));
log('composite vs ref mean abs err', (err / cw / chh / 3).toFixed(2));
tick('done');

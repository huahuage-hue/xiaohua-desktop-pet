/* 小嬅分层构建：See-through 图层（形状 + 被遮挡处补画） + 原画像素（可见处） + 本地切分（See-through 缺失的部件）
   输出：psd/layers/*.png、psd/layers.json、psd/xiaohua_layers.psd、assets/xiaohua_layers.js（网页用图集）
   用法：node tools/build_layers.js [--debug] */
'use strict';
const C = require('./common.js');
const { fs, path, P, ROOT, IW, IH } = C;
const DEBUG = process.argv.includes('--debug');
const N = IW * IH;

/* ---------- 网页预览里用到的几何常量（与 assets/app-core.js 一致） ---------- */
const EYES = {
  L: [[664, 570, 582, 594], [672, 556, 569, 618], [680, 549, 563, 632], [688, 544, 559, 642], [696, 541, 557, 648], [704, 540, 557, 651], [712, 540, 557, 652], [720, 540, 558, 650], [728, 542, 560, 647], [736, 545, 563, 642], [744, 548, 566, 635], [752, 552, 570, 628], [760, 557, 575, 621], [768, 564, 582, 614], [776, 572, 590, 608], [784, 584, 599, 606]],
  R: [[438, 581, 597, 606], [444, 576, 591, 618], [452, 570, 584, 632], [460, 566, 579, 644], [468, 564, 577, 653], [476, 563, 576, 659], [484, 563, 576, 663], [492, 563, 576, 664], [500, 564, 577, 662], [508, 567, 579, 658], [516, 571, 583, 650], [524, 576, 588, 636], [530, 580, 592, 620], [536, 586, 596, 604]],
};
function eyeProfile(pts, x) {
  if (x <= pts[0][0]) return pts[0];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1];
  let k = 0; while (pts[k + 1][0] < x) k++;
  const a = pts[k], b = pts[k + 1], t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}
const MOUTH = { cx: 600, top: 689 };
const BLUSH = [{ x: 484, y: 695, r: 58 }, { x: 715, y: 672, r: 62 }];
const CLOUD = { cx: 1031, cy: 936, r: 122, minX: 914 };
const STARS = [[158, 952, 42], [1110, 778, 22], [1058, 1134, 28], [114, 1166, 22], [206, 1042, 14], [274, 1684, 18], [888, 1694, 12], [944, 1738, 18]];

/* ---------- 读入 ---------- */
const web = C.loadWeb();
const psd = P.readPSD(fs.readFileSync(path.join(ROOT, 'psd/raw/seethrough_output.psd')));
const ST = {};
for (const L of psd.layers) {
  const S = C.stSampler(L), b = C.stBox(L);
  const a = new Uint8Array(N), col = new Uint8Array(N * 3);
  for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
    const s = S(x, y); if (!s[3]) continue;
    const k = y * IW + x; a[k] = Math.round(s[3] * 255);
    col[k * 3] = s[0]; col[k * 3 + 1] = s[1]; col[k * 3 + 2] = s[2];
  }
  ST[L.name] = { a, col };
}

/* ---------- 背景（与画布边缘连通的底色区域） ---------- */
const PAPER = [245, 241, 230];
const anyST = new Uint8Array(N);
for (const k in ST) { const a = ST[k].a; for (let i = 0; i < N; i++) if (a[i] > anyST[i]) anyST[i] = a[i]; }
const paperLike = (i) => {
  const d = Math.abs(web[i * 4] - PAPER[0]) + Math.abs(web[i * 4 + 1] - PAPER[1]) + Math.abs(web[i * 4 + 2] - PAPER[2]);
  return d < 26;
};
const bg = new Uint8Array(N);
{
  const q = new Int32Array(N); let h = 0, t = 0;
  const push = (i) => { if (!bg[i] && anyST[i] < 128 && paperLike(i)) { bg[i] = 1; q[t++] = i; } };
  for (let x = 0; x < IW; x++) { push(x); push((IH - 1) * IW + x); }
  for (let y = 0; y < IH; y++) { push(y * IW); push(y * IW + IW - 1); }
  while (h < t) {
    const i = q[h++], x = i % IW, y = (i / IW) | 0;
    if (x > 0) push(i - 1); if (x < IW - 1) push(i + 1); if (y > 0) push(i - IW); if (y < IH - 1) push(i + IW);
  }
}

/* ---------- 图层定义（自下而上） ---------- */
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
function isBrown(r, g, b) { // 斗篷暖棕内衬
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return r >= g && g >= b && mx - mn > 45 && lum(r, g, b) < 190;
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
const starOf = (x, y) => STARS.findIndex(([cx, cy, r]) => inCircle(x, y, cx, cy, r * 1.15 + 8));
const inCloud = (x, y) => x > CLOUD.minX - 6 && inCircle(x, y, CLOUD.cx, CLOUD.cy, CLOUD.r + 18);
const lashLow = (key) => (x, y) => { const p = eyeProfile(EYES[key], x); return x > EYES[key][0][0] + 4 && x < EYES[key][EYES[key].length - 1][0] - 4 && y > (p[2] + p[3]) / 2 + 2; };
const braid = (x, y) => (y > 735 ? (x < 440 ? 'R' : x > 760 ? 'L' : null) : null);
const ahoge = (x, y) => y < 232 && x > 440 && x < 640;

// group: 组名；cn/en：图层名；src：See-through 图层或 'res'（本地切分）或 'gen'（程序生成）；
// pred：从源图层中挑像素；dil：判定“归属”时外扩像素（细小线稿防止残影）
const DEFS = [
  { group: 'A', cn: '其它散碎像素（待清理）', en: 'Misc', src: 'res', pred: () => true, hidden: false },
  ...STARS.map((s, i) => ({ group: 'A', cn: `星星${i + 1}`, en: `Star_0${i + 1}`, src: 'res', pred: (x, y) => starOf(x, y) === i, prop: true })),
  { group: 'A', cn: '兜帽（外壳+内衬）', en: 'Hood', src: 'res', pred: (x, y) => y < 1180 && x > 110 && x < 1090 && !inCloud(x, y) && starOf(x, y) < 0 },
  { group: 'A', cn: '后发', en: 'Hair_Back', src: 'back hair', pred: (x, y) => !braid(x, y) },
  { group: 'A', cn: '斗篷后片内衬', en: 'Cape_Back_Lining', src: 'topwear', pred: (x, y, r, g, b) => y > 1120 && isBrown(r, g, b) },
  { group: 'B', cn: '右腿（含袜）', en: 'Leg_R', src: 'legwear', pred: (x) => x < 596 },
  { group: 'B', cn: '左腿（含袜）', en: 'Leg_L', src: 'legwear', pred: (x) => x >= 596 },
  { group: 'B', cn: '右鞋', en: 'Shoe_R', src: 'res', pred: (x, y) => y >= 1880 && x > 360 && x < 596 && starOf(x, y) < 0 },
  { group: 'B', cn: '左鞋', en: 'Shoe_L', src: 'res', pred: (x, y) => y >= 1880 && x >= 596 && x < 840 && starOf(x, y) < 0 },
  { group: 'B', cn: '脖子+领口', en: 'Neck', src: 'res', pred: (x, y) => x > 470 && x < 740 && y > 740 && y < 880 },
  { group: 'B', cn: '裙', en: 'Skirt', src: 'bottomwear' },
  { group: 'C', cn: '毛衣+斗篷前片', en: 'Topwear', src: 'topwear', pred: (x, y, r, g, b) => !(y > 1120 && isBrown(r, g, b)) },
  { group: 'C', cn: '右手（袖）', en: 'Hand_R', src: 'handwear-r' },
  { group: 'C', cn: '左手（袖）', en: 'Hand_L', src: 'handwear-l' },
  { group: 'C', cn: '麻花辫右', en: 'Braid_R', src: 'back hair', pred: (x, y) => braid(x, y) === 'R' },
  { group: 'C', cn: '麻花辫左', en: 'Braid_L', src: 'back hair', pred: (x, y) => braid(x, y) === 'L' },
  { group: 'D', cn: '脸', en: 'Face', src: 'face' },
  { group: 'D', cn: '鼻', en: 'Nose', src: 'nose', dil: 2 },
  { group: 'DM', cn: '嘴', en: 'Mouth', src: 'mouth', dil: 3 },
  { group: 'DM', cn: '闭嘴线（临时）', en: 'MouthClose', src: 'gen', hidden: true },
  { group: 'D', cn: '腮红加深（临时）', en: 'Cheek_Blush', src: 'gen', hidden: true },
  ...['R', 'L'].flatMap((k) => {
    const s = k.toLowerCase(), cnK = k === 'R' ? '右' : '左', g = 'E' + k;
    return [
      { group: g, cn: `眼白${cnK}`, en: `EyeWhite_${k}`, src: `eyewhite-${s}`, dil: 1 },
      { group: g, cn: `虹膜${cnK}（含高光）`, en: `Iris_${k}`, src: `irides-${s}`, dil: 1 },
      { group: g, cn: `下眼睑${cnK}`, en: `EyeLidLow_${k}`, src: `eyelash-${s}`, pred: lashLow(k), dil: 3 },
      { group: g, cn: `上眼睑+睫毛${cnK}`, en: `EyeLidUp_${k}`, src: `eyelash-${s}`, pred: (x, y) => !lashLow(k)(x, y), dil: 3 },
      { group: g, cn: `闭眼线${cnK}（临时）`, en: `EyeClose_${k}`, src: 'gen', hidden: true },
      { group: g, cn: `眉毛${cnK}`, en: `Brow_${k}`, src: `eyebrow-${s}`, dil: 2 },
    ];
  }),
  { group: 'H', cn: '前发+侧发', en: 'Hair_Front', src: 'front hair', pred: (x, y) => !ahoge(x, y) },
  { group: 'H', cn: '呆毛', en: 'Ahoge', src: 'front hair', pred: ahoge },
  { group: 'H', cn: '桦枝+桦叶', en: 'Twig', src: 'headwear', dil: 1 },
  { group: 'F', cn: '小云朵', en: 'Cloud', src: 'res', pred: inCloud, prop: true },
];
const GROUPS = {
  A: '后层 | Back', B: '身体 | Body', C: '手臂·斗篷·辫子 | Arms_Cape', D: '头部 | Head', DM: '嘴 | Mouth',
  ER: '右眼 | Eye_R', EL: '左眼 | Eye_L', H: '头发前层·桦枝 | Hair_Front', F: '前景道具 | Props',
};

/* ---------- 每层的覆盖遮罩 ---------- */
const masks = DEFS.map((d) => {
  if (d.src === 'res' || d.src === 'gen') return null;
  const S = ST[d.src], m = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (S.a[i] < 128) continue;
    const x = i % IW, y = (i / IW) | 0;
    // See-through 把云朵和星星并进了 topwear，这里统一排除，交给本地切分
    if (inCloud(x, y) || starOf(x, y) >= 0) continue;
    if (!d.pred || d.pred(x, y, S.col[i * 3], S.col[i * 3 + 1], S.col[i * 3 + 2])) m[i] = 1;
  }
  return m;
});
function dilate(m, r) {
  let a = m;
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(a);
    for (let i = 0; i < N; i++) if (a[i]) { const x = i % IW; if (x > 0) b[i - 1] = 1; if (x < IW - 1) b[i + 1] = 1; if (i >= IW) b[i - IW] = 1; if (i < N - IW) b[i + IW] = 1; }
    a = b;
  }
  return a;
}
const own = DEFS.map((d, i) => (masks[i] && d.dil ? dilate(masks[i], d.dil) : masks[i]));

/* ---------- 归属：每个可见像素属于“最上层覆盖它的图层” ---------- */
const owner = new Int16Array(N).fill(-1);
for (let li = 0; li < DEFS.length; li++) if (own[li]) { const m = own[li]; for (let i = 0; i < N; i++) if (m[i] && !bg[i]) owner[i] = li; }
// 没有 See-through 图层覆盖、又不是背景的像素 → 本地切分
for (let i = 0; i < N; i++) {
  if (bg[i] || owner[i] >= 0) continue;
  const x = i % IW, y = (i / IW) | 0;
  for (let li = DEFS.length - 1; li >= 0; li--) if (DEFS[li].src === 'res' && DEFS[li].pred(x, y)) { owner[i] = li; break; }
}

/* 本地切分层里的零碎噪点（JPEG 底色噪声）：小连通块且接近底色 → 归为背景 */
{
  const seen = new Uint8Array(N), q = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (seen[s] || owner[s] < 0 || DEFS[owner[s]].src !== 'res') continue;
    const li = owner[s]; let h = 0, t = 0, dsum = 0; q[t++] = s; seen[s] = 1;
    while (h < t) {
      const i = q[h++], x = i % IW;
      dsum += Math.abs(web[i * 4] - PAPER[0]) + Math.abs(web[i * 4 + 1] - PAPER[1]) + Math.abs(web[i * 4 + 2] - PAPER[2]);
      for (const j of [i - 1, i + 1, i - IW, i + IW]) {
        if (j < 0 || j >= N || seen[j] || owner[j] !== li) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === IW - 1)) continue;
        seen[j] = 1; q[t++] = j;
      }
    }
    if (t < 600 && dsum / t < 70) for (let k = 0; k < t; k++) { owner[q[k]] = -1; bg[q[k]] = 1; }
  }
}

/* ---------- 合成各层像素 ---------- */
const layers = DEFS.map((d) => ({ ...d, rgba: null }));
for (let li = 0; li < DEFS.length; li++) {
  const d = DEFS[li]; if (d.src === 'gen') continue;
  const rgba = new Uint8ClampedArray(N * 4); let any = false;
  // 色差校正：可见处原画 vs See-through 的平均差，用于修正被遮挡处的补画颜色
  const corr = [0, 0, 0];
  if (masks[li]) {
    const S = ST[d.src]; let n = 0;
    for (let i = 0; i < N; i++) if (owner[i] === li && masks[li][i] && S.a[i] > 230) { for (let c = 0; c < 3; c++) corr[c] += web[i * 4 + c] - S.col[i * 3 + c]; n++; }
    if (n > 50) for (let c = 0; c < 3; c++) corr[c] /= n; else corr.fill(0);
    d.corr = corr.map((v) => Math.round(v));
  }
  let vis = 0, hid = 0;
  for (let i = 0; i < N; i++) {
    if (bg[i]) continue;
    if (owner[i] === li) {
      // 本地切分层没有 AI 遮罩：接近底色的像素按色差渐隐，避免和舞台底色之间出现接缝
      let A = 255;
      if (d.src === 'res') {
        const dist = Math.abs(web[i * 4] - PAPER[0]) + Math.abs(web[i * 4 + 1] - PAPER[1]) + Math.abs(web[i * 4 + 2] - PAPER[2]);
        A = Math.round(255 * Math.min(1, Math.max(0, (dist - 10) / 30)));
        if (!A) continue;
        // 去底色：还原半透明像素的原色
        const a = A / 255;
        for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.max(0, Math.min(255, (web[i * 4 + c] - PAPER[c] * (1 - a)) / a));
      } else { rgba[i * 4] = web[i * 4]; rgba[i * 4 + 1] = web[i * 4 + 1]; rgba[i * 4 + 2] = web[i * 4 + 2]; }
      rgba[i * 4 + 3] = A; any = true; vis++;
    } else if (masks[li] && masks[li][i] && owner[i] > li) {
      const S = ST[d.src];
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = S.col[i * 3 + c] + corr[c];
      rgba[i * 4 + 3] = S.a[i]; any = true; hid++;
    }
  }
  // 补画区边缘：See-through 的柔边（遮罩阈值外但 alpha>0）
  if (masks[li]) {
    const S = ST[d.src];
    for (let i = 0; i < N; i++) {
      if (rgba[i * 4 + 3] || bg[i] || !S.a[i] || S.a[i] >= 128 || owner[i] <= li) continue;
      const x = i % IW, y = (i / IW) | 0;
      if (d.pred && !d.pred(x, y, S.col[i * 3], S.col[i * 3 + 1], S.col[i * 3 + 2])) continue;
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = S.col[i * 3 + c] + corr[c];
      rgba[i * 4 + 3] = S.a[i];
    }
  }
  layers[li].vis = vis; layers[li].hid = hid; layers[li].corr = d.corr;
  layers[li].rgba = any ? rgba : null;
}

/* ---------- 程序生成的临时图层 ---------- */
function canvas() { return new Uint8ClampedArray(N * 4); }
function over(rgba, x, y, col, a) {
  if (x < 0 || y < 0 || x >= IW || y >= IH || a <= 0) return;
  const i = (y * IW + x) * 4, A = rgba[i + 3] / 255, na = a + A * (1 - a);
  for (let c = 0; c < 3; c++) rgba[i + c] = (col[c] * a + rgba[i + c] * A * (1 - a)) / na;
  rgba[i + 3] = na * 255;
}
function strokePoly(rgba, pts, w, col, alpha = 1) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (let y = Math.floor(y0 - w); y <= y1 + w; y++) for (let x = Math.floor(x0 - w); x <= x1 + w; x++) {
    let d = 1e9;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    over(rgba, x, y, col, Math.max(0, Math.min(1, w / 2 + 0.5 - d)) * alpha);
  }
}
const lashColor = (key) => { // 取上睫毛最暗的一批像素的平均色
  const L = layers.find((l) => l.en === 'EyeLidUp_' + key); const arr = [];
  for (let i = 0; i < N; i++) if (L.rgba && L.rgba[i * 4 + 3] === 255) arr.push([lum(web[i * 4], web[i * 4 + 1], web[i * 4 + 2]), i]);
  arr.sort((a, b) => a[0] - b[0]); const top = arr.slice(0, Math.max(1, arr.length >> 3));
  return [0, 1, 2].map((c) => top.reduce((s, [, i]) => s + web[i * 4 + c], 0) / top.length);
};
for (const l of layers) {
  if (l.src !== 'gen') continue;
  const rgba = canvas();
  if (l.en.startsWith('EyeClose_')) {
    const key = l.en.slice(-1), pts = EYES[key];
    const line = pts.map(([x, t, , lo]) => [x, t + (lo - t) * 0.82 - 2]);
    strokePoly(rgba, line, 4.5, lashColor(key));
  } else if (l.en === 'MouthClose') {
    const pts = []; for (let k = 0; k <= 16; k++) { const u = k / 16 * 2 - 1; pts.push([MOUTH.cx + u * 20, MOUTH.top + 4 + 4 * (1 - u * u) - 1]); }
    strokePoly(rgba, pts, 3.5, [138, 59, 53]);
  } else if (l.en === 'Cheek_Blush') {
    for (const B of BLUSH) for (let y = B.y - B.r; y <= B.y + B.r; y++) for (let x = B.x - B.r * 1.25; x <= B.x + B.r * 1.25; x++) {
      const d = Math.hypot((x - B.x) / 1.25, y - B.y) / B.r; if (d >= 1) continue;
      over(rgba, Math.round(x), y, [248, 124, 130], d < 0.6 ? 0.42 - d * 0.33 : 0.22 * (1 - d) / 0.4);
    }
    for (const B of BLUSH) for (let k = -1; k <= 1; k++) strokePoly(rgba, [[B.x + k * 16 - 6, B.y + 10], [B.x + k * 16 + 6, B.y - 10]], 3, [224, 96, 106], 0.75);
  }
  l.rgba = rgba;
}

/* ---------- 裁剪到包围盒 ---------- */
for (const l of layers) {
  if (!l.rgba) { l.empty = true; continue; }
  let x0 = IW, y0 = IH, x1 = -1, y1 = -1;
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) if (l.rgba[(y * IW + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { l.empty = true; l.rgba = null; continue; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) Buffer.from(l.rgba.buffer).copy(out, y * w * 4, ((y + y0) * IW + x0) * 4, ((y + y0) * IW + x1 + 1) * 4);
  Object.assign(l, { left: x0, top: y0, width: w, height: h, crop: out });
  delete l.rgba;
}
const used = layers.filter((l) => !l.empty);
console.log('layers', used.length, '/', layers.length, used.map((l) => l.en).join(' '));
let unowned = 0; for (let i = 0; i < N; i++) if (!bg[i] && owner[i] < 0) unowned++;
console.log('unowned non-bg px', unowned);

/* ---------- 调试：归属图 ---------- */
if (DEBUG) {
  const dbg = Buffer.alloc(N * 4);
  const hue = (k) => { const h = (k * 0.618034) % 1; const f = (n) => { const kk = (n + h * 6) % 6; return 255 * (1 - Math.max(0, Math.min(kk, 4 - kk, 1)) * 0.75); }; return [f(5), f(3), f(1)]; };
  for (let i = 0; i < N; i++) {
    const c = bg[i] ? [255, 255, 255] : owner[i] < 0 ? [0, 0, 0] : hue(owner[i]);
    const g = lum(web[i * 4], web[i * 4 + 1], web[i * 4 + 2]) / 255;
    for (let k = 0; k < 3; k++) dbg[i * 4 + k] = c[k] * (0.45 + 0.55 * g); dbg[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(process.env.TEMP, 'opencode', 'owner.png'), P.encodePNG(IW, IH, dbg));
}

/* ---------- 输出 ---------- */
const OUT = path.join(ROOT, 'psd'), LD = path.join(OUT, 'layers');
fs.mkdirSync(LD, { recursive: true });
for (const f of fs.readdirSync(LD)) fs.unlinkSync(path.join(LD, f));
const meta = [];
used.forEach((l, i) => {
  const file = `${String(i + 1).padStart(2, '0')}_${l.en}.png`;
  fs.writeFileSync(path.join(LD, file), P.encodePNG(l.width, l.height, l.crop));
  meta.push({
    order: i + 1, id: l.en, name: `${l.cn} | ${l.en}`, group: GROUPS[l.group], file, src: l.src,
    left: l.left, top: l.top, width: l.width, height: l.height, hidden: !!l.hidden, prop: !!l.prop,
    visiblePx: l.vis || 0, inpaintPx: l.hid || 0, colorFix: l.corr || null,
  });
});
fs.writeFileSync(path.join(OUT, 'layers.json'), JSON.stringify({ canvas: { width: IW, height: IH }, layers: meta }, null, 1));

/* PSD：按组嵌套（DM / E* 嵌在 D 里） */
const root = { children: [] }; const gnode = {};
const parentOf = (g) => (g === 'DM' || g === 'ER' || g === 'EL' ? 'D' : null);
for (const l of used) {
  if (!gnode[l.group]) {
    const node = { name: GROUPS[l.group], group: true, children: [] }; gnode[l.group] = node;
    const p = parentOf(l.group);
    if (p) { if (!gnode[p]) { gnode[p] = { name: GROUPS[p], group: true, children: [] }; root.children.push(gnode[p]); } gnode[p].children.push(node); }
    else root.children.push(node);
  }
  gnode[l.group].children.push({ name: `${l.cn} | ${l.en}`, left: l.left, top: l.top, width: l.width, height: l.height, rgba: l.crop, hidden: !!l.hidden });
}
// 合成图（可见层叠加）
const comp = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { comp[i * 4] = PAPER[0]; comp[i * 4 + 1] = PAPER[1]; comp[i * 4 + 2] = PAPER[2]; comp[i * 4 + 3] = 255; }
for (const l of used) {
  if (l.hidden) continue;
  for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
    const q = (y * l.width + x) * 4, a = l.crop[q + 3] / 255; if (!a) continue;
    const k = ((y + l.top) * IW + x + l.left) * 4;
    for (let c = 0; c < 3; c++) comp[k + c] = comp[k + c] * (1 - a) + l.crop[q + c] * a;
  }
}
// 背景层
root.children.unshift({ name: '底色（可删） | Paper', left: 0, top: 0, width: IW, height: IH, rgba: (() => { const b = Buffer.alloc(N * 4); for (let i = 0; i < N; i++) { b[i * 4] = PAPER[0]; b[i * 4 + 1] = PAPER[1]; b[i * 4 + 2] = PAPER[2]; b[i * 4 + 3] = 255; } return b; })() });
fs.writeFileSync(path.join(OUT, 'xiaohua_layers.psd'), P.writePSD(IW, IH, root, comp));
fs.writeFileSync(path.join(OUT, 'composite_check.png'), P.encodePNG(IW, IH, comp));
let err = 0; for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) err += Math.abs(comp[i * 4 + c] - web[i * 4 + c]);
console.log('composite mean abs err', (err / N / 3).toFixed(3));

/* ---------- 网页图集：shelf 装箱到 2048² 页 ---------- */
const PAGE = 2048, PADX = 2;
const order = used.map((l, i) => i).sort((a, b) => used[b].height - used[a].height);
const pages = []; let cur = null;
for (const i of order) {
  const l = used[i]; let placed = false;
  for (const pg of pages) {
    for (const sh of pg.shelves) if (l.height + PADX <= sh.h && sh.x + l.width + PADX <= PAGE) { l.atlas = { page: pages.indexOf(pg), x: sh.x, y: sh.y }; sh.x += l.width + PADX; placed = true; break; }
    if (placed) break;
    if (pg.y + l.height + PADX <= PAGE && l.width + PADX <= PAGE) { const sh = { y: pg.y, h: l.height + PADX, x: 0 }; pg.shelves.push(sh); pg.y += sh.h; l.atlas = { page: pages.indexOf(pg), x: 0, y: sh.y }; sh.x = l.width + PADX; placed = true; break; }
  }
  if (!placed) { cur = { shelves: [], y: 0 }; pages.push(cur); const sh = { y: 0, h: l.height + PADX, x: l.width + PADX }; cur.shelves.push(sh); cur.y = sh.h; l.atlas = { page: pages.length - 1, x: 0, y: 0 }; }
}
const pageBufs = pages.map((pg) => { const h = Math.min(PAGE, pg.y); let hh = 1; while (hh < h) hh <<= 1; return { h: hh, buf: Buffer.alloc(PAGE * hh * 4) }; });
for (const l of used) {
  const pb = pageBufs[l.atlas.page];
  for (let y = 0; y < l.height; y++) l.crop.copy(pb.buf, ((l.atlas.y + y) * PAGE + l.atlas.x) * 4, y * l.width * 4, (y + 1) * l.width * 4);
}
const js = [
  '/* 由 tools/build_layers.js 生成：小嬅分层图集（See-through + 原画 + 本地切分）。请勿手改 */',
  'window.XH_LAYERS = ' + JSON.stringify({
    canvas: { width: IW, height: IH },
    pages: pageBufs.map((pb) => ({ w: PAGE, h: pb.h })),
    layers: used.map((l) => ({ id: l.en, name: `${l.cn} | ${l.en}`, x: l.left, y: l.top, w: l.width, h: l.height, page: l.atlas.page, u: l.atlas.x, v: l.atlas.y, hidden: !!l.hidden, prop: !!l.prop })),
  }) + ';',
  'window.XH_ATLAS = [' + pageBufs.map((pb) => '"data:image/png;base64,' + P.encodePNG(PAGE, pb.h, pb.buf).toString('base64') + '"').join(',\n') + '];',
].join('\n');
fs.writeFileSync(path.join(ROOT, 'assets', 'xiaohua_layers.js'), js);
console.log('atlas pages', pageBufs.map((p) => PAGE + 'x' + p.h).join(', '), 'js bytes', js.length);






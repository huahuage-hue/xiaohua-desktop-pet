/* 从"穿在身上"的 Seedream 生成图里拆出配饰 / 服装图层（网页坐标 1200×2133）
   输入：psd/raw/gen/aligned_worn_<id>.png（tools/align.js 全图配准，3040×5404）
         psd/raw/web.png（原图网页尺寸）、assets/xiaohua_layers.js（原图层图集）
   输出：psd/raw/wardrobe/worn/<id>.png 与 worn.json
   配饰：与原图逐像素色差 → ROI 内去噪、闭运算、填洞、1px 羽化，只保留新增像素
   服装：对每个衣服原图层，可见处取生成图像素，被遮挡处用"生成/原图"色比场补色，alpha 沿用原图层
   用法：node tools/extract_worn.js [id ...] */
'use strict';
const { fs, path, P, ROOT, IW, IH, loadWeb } = require('./common.js');
const GEN = path.join(ROOT, 'psd/raw/gen');
const OUT = path.join(ROOT, 'psd/raw/wardrobe/worn');
fs.mkdirSync(OUT, { recursive: true });
const N = IW * IH;

/* roi：网页坐标 [x0,y0,x1,y1]；thr：色差阈值；min：最小连通域；open：是否开运算去细线噪声；gold：只取暖色细线（眼镜） */
const ACC = {
  scarf:    { roi: [360, 700, 840, 1180], thr: 34, min: 400, close: 4 },
  fur:      { roi: [330, 700, 880, 1010], thr: 34, min: 400, close: 4 },
  flower:   { roi: [220, 260, 640, 640], thr: 40, min: 80, close: 2 },
  ribbon:   { roi: [600, 80, 1060, 560], thr: 40, min: 3000, close: 3 },
  cloudpin: { roi: [600, 860, 860, 1090], thr: 46, min: 200, close: 2 },
  charm:    { roi: [262, 830, 400, 1080], thr: 16, min: 300, close: 3 },
  glasses:  { roi: [330, 440, 880, 720], thr: 30, min: 25, close: 1, open: false, gold: true },
  bag:      { roi: [180, 740, 1010, 1480], thr: 36, min: 300, close: 3 },
  /* v0.4.0 节日配饰：发夹参照 flower，挂坠参照 charm，头顶类在兜帽上方 */
  lantern:  { roi: [220, 260, 640, 640], thr: 40, min: 80, close: 2 },
  heart:    { roi: [220, 260, 640, 640], thr: 40, min: 80, close: 2 },
  knot:     { roi: [262, 830, 400, 1080], thr: 16, min: 300, close: 3 },
  sachet:   { roi: [262, 830, 400, 1080], thr: 16, min: 300, close: 3 },
  bell:     { roi: [262, 830, 400, 1080], thr: 16, min: 300, close: 3 },
  /* 垂耳兔：两只耳朵贴着兜帽两侧下垂 */
  bunny:    { roi: [60, 60, 1140, 620], thr: 14, min: 2000, close: 3, openR: 2 },
  witch:    { roi: [200, 0, 1060, 420], thr: 34, min: 2000, close: 3, nocream: 170 },
  antler:   { roi: [200, 0, 1060, 420], thr: 34, min: 800, close: 3, nocream: 170 },
};
const OUTFITS = ['o_cream', 'o_plaid', 'o_moon', 'o_star', 'f_spring', 'f_valentine', 'f_dragon', 'f_midautumn', 'f_halloween', 'f_xmas'];
const CLOTH = {
  o_cream: ['Hood_Back', 'Hood_Lining', 'Hood_Front', 'Hood_Rim', 'HoodSide_R', 'HoodSide_L', 'Cape_Back_Lining', 'Cape_Front_R', 'Cape_Front_L', 'Cape_Hem_R', 'Cape_Hem_L', 'Sweater'],
};
const CLOTH_DEF = ['Hood_Back', 'Hood_Lining', 'Hood_Front', 'Hood_Rim', 'HoodSide_R', 'HoodSide_L', 'Cape_Back_Lining', 'Cape_Front_R', 'Cape_Front_L', 'Cape_Hem_R', 'Cape_Hem_L'];

const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const WEB = loadWeb();

/* 3040×5404 → 1200×2133 面积平均 */
function down(img) {
  const kx = img.width / IW, ky = img.height / IH, o = new Float32Array(N * 3);
  for (let y = 0; y < IH; y++) {
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    for (let x = 0; x < IW; x++) {
      const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) { const q = (j * img.width + i) * 4; r += img.rgba[q]; g += img.rgba[q + 1]; b += img.rgba[q + 2]; n++; }
      const k = (y * IW + x) * 3; o[k] = r / n; o[k + 1] = g / n; o[k + 2] = b / n;
    }
  }
  return o;
}
function blur3(src) {
  const o = new Float32Array(src.length);
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= IW || Y >= IH) continue;
      const k = (Y * IW + X) * 3; r += src[k]; g += src[k + 1]; b += src[k + 2]; n++;
    }
    const k = (y * IW + x) * 3; o[k] = r / n; o[k + 1] = g / n; o[k + 2] = b / n;
  }
  return o;
}
const webF = new Float32Array(N * 3);
for (let i = 0; i < N; i++) { webF[i * 3] = WEB[i * 4]; webF[i * 3 + 1] = WEB[i * 4 + 1]; webF[i * 3 + 2] = WEB[i * 4 + 2]; }
const webB = blur3(webF);

/* 形态学（ROI 内） */
function morph(m, box, r, grow) {
  const [x0, y0, x1, y1] = box; let a = m;
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(a);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * IW + x;
      if (grow ? a[i] : !a[i]) continue;
      const nb = [i - 1, i + 1, i - IW, i + IW];
      for (const j of nb) if (grow ? a[j] : !a[j]) { b[i] = grow ? 1 : 0; break; }
    }
    a = b;
  }
  return a;
}
function components(m, box, min) {
  const [x0, y0, x1, y1] = box, lab = new Int32Array(N), out = new Uint8Array(N), q = new Int32Array(N);
  let id = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const s = y * IW + x; if (!m[s] || lab[s]) continue;
    id++; let h = 0, t = 0; q[t++] = s; lab[s] = id;
    while (h < t) {
      const i = q[h++], X = i % IW, Y = (i / IW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = X + dx, ny = Y + dy; if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
        const j = ny * IW + nx; if (m[j] && !lab[j]) { lab[j] = id; q[t++] = j; }
      }
    }
    if (t >= min) for (let k = 0; k < t; k++) out[q[k]] = 1;
  }
  return out;
}
function fillHoles(m, box) {
  const [x0, y0, x1, y1] = box, bg = new Uint8Array(N), q = new Int32Array(N); let h = 0, t = 0;
  const push = (x, y) => { const i = y * IW + x; if (!m[i] && !bg[i]) { bg[i] = 1; q[t++] = i; } };
  for (let x = x0; x < x1; x++) { push(x, y0); push(x, y1 - 1); }
  for (let y = y0; y < y1; y++) { push(x0, y); push(x1 - 1, y); }
  while (h < t) {
    const i = q[h++], X = i % IW, Y = (i / IW) | 0;
    if (X > x0) push(X - 1, Y); if (X < x1 - 1) push(X + 1, Y); if (Y > y0) push(X, Y - 1); if (Y < y1 - 1) push(X, Y + 1);
  }
  const o = new Uint8Array(m);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * IW + x; if (!bg[i]) o[i] = 1; }
  return o;
}
/* mask → 1px 羽化 alpha，裁成最小包围盒 */
function cut(mask, col, box, alphaSrc) {
  const [X0, Y0, X1, Y1] = box;
  let x0 = IW, y0 = IH, x1 = -1, y1 = -1;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) if (mask[y * IW + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(IW - 1, x1 + 2); y1 = Math.min(IH - 1, y1 + 2);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x + x0, Y = y + y0, i = Y * IW + X;
    let a;
    if (alphaSrc) a = alphaSrc(X, Y);
    else {
      let s = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const xx = X + k, yy = Y + j; if (xx < 0 || yy < 0 || xx >= IW || yy >= IH) continue; s += mask[yy * IW + xx] * ((j || k) ? 1 : 2); n += (j || k) ? 1 : 2; }
      a = mask[i] ? Math.max(0.5, s / n) : s / n * 0.6;
    }
    const o = (y * w + x) * 4;
    rgba[o] = col[i * 3]; rgba[o + 1] = col[i * 3 + 1]; rgba[o + 2] = col[i * 3 + 2]; rgba[o + 3] = Math.round(Math.min(1, a) * 255);
  }
  return { x: x0, y: y0, w, h, rgba };
}

/* ---- 原图层（网页坐标图集） ---- */
let LAY = null;
function layers() {
  if (LAY) return LAY;
  const src = fs.readFileSync(path.join(ROOT, 'assets/xiaohua_layers.js'), 'utf8');
  const sandbox = {}; sandbox.window = sandbox; new Function('window', src)(sandbox);
  const pages = sandbox.XH_ATLAS.map((u) => P.decodePNG(Buffer.from(u.split(',')[1], 'base64')));
  LAY = { meta: sandbox.XH_LAYERS, pages };
  return LAY;
}
function layerPx(L, pages) {
  const pg = pages[L.page];
  return (X, Y) => { // 网页坐标 → [r,g,b,a]
    const x = X - L.x, y = Y - L.y; if (x < 0 || y < 0 || x >= L.w || y >= L.h) return null;
    const q = ((L.v + y) * pg.width + L.u + x) * 4;
    return [pg.rgba[q], pg.rgba[q + 1], pg.rgba[q + 2], pg.rgba[q + 3]];
  };
}
/* 原图整体覆盖度（任一层不透明即算覆盖）——用来判断服装层的空洞是不是真的露背景 */
let BCOV = null;
function baseCoverage() {
  if (BCOV) return BCOV;
  const { meta, pages } = layers();
  BCOV = new Uint8Array(N);
  for (const L of meta.layers) {
    const pg = pages[L.page];
    for (let y = 0; y < L.h; y++) {
      const row = (L.y + y) * IW + L.x;
      for (let x = 0; x < L.w; x++) {
        const a = pg.rgba[((L.v + y) * pg.width + L.u + x) * 4 + 3];
        if (a > BCOV[row + x]) BCOV[row + x] = a;
      }
    }
  }
  return BCOV;
}
/* 服装层沿用原层 alpha 时会把原层的封闭小洞一起带过来；多层同时有洞就会在成品上露出背景。
   把不接触裁剪边、原图整体不透明的封闭小洞，用生成图颜色补满 */
function sealHoles(rgba, w, h, ox, oy, col) {
  const open = (i) => rgba[i * 4 + 3] < 8;
  const seen = new Uint8Array(w * h), q = new Int32Array(w * h);
  let t = 0;
  const push = (i) => { if (open(i) && !seen[i]) { seen[i] = 1; q[t++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  for (let hd = 0; hd < t; hd++) {
    const i = q[hd], x = i % w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w); if (i + w < w * h) push(i + w);
  }
  const cov = baseCoverage();
  let n = 0;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !open(s)) continue;
    let t2 = 0, big = false; q[t2++] = s; seen[s] = 1;
    const comp = [];
    while (t2) {
      const i = q[--t2], x = i % w; comp.push(i);
      if (comp.length > 4000) big = true;
      for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && !seen[j] && open(j)) { seen[j] = 1; q[t2++] = j; }
    }
    if (big || comp.length < 6) continue;
    let ok = true;
    for (const i of comp) {
      const X = i % w + ox, Y = ((i / w) | 0) + oy;
      if (cov[Y * IW + X] < 250) { ok = false; break; }
    }
    if (!ok) continue;
    for (const i of comp) {
      const X = i % w + ox, Y = ((i / w) | 0) + oy, k = Y * IW + X;
      rgba[i * 4] = col[k * 3]; rgba[i * 4 + 1] = col[k * 3 + 1]; rgba[i * 4 + 2] = col[k * 3 + 2]; rgba[i * 4 + 3] = 255;
    }
    n++;
  }
  return n;
}

/* 前景图层（手、辫子、脸、刘海）在生成图里仍然可见的像素，从配饰里去掉——它们由原图层画在配饰前面，
   否则手一动，配饰里就会露出一只"烙"进去的手 */
const OCC = ['Hand_R', 'Hand_L', 'Braid_R_1', 'Braid_R_2', 'Braid_R_3', 'BraidTie_R', 'Braid_L_1', 'Braid_L_2', 'Braid_L_3', 'BraidTie_L', 'Face', 'Hair_Side_R', 'Hair_Side_L', 'Bangs_R', 'Bangs_C', 'Bangs_L', 'Ahoge', 'Twig'];
function unocclude(m, box, col, thr) {
  const { meta, pages } = layers();
  const o = new Uint8Array(m);
  for (const id of OCC) {
    const L = meta.layers.find((l) => l.id === id); if (!L) continue;
    const get = layerPx(L, pages);
    const x0 = Math.max(box[0], L.x), y0 = Math.max(box[1], L.y), x1 = Math.min(box[2], L.x + L.w), y1 = Math.min(box[3], L.y + L.h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * IW + x; if (!o[i]) continue;
      const p = get(x, y); if (!p || p[3] < 200) continue;
      const d = Math.hypot(col[i * 3] - WEB[i * 4], col[i * 3 + 1] - WEB[i * 4 + 1], col[i * 3 + 2] - WEB[i * 4 + 2]);
      if (d < thr * 0.8) o[i] = 0;
    }
  }
  return o;
}
const res = fs.existsSync(path.join(OUT, 'worn.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'worn.json'), 'utf8')) : {};
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ACC).concat(OUTFITS);
for (const id of want) {
  const file = path.join(GEN, 'aligned_worn_' + id + '.png');
  if (!fs.existsSync(file)) { log('skip', id); continue; }
  const col = down(P.decodePNG(fs.readFileSync(file)));
  if (ACC[id]) {
    const c = ACC[id], box = c.roi, colB = blur3(col);
    let m = new Uint8Array(N);
    for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) {
      const i = y * IW + x, k = i * 3;
      const d = Math.hypot(colB[k] - webB[k], colB[k + 1] - webB[k + 1], colB[k + 2] - webB[k + 2]);
      if (d < c.thr) continue;
      if (c.ink) { const r = col[k], g = col[k + 1], b = col[k + 2], lum = 0.3 * r + 0.59 * g + 0.11 * b; if (!(lum < 200 || (r - b > 70 && lum < 235))) continue; }
      /* nocream：头顶类配饰去掉兜帽轮廓位移带进来的奶油色残影（高亮、低饱和） */
      if (c.nocream) { const r = col[k], g = col[k + 1], b = col[k + 2], lum = 0.3 * r + 0.59 * g + 0.11 * b, sat = Math.max(r, g, b) - Math.min(r, g, b); if (lum > c.nocream && sat < 60) continue; }
      if (c.gold) { const r = col[k], g = col[k + 1], b = col[k + 2], lum = 0.3 * r + 0.59 * g + 0.11 * b; if (!(r - b > 30 && lum < 225)) continue; }
      m[i] = 1;
    }
    /* outside：只要原兜帽轮廓以外的像素（兜帽位移带进来的整片兜帽顶不算配饰） */
    if (c.outside) {
      const { meta, pages } = layers();
      for (const id of c.outside) {
        const L = meta.layers.find((l) => l.id === id); if (!L) continue;
        const get = layerPx(L, pages);
        for (let y = Math.max(box[1], L.y); y < Math.min(box[3], L.y + L.h); y++) for (let x = Math.max(box[0], L.x); x < Math.min(box[2], L.x + L.w); x++) {
          const p = get(x, y); if (p && p[3] > 40) m[y * IW + x] = 0;
        }
      }
    }
    const R0 = c.openR || 1;
    if (c.open !== false) m = morph(morph(m, box, R0, false), box, R0, true);
    m = components(m, box, c.min);
    m = morph(morph(m, box, c.close, true), box, c.close, false);
    if (!c.gold) m = fillHoles(m, box);
    m = unocclude(m, box, col, c.thr);
    const L = cut(m, col, box);
    if (!L) { log('EMPTY', id); continue; }
    fs.writeFileSync(path.join(OUT, id + '.png'), P.encodePNG(L.w, L.h, L.rgba));
    let px = 0; for (let i = 3; i < L.rgba.length; i += 4) if (L.rgba[i] > 128) px++;
    res[id] = { x: L.x, y: L.y, w: L.w, h: L.h, px };
    log(id, JSON.stringify(res[id]));
  } else {
    /* 服装：逐个原衣服图层换面料 */
    const { meta, pages } = layers();
    const list = CLOTH[id] || CLOTH_DEF;
    res[id] = { layers: {} };
    for (const lid of list) {
      const L = meta.layers.find((l) => l.id === lid); if (!L) continue;
      const get = layerPx(L, pages);
      const w = L.w, h = L.h, rgba = Buffer.alloc(w * h * 4);
      /* 可见 = 原图层像素 ≈ 原图合成像素（说明这里画的就是这层） */
      const vis = new Uint8Array(w * h);
      const G = 12, gw = Math.ceil(w / G), gh = Math.ceil(h / G), acc = new Float32Array(gw * gh * 4);
      let nv = 0, nd = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = get(L.x + x, L.y + y); if (!p || p[3] < 250) continue;
        const i = (L.y + y) * IW + L.x + x;
        const d = Math.hypot(p[0] - WEB[i * 4], p[1] - WEB[i * 4 + 1], p[2] - WEB[i * 4 + 2]);
        if (d > 22) continue;
        vis[y * w + x] = 1; nv++;
        const g = ((y / G) | 0) * gw + ((x / G) | 0), k = i * 3;
        acc[g * 4] += col[k] / Math.max(8, p[0]); acc[g * 4 + 1] += col[k + 1] / Math.max(8, p[1]); acc[g * 4 + 2] += col[k + 2] / Math.max(8, p[2]); acc[g * 4 + 3]++;
        nd += Math.hypot(col[k] - p[0], col[k + 1] - p[1], col[k + 2] - p[2]);
      }
      /* 色比场：网格平均，空格向外扩散 */
      const rat = new Float32Array(gw * gh * 3), has = new Uint8Array(gw * gh);
      for (let g = 0; g < gw * gh; g++) if (acc[g * 4 + 3] >= 4) { has[g] = 1; for (let c = 0; c < 3; c++) rat[g * 3 + c] = acc[g * 4 + c] / acc[g * 4 + 3]; }
      for (let it = 0; it < gw + gh; it++) {
        let any = false; const nh = new Uint8Array(has);
        for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
          const g = gy * gw + gx; if (has[g]) continue;
          let n = 0, s = [0, 0, 0];
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = gx + dx, Y = gy + dy; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue; const q = Y * gw + X; if (!has[q]) continue; n++; for (let c = 0; c < 3; c++) s[c] += rat[q * 3 + c]; }
          if (n) { nh[g] = 1; any = true; for (let c = 0; c < 3; c++) rat[g * 3 + c] = s[c] / n; }
        }
        has.set(nh); if (!any) break;
      }
      const ratAt = (x, y, c) => {
        const fx = Math.min(gw - 1, Math.max(0, x / G - 0.5)), fy = Math.min(gh - 1, Math.max(0, y / G - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
        const v = (gx, gy) => (has[gy * gw + gx] ? rat[(gy * gw + gx) * 3 + c] : 1);
        return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
      };
      /* 可见区边缘收 1px，避免把相邻图层的描边带进来 */
      const vin = new Uint8Array(vis);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (vis[i] && (!vis[i - 1] || !vis[i + 1] || !vis[i - w] || !vis[i + w])) vin[i] = 0; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = get(L.x + x, L.y + y), o = (y * w + x) * 4; if (!p || !p[3]) continue;
        const i = (L.y + y) * IW + L.x + x;
        for (let c = 0; c < 3; c++) {
          const v = vin[y * w + x] ? col[i * 3 + c] : p[c] * ratAt(x, y, c);
          rgba[o + c] = Math.max(0, Math.min(255, Math.round(v)));
        }
        rgba[o + 3] = (lid === 'Hood_Front' && L.y + y < 50) ? 0 : p[3];
      }
      if (lid === 'Hood_Front') {
        const A = (x, y) => rgba[(y * w + x) * 4 + 3];
        const y0 = Math.max(0, 80 - L.y), y1 = Math.min(h, 135 - L.y), xa = Math.max(1, 560 - L.x), xb = Math.min(w - 1, 640 - L.x);
        for (let it = 0; it < 40; it++) {
          const fill = [];
          for (let y = y0; y < y1; y++) for (let x = xa; x < xb; x++) {
            if (A(x, y) > 230) continue;
            let l = 0, r = 0; for (let k = 1; k <= 40; k++) { if (x - k >= 0 && A(x - k, y) > 230) l = 1; if (x + k < w && A(x + k, y) > 230) r = 1; }
            if (!(l && r)) continue;
            let n = 0, R = 0, Gc = 0, B = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = ((y + dy) * w + x + dx) * 4; if ((dx || dy) && rgba[q + 3] > 230) { n++; R += rgba[q]; Gc += rgba[q + 1]; B += rgba[q + 2]; } }
            if (n >= 2) fill.push([(y * w + x) * 4, R / n, Gc / n, B / n]);
          }
          if (!fill.length) break;
          for (const [q, R, Gc, B] of fill) { rgba[q] = R; rgba[q + 1] = Gc; rgba[q + 2] = B; rgba[q + 3] = 255; }
        }
      }
      sealHoles(rgba, w, h, L.x, L.y, col);
      fs.writeFileSync(path.join(OUT, `${id}__${lid}.png`), P.encodePNG(w, h, rgba));
      const md = nv ? nd / nv : 0;
      res[id].layers[lid] = { x: L.x, y: L.y, w, h, vis: nv, diff: +md.toFixed(1) };
      log(id, lid, 'vis', nv, 'diff', md.toFixed(1));
    }
  }
  fs.writeFileSync(path.join(OUT, 'worn.json'), JSON.stringify(res, null, 1));
}
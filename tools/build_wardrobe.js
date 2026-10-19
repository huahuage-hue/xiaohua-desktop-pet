/* 打包换装图层：tools/extract_worn.js 的输出 → assets/wardrobe/atlas*.png + assets/xiaohua_wardrobe.js
   配饰 = 新增叠加层（z 锚点插入）；套装 = 原衣服图层的同位替换层（replace，沿用原层绑定与物理）
   贴图按 TEX 缩放存储（tw/th），渲染时拉回原尺寸——桌宠显示约为原图 1/3，面料不损失
   用法：node tools/build_wardrobe.js */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./psdlib.js');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'psd/raw/wardrobe/worn');
const OUT = path.join(ROOT, 'assets/wardrobe');
const JS = path.join(ROOT, 'assets/xiaohua_wardrobe.js');
const W = 2048, H = 2048, PAD = 3;

/* 配饰：file = worn/<file>.png；z = 插在哪层之前；rig 与相邻原层一致 */
const ACC = {
  flower:  { file: 'flower',   name: '桦叶小花夹', slot: 'hair',  rig: { head: 0.024 }, z: 'before:Ahoge' },
  ribbon:  { file: 'ribbon',   name: '奶油蝴蝶结', slot: 'hair',  rig: { head: 0.007, fall: 1, hood: 1 }, z: 'before:Ahoge' },
  scarf:   { file: 'scarf',    name: '针织条纹围巾', slot: 'neck',  rig: { scarf: 1 }, z: 'before:Hand_R', hide: ['Neck'] },
  fur:     { file: 'fur',      name: '毛绒领圈', slot: 'neck',  rig: { scarf: 1 }, z: 'before:Hand_R', hide: ['Neck'] },
  bag:     { file: 'bag',      name: '焦糖小挎包', slot: 'bag',   rig: { bag: 1 }, z: 'before:Hand_R' },
  brooch:  { file: 'cloudpin', name: '云朵胸针', slot: 'chest', rig: {}, z: 'before:Hand_R', hide: ['Brooch'] },
  charm:   { file: 'charm',    name: '星星挂坠', slot: 'charm', rig: { braid: 'R', seg: 2, head: 0.007, fall: 1 }, z: 'before:Face' },
  glasses: { file: 'glasses',  name: '细金圆框眼镜', slot: 'face', rig: { head: 0.019 }, z: 'before:Hair_Side_R' },
  /* v0.4.0 节日配饰 */
  lantern: { file: 'lantern',  name: '小灯笼发夹', slot: 'hair',  rig: { head: 0.024 }, z: 'before:Ahoge', fest: 1 },
  heart:   { file: 'heart',    name: '莓果爱心夹', slot: 'hair',  rig: { head: 0.024 }, z: 'before:Ahoge', fest: 1 },
  knot:    { file: 'knot',     name: '中国结挂坠', slot: 'charm', rig: { braid: 'R', seg: 2, head: 0.007, fall: 1 }, z: 'before:Face', fest: 1 },
  sachet:  { file: 'sachet',   name: '艾草香囊', slot: 'charm', rig: { braid: 'R', seg: 2, head: 0.007, fall: 1 }, z: 'before:Face', fest: 1 },
  bell:    { file: 'bell',     name: '金色小铃铛', slot: 'charm', rig: { braid: 'R', seg: 2, head: 0.007, fall: 1 }, z: 'before:Face', fest: 1 },
  bunny:   { file: 'bunny',    name: '玉兔耳朵', slot: 'head',  rig: { head: 0.007, fall: 1, hood: 1 }, z: 'before:Ahoge', fest: 1 },
  witch:   { file: 'witch',    name: '小巫师帽', slot: 'head',  rig: { head: 0.007, fall: 1, hood: 1 }, z: 'before:Ahoge', fest: 1 },
  antler:  { file: 'antler',   name: '冬青鹿角', slot: 'head',  rig: { head: 0.007, fall: 1, hood: 1 }, z: 'before:Ahoge', fest: 1 },
};
const OUTFITS = {
  classic: { name: '原版桦叶斗篷' },
  cream:   { name: '晨露针织斗篷', src: 'o_cream' },
  plaid:   { name: '焦糖格纹斗篷', src: 'o_plaid' },
  moon:    { name: '月白星月斗篷', src: 'o_moon' },
  star:    { name: '星绣奶油斗篷', src: 'o_star' },
  /* 节日装：fest = 节日 id（日期表在 app-dress.js） */
  spring:    { name: '锦鲤红春节斗篷', src: 'f_spring', fest: 'spring' },
  valentine: { name: '莓果情人节斗篷', src: 'f_valentine', fest: 'valentine' },
  dragon:    { name: '青艾端午斗篷', src: 'f_dragon', fest: 'dragon' },
  midautumn: { name: '玉兔中秋斗篷', src: 'f_midautumn', fest: 'midautumn' },
  halloween: { name: '南瓜万圣斗篷', src: 'f_halloween', fest: 'halloween' },
  xmas:      { name: '冬青圣诞斗篷', src: 'f_xmas', fest: 'xmas' },
};
const TEX = { acc: 0.85, cloth: 0.6 };

function trimInfo(img) {
  const { width: w, height: h, rgba } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > 3) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
/* 预乘 alpha 面积平均缩放（边缘不发黑） */
function scale(img, [sx, sy, sw, sh], k) {
  const dw = Math.max(1, Math.round(sw * k)), dh = Math.max(1, Math.round(sh * k)), out = Buffer.alloc(dw * dh * 4);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const ya = sy + y * fy, yb = sy + (y + 1) * fy, xa = sx + x * fx, xb = sx + (x + 1) * fx;
    for (let Y = Math.floor(ya); Y < Math.ceil(yb); Y++) for (let X = Math.floor(xa); X < Math.ceil(xb); X++) {
      const wy = Math.min(yb, Y + 1) - Math.max(ya, Y), wx = Math.min(xb, X + 1) - Math.max(xa, X), w = wx * wy;
      if (w <= 0 || X >= img.width || Y >= img.height) continue;
      const q = (Y * img.width + X) * 4, al = img.rgba[q + 3] / 255 * w;
      r += img.rgba[q] * al; g += img.rgba[q + 1] * al; b += img.rgba[q + 2] * al; a += al; n += w;
    }
    const o = (y * dw + x) * 4;
    if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = Math.round(a / n * 255); }
  }
  return { w: dw, h: dh, rgba: out };
}

const J = JSON.parse(fs.readFileSync(path.join(SRC, 'worn.json'), 'utf8'));
const items = [];
for (const [id, c] of Object.entries(ACC)) {
  const e = J[c.file]; if (!e) throw new Error('missing worn ' + c.file);
  const img = P.decodePNG(fs.readFileSync(path.join(SRC, c.file + '.png')));
  const tb = trimInfo(img); if (!tb) throw new Error('empty ' + id);
  const t = scale(img, tb, TEX.acc);
  items.push({ group: 'acc', layer: { id: 'W_' + id, name: c.name + ' | W_' + id, slot: c.slot, x: e.x + tb[0], y: e.y + tb[1], w: tb[2], h: tb[3], rig: c.rig, z: c.z, hidden: true, wardrobe: true }, t });
}
for (const [oid, o] of Object.entries(OUTFITS)) {
  if (!o.src) continue;
  const e = J[o.src]; if (!e) throw new Error('missing outfit ' + o.src);
  const g = 'o_' + oid;
  for (const [lid, L] of Object.entries(e.layers)) {
    const img = P.decodePNG(fs.readFileSync(path.join(SRC, `${o.src}__${lid}.png`)));
    const tb = trimInfo(img); if (!tb) continue;
    const t = scale(img, tb, TEX.cloth);
    items.push({ group: g, layer: { id: `W_${oid}__${lid}`, name: `${o.name}·${lid} | W_${oid}__${lid}`, outfit: oid, replace: lid, rigOf: lid, x: L.x + tb[0], y: L.y + tb[1], w: tb[2], h: tb[3], z: 'after:' + lid, hidden: true, wardrobe: true }, t });
  }
}

/* 分组 shelf 打包：配饰共用一组页（启动即加载）；每套衣服单独一组页（atlas_<outfit>N.png，穿上时才加载） */
const pages = [];
const groups = [...new Set(items.map((it) => it.group))];
for (const grp of groups) {
  const list = items.filter((it) => it.group === grp).sort((a, b) => b.t.h - a.t.h);
  const gp = [];
  const newPage = () => { const p = { group: grp, n: gp.length, buf: Buffer.alloc(W * H * 4), x: PAD, y: PAD, rowH: 0 }; gp.push(p); pages.push(p); return p; };
  for (const it of list) {
    const placeIn = (p) => {
      const s = { x: p.x, y: p.y, rowH: p.rowH };
      if (p.x + it.t.w + PAD > W) { p.x = PAD; p.y += p.rowH + PAD; p.rowH = 0; }
      if (p.y + it.t.h + PAD > H) { Object.assign(p, s); return false; }
      it.page = pages.indexOf(p); it.u = p.x; it.v = p.y; p.x += it.t.w + PAD; p.rowH = Math.max(p.rowH, it.t.h); return true;
    };
    if (!gp.some(placeIn) && !placeIn(newPage())) throw new Error('too big ' + it.layer.id);
    const p = pages[it.page];
    for (let y = 0; y < it.t.h; y++) it.t.rgba.copy(p.buf, ((it.v + y) * W + it.u) * 4, y * it.t.w * 4, (y + 1) * it.t.w * 4);
  }
}
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^(atlas\w*|pat_\w+)\.png$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const pname = (p) => (p.group === 'acc' ? `atlas_acc${p.n}` : `atlas_${p.group.slice(2)}${p.n}`);
pages.forEach((p) => fs.writeFileSync(path.join(OUT, pname(p) + '.png'), P.encodePNG(W, H, p.buf)));

const layers = items.map((it) => ({ ...it.layer, page: it.page, u: it.u, v: it.v, tw: it.t.w, th: it.t.h }));
const data = {
  /* lazy = 套装 id：该页只在穿这套时加载，换下后释放 */
  pages: pages.map((p) => ({ w: W, h: H, src: `assets/wardrobe/${pname(p)}.png`, ...(p.group === 'acc' ? {} : { lazy: p.group.slice(2) }) })),
  layers,
  patterns: {},
  outfits: Object.fromEntries(Object.entries(OUTFITS).map(([k, o]) => [k, { name: o.name, ...(o.fest ? { fest: o.fest } : {}) }])),
  acc: Object.fromEntries(Object.entries(ACC).map(([k, c]) => [k, { name: c.name, slot: c.slot, hide: c.hide || [], ...(c.fest ? { fest: 1 } : {}) }])),
};
const js = '/* 由 tools/build_wardrobe.js 生成：Seedream 5.0 "穿在身上"生成 → extract_worn.js 差分拆层。勿手改 */\n' +
  'window.XH_WARDROBE = ' + JSON.stringify(data) + ';\n' +
  'window.XH_WARDROBE_META = ' + JSON.stringify({ outfits: data.outfits, acc: data.acc }) + ';\n';
fs.writeFileSync(JS, js);
console.log('layers', layers.length, 'pages', pages.length, 'js', (js.length / 1024).toFixed(0) + 'KB');
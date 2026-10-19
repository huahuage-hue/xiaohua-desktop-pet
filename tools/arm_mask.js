/* 抬手臂补画（psd/raw/gen/arm_up.png，Seedream）→ 手臂遮罩 psd/raw/gen/arm_up_mask.png（生成图坐标）
   做法：深色描边当墙，从手臂内部种子点泛洪（限定在左上角手臂区域，右侧用斜线和兜帽隔开），再向描边外扩 5px 吃进描边。
   底部（袖子伸进斗篷处）用 FADE 段渐隐，交给斗篷肩口盖住。
   用法：node tools/arm_mask.js */
'use strict';
const fs = require('fs'), path = require('path');
const P = require('./psdlib.js');
const ROOT = path.resolve(__dirname, '..');
const G = P.decodePNG(fs.readFileSync(path.join(ROOT, 'psd/raw/gen/arm_up.png')));
const W = G.width, H = G.height;
const lum = (q) => 0.3 * G.rgba[q] + 0.59 * G.rgba[q + 1] + 0.11 * G.rgba[q + 2];
const Y1 = 1180, FADE = [1179, 1180]; // 不再渐隐：袖根整段藏到斗篷前片下面
const right = (y) => (y < 520 ? 485 : 440 + (y - 420) * 0.07);
const wall = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) wall[i] = lum(i * 4) < 120 ? 1 : 0;
const m = new Uint8Array(W * H), st = [];
for (const [x, y] of [[328, 455], [328, 642], [352, 853], [300, 800], [350, 950], [320, 1100]]) { const i = y * W + x; if (!wall[i]) { m[i] = 1; st.push(i); } }
while (st.length) {
  const i = st.pop();
  for (const j of [i - 1, i + 1, i - W, i + W]) {
    const X = j % W, Y = (j / W) | 0;
    if (X < 120 || Y < 180 || Y > Y1 || X > right(Y)) continue;
    if (!m[j] && !wall[j]) { m[j] = 1; st.push(j); }
  }
}
for (let it = 0; it < 5; it++) {
  const add = [];
  for (let i = W; i < W * H - W; i++) { const Y = (i / W) | 0; if (m[i] || !wall[i] || Y > Y1 || (i % W) > right(Y) + 4) continue; if (m[i - 1] || m[i + 1] || m[i - W] || m[i + W]) add.push(i); }
  for (const i of add) m[i] = 1;
}
/* 输出 8 位遮罩（灰度存到 RGBA），底部渐隐 */
const out = Buffer.alloc(W * H * 4);
let n = 0;
for (let i = 0; i < W * H; i++) {
  if (!m[i]) continue;
  const Y = (i / W) | 0, a = Y <= FADE[0] ? 1 : Math.max(0, 1 - (Y - FADE[0]) / (FADE[1] - FADE[0]));
  const v = Math.round(255 * a); out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; n++;
}
fs.writeFileSync(path.join(ROOT, 'psd/raw/gen/arm_up_mask.png'), P.encodePNG(W, H, out, 6));
console.error('arm mask px', n);

/* 小嬅图层定义（网页坐标 1200×2133，自下而上）
   src：See-through 图层名 / 'res' 本地切分（pred 用原画颜色）/ 'genfill' 生成图整块 / 'genline' 生成图抽线 / 'gen' 程序画
   pred(x, y, r, g, b, i)；fill：被手挡住处用哪张生成图补；holes：被这些兄弟层占走的像素用邻色补齐 */
'use strict';
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
const CLOUD = { cx: 1031, cy: 936, r: 122, minX: 914, face: [1012, 912, 62] };
const STARS = [[158, 952, 42], [1110, 778, 22], [1058, 1134, 28], [114, 1166, 22], [206, 1042, 14], [274, 1684, 18], [888, 1694, 12], [944, 1738, 18]];
const BRAID = { y1: 815, y2: 935, tie: { R: [300, 812, 412, 898], L: [785, 812, 890, 898] } };
const LINEBOX = { L: [645, 560, 805, 678], R: [418, 570, 562, 686], M: [553, 672, 650, 745] };

const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
const isBrown = (r, g, b) => r >= g && g >= b && Math.max(r, g, b) - Math.min(r, g, b) > 45 && lum(r, g, b) < 190;
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
const inBox = (x, y, b) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3];
const starOf = (x, y) => STARS.findIndex(([cx, cy, r]) => inCircle(x, y, cx, cy, r * 1.15 + 8));
const inCloud = (x, y) => x > CLOUD.minX - 6 && inCircle(x, y, CLOUD.cx, CLOUD.cy, CLOUD.r + 18);
const cloudFace = (x, y) => inCircle(x, y, CLOUD.face[0], CLOUD.face[1], CLOUD.face[2]);
const lashLow = (k) => (x, y) => { const E = EYES[k], p = eyeProfile(E, x); return x > E[0][0] + 4 && x < E[E.length - 1][0] - 4 && y > (p[2] + p[3]) / 2 + 2; };
const braid = (x, y) => (y > 735 ? (x < 440 ? 'R' : x > 760 ? 'L' : null) : null);
const braidPart = (x, y) => { const k = braid(x, y); if (!k) return null; if (inBox(x, y, BRAID.tie[k])) return k + 'T'; return k + (y < BRAID.y1 ? 1 : y < BRAID.y2 ? 2 : 3); };
const ahoge = (x, y) => y < 232 && x > 440 && x < 640;
const hoodBox = (x, y) => y < 1180 && x > 110 && x < 1090 && !inCloud(x, y) && starOf(x, y) < 0;
const sweater = (x, y) => { if (y < 1060 || y > 1340) return false; const t = (y - 1060) / 280; return x > 430 - 20 * t && x < 770 + 20 * t; };
const brooch = (x, y, r, g, b) => inBox(x, y, [650, 900, 790, 1050]) && r > g && g - b > 40 && lum(r, g, b) < 225;
const tongue = (r, g, b) => r > 195 && r - g > 45 && g > 95 && lum(r, g, b) > 135;
const lipLine = (r, g, b) => lum(r, g, b) < 108;
const irisHi = (r, g, b) => lum(r, g, b) > 226;
const IRIS_C = { L: [707, 597], R: [491, 619] };
const pupil = (k) => (x, y, r, g, b) => b > r + 14 && b > 120 && inCircle(x, y, IRIS_C[k][0], IRIS_C[k][1], 18);
const bowCol = (r, g, b) => r > 165 && g > 115 && b < 150 && r - b > 55;
const capeLining = (y, r, g, b) => y > 1120 && isBrown(r, g, b);

module.exports = function defs(rimZone) {
  const front = (x0, x1) => (x, y) => !ahoge(x, y) && x >= x0 && x < x1;
  const DEFS = [
    { group: 'A', cn: '其它散碎像素（待清理）', en: 'Misc', src: 'res', pred: () => true },
    ...STARS.map((s, i) => ({ group: 'A', cn: `星星${i + 1}`, en: `Star_0${i + 1}`, src: 'res', pred: (x, y) => starOf(x, y) === i, prop: true })),
    { group: 'AH', cn: '兜帽后壁（补画）', en: 'Hood_Back', src: 'genfill', gen: 'hood_empty', pred: (x, y) => y < 900 && hoodBox(x, y) },
    { group: 'AH', cn: '兜帽内衬', en: 'Hood_Lining', src: 'res', pred: (x, y, r, g, b) => hoodBox(x, y) && y < 760 && isBrown(r, g, b) },
    { group: 'AH', cn: '兜帽外壳', en: 'Hood_Front', src: 'res', pred: (x, y, r, g, b, i) => hoodBox(x, y) && y < 700 && !isBrown(r, g, b) && !rimZone[i] },
    { group: 'AH', cn: '兜帽垂片右', en: 'HoodSide_R', src: 'res', pred: (x, y, r, g, b) => hoodBox(x, y) && x < 600 && y >= 700 && !(y < 760 && isBrown(r, g, b)) },
    { group: 'AH', cn: '兜帽垂片左', en: 'HoodSide_L', src: 'res', pred: (x, y, r, g, b) => hoodBox(x, y) && x >= 600 && y >= 700 && !(y < 760 && isBrown(r, g, b)) },
    { group: 'AH', cn: '兜帽沿', en: 'Hood_Rim', src: 'res', pred: (x, y, r, g, b, i) => hoodBox(x, y) && y < 760 && !isBrown(r, g, b) && rimZone[i] },
    { group: 'A', cn: '后发', en: 'Hair_Back', src: 'back hair', pred: (x, y) => !braid(x, y) },
    { group: 'A', cn: '斗篷后片内衬', en: 'Cape_Back_Lining', src: 'topwear', pred: (x, y, r, g, b) => capeLining(y, r, g, b) },
    { group: 'B', cn: '右腿', en: 'Leg_R', src: 'legwear', pred: (x, y) => x < 596 && y <= 1800 },
    { group: 'B', cn: '左腿', en: 'Leg_L', src: 'legwear', pred: (x, y) => x >= 596 && y <= 1800 },
    { group: 'B', cn: '右袜', en: 'Sock_R', src: 'legwear', pred: (x, y) => x < 596 && y > 1800 },
    { group: 'B', cn: '左袜', en: 'Sock_L', src: 'legwear', pred: (x, y) => x >= 596 && y > 1800 },
    { group: 'B', cn: '右鞋', en: 'Shoe_R', src: 'res', pred: (x, y) => y >= 1880 && x > 360 && x < 596 && starOf(x, y) < 0 },
    { group: 'B', cn: '右鞋蝴蝶结', en: 'ShoeBow_R', src: 'res', pred: (x, y, r, g, b) => y >= 1880 && x > 360 && x < 596 && bowCol(r, g, b) },
    { group: 'B', cn: '左鞋', en: 'Shoe_L', src: 'res', pred: (x, y) => y >= 1880 && x >= 596 && x < 840 && starOf(x, y) < 0 },
    { group: 'B', cn: '左鞋蝴蝶结', en: 'ShoeBow_L', src: 'res', pred: (x, y, r, g, b) => y >= 1880 && x >= 596 && x < 840 && bowCol(r, g, b) },
    { group: 'B', cn: '脖子+领口', en: 'Neck', src: 'res', pred: (x, y) => x > 470 && x < 740 && y > 740 && y < 880 },
    { group: 'B', cn: '裙', en: 'Skirt', src: 'bottomwear' },
    { group: 'C', cn: '毛衣', en: 'Sweater', src: 'topwear', fill: 'body_nohands', pred: (x, y, r, g, b) => sweater(x, y) && !isBrown(r, g, b) },
    { group: 'C', cn: '斗篷前片右', en: 'Cape_Front_R', src: 'topwear', fill: 'body_nohands', pred: (x, y, r, g, b) => x < 600 && y <= 1400 && !sweater(x, y) && !capeLining(y, r, g, b) },
    { group: 'C', cn: '斗篷前片左', en: 'Cape_Front_L', src: 'topwear', fill: 'body_nohands', pred: (x, y, r, g, b) => x >= 600 && y <= 1400 && !sweater(x, y) && !capeLining(y, r, g, b) },
    { group: 'C', cn: '斗篷下摆右', en: 'Cape_Hem_R', src: 'topwear', pred: (x, y, r, g, b) => x < 600 && y > 1400 && !isBrown(r, g, b) },
    { group: 'C', cn: '斗篷下摆左', en: 'Cape_Hem_L', src: 'topwear', pred: (x, y, r, g, b) => x >= 600 && y > 1400 && !isBrown(r, g, b) },
    { group: 'C', cn: '桦叶别针', en: 'Brooch', src: 'topwear', pred: brooch, dil: 2 },
    { group: 'C', cn: '右手（袖）', en: 'Hand_R', src: 'handwear-r' },
    { group: 'C', cn: '左手（袖）', en: 'Hand_L', src: 'handwear-l' },
    ...['R', 'L'].flatMap((k) => {
      const c = k === 'R' ? '右' : '左', g = 'BR' + k;
      return [
        { group: g, cn: `辫${c}·第1节`, en: `Braid_${k}_1`, src: 'back hair', pred: (x, y) => braidPart(x, y) === k + 1 },
        { group: g, cn: `辫${c}·第2节`, en: `Braid_${k}_2`, src: 'back hair', pred: (x, y) => braidPart(x, y) === k + 2 },
        { group: g, cn: `辫${c}·第3节`, en: `Braid_${k}_3`, src: 'back hair', pred: (x, y) => braidPart(x, y) === k + 3 },
        { group: g, cn: `辫${c}·绑带`, en: `BraidTie_${k}`, src: 'back hair', pred: (x, y) => braidPart(x, y) === k + 'T' },
      ];
    }),
    { group: 'D', cn: '脸', en: 'Face', src: 'face' },
    { group: 'D', cn: '鼻', en: 'Nose', src: 'nose', dil: 2 },
    { group: 'DM', cn: '口腔', en: 'Mouth_Inner', src: 'mouth', dil: 3, pred: (x, y, r, g, b) => !tongue(r, g, b) && !lipLine(r, g, b) },
    { group: 'DM', cn: '舌', en: 'Mouth_Tongue', src: 'mouth', pred: (x, y, r, g, b) => tongue(r, g, b) },
    { group: 'DM', cn: '下唇线', en: 'Mouth_LineLow', src: 'mouth', dil: 1, pred: (x, y, r, g, b) => lipLine(r, g, b) && y >= MOUTH.top + 10 },
    { group: 'DM', cn: '上唇线', en: 'Mouth_LineUp', src: 'mouth', dil: 1, pred: (x, y, r, g, b) => lipLine(r, g, b) && y < MOUTH.top + 10 },
    { group: 'DM', cn: '闭嘴', en: 'MouthClose', src: 'genline', gen: 'mouth_close', box: LINEBOX.M, minW: 14, hidden: true },
    { group: 'DM', cn: '微笑', en: 'Mouth_Smile', src: 'genline', gen: 'mouth_smile', box: LINEBOX.M, minW: 14, hidden: true },
    { group: 'DM', cn: '猫嘴', en: 'Mouth_Cat', src: 'genline', gen: 'mouth_cat', box: LINEBOX.M, minW: 14, hidden: true },
    { group: 'DM', cn: '嘟嘴', en: 'Mouth_Pout', src: 'genline', gen: 'mouth_pout', box: LINEBOX.M, minW: 14, hidden: true },
    { group: 'DM', cn: '波浪嘴', en: 'Mouth_Wavy', src: 'genline', gen: 'mouth_wavy', box: LINEBOX.M, minW: 14, hidden: true },
    { group: 'D', cn: '腮红加深', en: 'Cheek_Blush', src: 'gen', hidden: true },
    ...['R', 'L'].flatMap((k) => {
      const s = k.toLowerCase(), c = k === 'R' ? '右' : '左', g = 'E' + k;
      return [
        { group: g, cn: `眼白${c}`, en: `EyeWhite_${k}`, src: `eyewhite-${s}`, dil: 1 },
        { group: g, cn: `虹膜${c}`, en: `Iris_${k}`, src: `irides-${s}`, dil: 1, holes: [`Pupil_${k}`, `EyeHi_${k}`] },
        { group: g, cn: `瞳孔${c}`, en: `Pupil_${k}`, src: `irides-${s}`, pred: pupil(k) },
        { group: g, cn: `眼高光${c}`, en: `EyeHi_${k}`, src: `irides-${s}`, pred: (x, y, r, g, b) => irisHi(r, g, b), dil: 1 },
        { group: g, cn: `下眼睑${c}`, en: `EyeLidLow_${k}`, src: `eyelash-${s}`, pred: lashLow(k), dil: 3 },
        { group: g, cn: `上眼睑+睫毛${c}`, en: `EyeLidUp_${k}`, src: `eyelash-${s}`, pred: (x, y) => !lashLow(k)(x, y), dil: 3 },
        { group: g, cn: `闭眼${c}`, en: `EyeClose_${k}`, src: 'genline', gen: 'eye_close', box: LINEBOX[k], minW: 40, hidden: true },
        { group: g, cn: `笑眼${c}`, en: `EyeSmile_${k}`, src: 'genline', gen: 'eye_smile', box: LINEBOX[k], minW: 26, hidden: true },
        { group: g, cn: `眉毛${c}`, en: `Brow_${k}`, src: `eyebrow-${s}`, dil: 2 },
      ];
    }),
    { group: 'H', cn: '侧发右', en: 'Hair_Side_R', src: 'front hair', pred: front(0, 400) },
    { group: 'H', cn: '刘海·右束', en: 'Bangs_R', src: 'front hair', pred: front(400, 533) },
    { group: 'H', cn: '刘海·中束', en: 'Bangs_C', src: 'front hair', pred: front(533, 667) },
    { group: 'H', cn: '刘海·左束', en: 'Bangs_L', src: 'front hair', pred: front(667, 800) },
    { group: 'H', cn: '侧发左', en: 'Hair_Side_L', src: 'front hair', pred: front(800, 1300) },
    { group: 'H', cn: '呆毛', en: 'Ahoge', src: 'front hair', pred: ahoge },
    { group: 'H', cn: '桦枝+桦叶', en: 'Twig', src: 'headwear', dil: 1 },
    { group: 'F', cn: '云朵·身体', en: 'Cloud_Body', src: 'res', pred: inCloud, prop: true, holes: ['Cloud_FaceOpen', 'Cloud_Blush'] },
    { group: 'F', cn: '云朵·腮红', en: 'Cloud_Blush', src: 'res', prop: true, pred: (x, y, r, g, b) => inCloud(x, y) && inCircle(x, y, CLOUD.face[0], CLOUD.face[1], 85) && r - g > 20 && r - b > 16 && lum(r, g, b) > 150 },
    { group: 'F', cn: '云朵·五官', en: 'Cloud_FaceOpen', src: 'res', prop: true, pred: (x, y, r, g, b) => inCloud(x, y) && cloudFace(x, y) && lum(r, g, b) < 175 },
    { group: 'F', cn: '云朵·笑脸', en: 'Cloud_FaceHappy', src: 'genline', gen: 'cloud_happy', box: [CLOUD.face[0] - 62, CLOUD.face[1] - 50, CLOUD.face[0] + 62, CLOUD.face[1] + 45], minW: 6, hidden: true, prop: true, cloud: true },
  ];
  /* 虹膜本体：去掉瞳孔和高光 */
  const iris = (k) => DEFS.find((d) => d.en === 'Iris_' + k);
  for (const k of ['L', 'R']) iris(k).pred = (x, y, r, g, b) => !irisHi(r, g, b) && !pupil(k)(x, y, r, g, b);
  return DEFS;
};
Object.assign(module.exports, {
  EYES, MOUTH, BLUSH, CLOUD, STARS, lum, isBrown, inCloud, cloudFace, starOf, hoodBox,
  GROUPS: {
    A: '后层 | Back', AH: '兜帽 | Hood', B: '身体 | Body', C: '手臂·斗篷 | Arms_Cape', BRR: '麻花辫右 | Braid_R', BRL: '麻花辫左 | Braid_L',
    D: '头部 | Head', DM: '嘴 | Mouth', ER: '右眼 | Eye_R', EL: '左眼 | Eye_L', H: '头发前层·桦枝 | Hair_Front', F: '小云朵 | Cloud',
  },
  PARENT: { DM: 'D', ER: 'D', EL: 'D' },
});

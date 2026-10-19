/* 小嬅 Live2D 互动预览 · 核心：常量、参数、物理、网格变形（分层驱动版）（分层驱动版）
   坐标基于网页用图 assets/xiaohua_web.jpg（1200 × 2133）。 */
(function () {
  'use strict';
  const XH = (window.XH = {});

  XH.IW = 1200;
  XH.IH = 2133;
  XH.A = XH.IH / XH.IW;
  XH.GW = 48;
  XH.GH = 86;

  /* 面部叠加区域（眨眼 / 嘴 / 脸红都画在这块纹理里，随网格一起变形） */
  XH.FACE = { x: 416, y: 520, w: 392, h: 256 };
  /* ParamEyeL = 角色自己的左眼 = 画面右侧 */
  /* 眼部轮廓采样点（对照原图逐列量取）：[x, 睫毛上沿, 睫毛下沿, 下眼睑]
     眼睑开合时直接把原图的睫毛带沿这条轮廓往下“滑”，不再另画线条 */
  XH.EYES = [
    { key: 'L', pts: [
      [664, 570, 582, 594], [672, 556, 569, 618], [680, 549, 563, 632], [688, 544, 559, 642],
      [696, 541, 557, 648], [704, 540, 557, 651], [712, 540, 557, 652], [720, 540, 558, 650],
      [728, 542, 560, 647], [736, 545, 563, 642], [744, 548, 566, 635], [752, 552, 570, 628],
      [760, 557, 575, 621], [768, 564, 582, 614], [776, 572, 590, 608], [784, 584, 599, 606],
    ] },
    { key: 'R', pts: [
      [438, 581, 597, 606], [444, 576, 591, 618], [452, 570, 584, 632], [460, 566, 579, 644],
      [468, 564, 577, 653], [476, 563, 576, 659], [484, 563, 576, 663], [492, 563, 576, 664],
      [500, 564, 577, 662], [508, 567, 579, 658], [516, 571, 583, 650], [524, 576, 588, 636],
      [530, 580, 592, 620], [536, 586, 596, 604],
    ] },
  ];
  /* 嘴：上唇线基本水平，下方是圆弧（D 形）。张合时以上唇线为锚点缩放 */
  XH.MOUTH = {
    x: 560, y: 684, w: 84, h: 58, cx: 600, top: 689,
    outline: [[563, 694], [580, 690], [600, 688], [620, 687], [636, 686], [641, 699], [637, 716], [626, 731], [606, 739], [586, 736], [571, 722], [563, 706]],
  };
  XH.BLUSH = [
    { x: 484, y: 695, r: 58 },
    { x: 715, y: 672, r: 62 },
  ];
  XH.CLOUD = {
    cx: 1031, cy: 936, r: 122, minX: 914,
    region: { x: 896, y: 800, w: 272, h: 276 },
    eyes: [[984, 903], [1040, 918]],
  };
  XH.STARS = [
    [158, 952, 42], [1110, 778, 22], [1058, 1134, 28], [114, 1166, 22],
    [206, 1042, 14], [274, 1684, 18], [888, 1694, 12], [944, 1738, 18],
  ];

  /* [参数 ID, 中文名, 最小, 最大, 默认, 步长] —— 与方案文档第 4 章一致 */
  XH.PARAMS = [
    ['ParamAngleX', '头左右', -30, 30, 0, 1],
    ['ParamAngleY', '头上下', -30, 30, 0, 1],
    ['ParamAngleZ', '头倾斜', -30, 30, 0, 1],
    ['ParamEyeBallX', '眼珠左右', -1, 1, 0, 0.01],
    ['ParamEyeBallY', '眼珠上下', -1, 1, 0, 0.01],
    ['ParamEyeLOpen', '左眼开闭', 0, 1, 1, 0.01],
    ['ParamEyeROpen', '右眼开闭', 0, 1, 1, 0.01],
    ['ParamEyeLSmile', '左眼笑', 0, 1, 0, 0.01],
    ['ParamEyeRSmile', '右眼笑', 0, 1, 0, 0.01],
    ['ParamMouthOpenY', '嘴开合', 0, 1, 0.6, 0.01],
    ['ParamCheek', '脸红', 0, 1, 0.6, 0.01],
    ['ParamBodyAngleX', '身体左右', -10, 10, 0, 0.1],
    ['ParamBodyAngleZ', '身体倾斜', -10, 10, 0, 0.1],
    ['ParamBreath', '呼吸', 0, 1, 0, 0.01],
    ['ParamCapeGrip', '斗篷揪紧', 0, 1, 0.5, 0.01],
    ['ParamCloudFloat', '云朵漂浮', -1, 1, 0, 0.01],
    ['ParamCloudFace', '云朵表情', 0, 1, 0, 0.01],
    ['ParamSleepy', '困倦', 0, 1, 0, 0.01],
  ];
  XH.DEF = Object.fromEntries(XH.PARAMS.map((p) => [p[0], p[4]]));
  XH.RANGE = Object.fromEntries(XH.PARAMS.map((p) => [p[0], [p[2], p[3]]]));

  /* 工具 */
  const clamp = (XH.clamp = (x, a, b) => Math.min(b, Math.max(a, x)));
  const ss = (XH.ss = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  });
  const lerp = (XH.lerp = (a, b, t) => a + (b - a) * t);

  /* 物理：简化钟摆。k 刚度 / c 阻尼 / g 输入增益 */
  XH.PHYS = {
    braidL: { id: 'ParamBraidL', name: '左辫', k: 34, c: 4.2, g: 9, p: 0, v: 0, s: 0 },
    braidR: { id: 'ParamBraidR', name: '右辫', k: 36, c: 4.4, g: 9, p: 0, v: 0, s: 0 },
    braidL2: { id: 'ParamBraidL2', name: '左辫梢', k: 22, c: 2.6, g: 6, p: 0, v: 0, s: 0 },
    braidR2: { id: 'ParamBraidR2', name: '右辫梢', k: 24, c: 2.7, g: 6, p: 0, v: 0, s: 0 },
    hood: { id: 'ParamHood', name: '帽沿', k: 55, c: 5, g: 6, p: 0, v: 0, s: 0 },
    side: { id: 'ParamHairSide', name: '侧发', k: 60, c: 5, g: 8, p: 0, v: 0, s: 0 },
    hem2: { id: 'ParamCapeHem2', name: '下摆次级', k: 14, c: 2.2, g: 5, p: 0, v: 0, s: 0 },
    ahoge: { id: 'ParamAhoge', name: '呆毛', k: 95, c: 6.5, g: 11, p: 0, v: 0, s: 0 },
    twig: { id: 'ParamTwig', name: '桦枝', k: 70, c: 5.5, g: 10, p: 0, v: 0, s: 0 },
    scarf: { id: 'ParamScarfSway', name: '围巾', k: 38, c: 4, g: 7, p: 0, v: 0, s: 0 },
    bag: { id: 'ParamBagSway', name: '挎包', k: 26, c: 3, g: 6, p: 0, v: 0, s: 0 },
    hem: { id: 'ParamCapeHem', name: '斗篷下摆', k: 20, c: 3.2, g: 7, p: 0, v: 0, s: 0 },
    skirt: { id: 'ParamSkirt', name: '裙摆', k: 40, c: 5, g: 7, p: 0, v: 0, s: 0 },
  };
  /* sw：拖动摇摆整体转角 / 20°（可选）。物理只对输入的“变化率”起反应，所以身体一转，
     挂件按各自的支点朝“滞后”的方向甩：辫子 / 兜帽 / 呆毛是转动型（+），下摆 / 裙摆 / 侧发是平移型（−） */
  XH.physInputs = function (L, drag, sw) {
    const ax = L.ParamAngleX / 30, ay = L.ParamAngleY / 30, az = L.ParamAngleZ / 30;
    const bx = L.ParamBodyAngleX / 10, bz = L.ParamBodyAngleZ / 10;
    const s = sw || 0;
    return {
      braidL: ax * 0.6 + az * 0.4 + bx * 0.3 + bz * 0.3 + drag + s * 1.1,
      braidR: ax * 0.6 + az * 0.4 + bx * 0.3 + bz * 0.3 + drag + s * 1.1,
      /* 次级摆：输入是上一节的位置，产生跟随延迟 */
      braidL2: XH.PHYS.braidL.p * 0.9 + drag * 0.4,
      braidR2: XH.PHYS.braidR.p * 0.9 + drag * 0.4,
      hood: ax * 0.5 + az * 0.6 + drag * 0.5 + s * 0.5,
      side: ax * 0.6 + az * 0.5 + drag * 0.6 - s * 0.5,
      hem2: XH.PHYS.hem.p * 0.8 + bz * 0.3,
      ahoge: ax * 0.4 + ay * 0.3 + az * 0.3 + drag * 0.6 + s * 0.8,
      twig: ax * 0.5 + az * 0.5 + drag * 0.6 + s * 0.5,
      hem: bx * 0.6 + bz * 0.4 + drag * 1.2 - s * 1.2,
      skirt: bx * 0.5 + bz * 0.5 + drag * 0.8 - s * 0.9,
      scarf: bx * 0.7 + bz * 0.5 + drag * 1.1 - s * 0.8,
      bag: bx * 0.6 + bz * 0.6 + drag * 1.2 - s * 1.0,
    };
  };
  XH.stepPhys = function (dt, inputs) {
    /* dt = 0（同一时间戳的两帧）会让 (s - P.s) / dt 变成 NaN，物理值一旦 NaN 就再也回不来，
       挂在下摆 / 裙摆上的图层会整块消失。这里跳过并自愈 */
    if (!(dt > 1e-4)) return;
    for (const k in XH.PHYS) {
      const P = XH.PHYS[k], s = Number.isFinite(inputs[k]) ? inputs[k] : 0;
      if (!Number.isFinite(P.p) || !Number.isFinite(P.v) || !Number.isFinite(P.s)) { P.p = 0; P.v = 0; P.s = s; }
      const ds = clamp((s - P.s) / dt, -8, 8);
      P.s = s;
      const f = -P.k * P.p - P.c * P.v - P.g * ds;
      P.v = clamp(P.v + f * dt, -30, 30);
      P.p = clamp(P.p + P.v * dt, -1, 1);
    }
  };
  XH.resetPhys = function () { for (const k in XH.PHYS) { const P = XH.PHYS[k]; P.p = 0; P.v = 0; } };

  /* 网格变形：输入 uv（0–1），内部用“图宽”为单位，输出 uv */
  const D2R = Math.PI / 180;
  function rot(x, y, px, py, a) {
    if (!a) return [x, y];
    const c = Math.cos(a), s = Math.sin(a), dx = x - px, dy = y - py;
    return [px + dx * c - dy * s, py + dx * s + dy * c];
  }
  
  /* 网格变形（分层版）：输入 uv（0–1），内部用“图宽”为单位，输出 uv。
     lay 为图层配置：head = 转头位移系数（越靠前越大，做出视差）；fall = 是否随头部椭圆衰减；
     braid / ahoge / twig / hem / skirt / cloud / fixed 决定该层挂在哪个变形器上 */
  /* 网格变形（分层版）：输入 uv（0–1），内部用“图宽”为单位，输出 uv。
     lay 为图层配置：head = 转头位移系数（越靠前越大，做出视差）；fall = 是否随头部椭圆衰减；
     braid / ahoge / twig / hem / skirt / cloud / fixed 决定该层挂在哪个变形器上 */
  /* 注：拖动时的整体摇摆 / 拉伸不在这里做，而是渲染时在顶点着色器里统一乘一个矩阵（见 app-render.js uSw），
     这样眼白裁剪矩形仍按摇摆前的坐标算，不会因为整体转了 15° 而漏边 */
  XH.deform = function (u, v, L, out, i, lay) {
    const A = XH.A, P = XH.PHYS;
    lay = lay || {};
    let x = u, y = v * A;
    if (lay.fixed) { out[i] = u; out[i + 1] = v; return; }
    /* 腿 / 袜 / 鞋：以胯部（裙子里面）为支点晃，被拎起时脚轻轻荡 */
    if (lay.leg) {
      const R = lay.leg === 'R', la = R ? L.ParamLegR : L.ParamLegL;
      if (la) {
        const hx = R ? 0.42 : 0.565, hy = 0.665 * A;
        [x, y] = rot(x, y, hx, hy, la * D2R * ss(0.66, 0.72, v));
      }
    }

    /* 围巾 / 毛领：跟着身体和拖拽轻摆 */
    if (lay.scarf) {
      const w = ss(0.32, 0.5, v) * 0.7 + ss(0.35, 0.62, v) * 0.3;
      x += P.scarf.p * 0.014 * w;
      y += Math.abs(P.scarf.p) * 0.003 * w;
    }
    /* 挎包：绕肩点小摆 */
    if (lay.bag) {
      const w = ss(0.44, 0.66, v);
      x += P.bag.p * 0.012 * w;
      y += Math.abs(P.bag.p) * 0.0025 * w;
    }

    /* 眉毛角度：正 = 八字（担心 / 害羞），负 = 倒八字（生气）。支点在各自眉心 */
    if (lay.part === 'Brow' && L.ParamBrowAngle) {
      const R = lay.eye === 'R';
      [x, y] = rot(x, y, R ? 0.383 : 0.58, (R ? 0.238 : 0.2265) * A, L.ParamBrowAngle * 9 * D2R * (R ? -1 : 1));
    }
    /* 鼓脸：只把两颊下缘往外推，脸中线不动 */
    if (lay.face && L.ParamPuff) {
      const du = u - 0.505;
      const g = Math.exp(-(((v - 0.318) / 0.04) ** 2)) * ss(0.04, 0.17, Math.abs(du));
      x += Math.sign(du) * L.ParamPuff * 0.011 * g;
    }
    /* 双手：以肘部外侧为支点，越靠拳头位移越大，袖根基本不动，接缝不会被拉开 */
    if (lay.hand) {
      const R = lay.hand === 'R';
      const hy = R ? L.ParamHandRY : L.ParamHandLY, hr = R ? L.ParamHandRRot : L.ParamHandLRot;
      if (hy || hr) {
        const px = R ? 0.283 : 0.675, py = (R ? 0.577 : 0.59) * A;
        const w = ss(0.03, 0.17, Math.hypot(x - px, y - py));
        [x, y] = rot(x, y, px, py, (hr || 0) * D2R * w);
        y += (hy || 0) * 0.03 * w;
      }
    }

    /* 麻花辫：3 节链式钟摆。第 1 节以辫根为支点，第 2/3 节在上一节末端再叠一层次级摆动 */
    if (lay.braid) {
      const R = lay.braid === 'R';
      const p1 = R ? P.braidR.p : P.braidL.p, p2 = R ? P.braidR2.p : P.braidL2.p;
      const tu = R ? 0.3 : 0.69;
      const seg = lay.seg || 1;
      const j2 = 0.382, j3 = 0.438; // 节点（v）= 构建脚本 BRAID.y1 / y2
      if (seg >= 3) {
        const t = clamp((v - j3) / 0.06, 0, 1);
        [x, y] = rot(x, y, tu - 0.01, j3 * A, p2 * 0.32 * t);
      }
      if (seg >= 2) {
        const t = clamp((v - j2) / 0.05, 0, 1);
        [x, y] = rot(x, y, tu, j2 * A, (p2 * 0.22 + p1 * 0.1) * t);
      }
      const t = clamp((v - 0.345) / 0.05, 0, 1);
      /* 被拎着整体转了角度时，辫子受重力往回垂一点（相对身体反向转） */
      [x, y] = rot(x, y, tu, 0.345 * A, (p1 * 0.18 - (L.ParamSwing || 0) * 0.35 * D2R) * t);
    }
    /* 兜帽沿 / 垂片：以帽顶为支点轻晃 */
    if (lay.hood) {
      const w = ss(0.05, 0.36, v);
      [x, y] = rot(x, y, 0.5, 0.05 * A, P.hood.p * 0.05 * w);
    }
    if (lay.hoodSide) {
      const w = ss(0.3, 0.52, v), s = lay.hoodSide === 'R' ? -1 : 1;
      x += (P.hood.p * 0.012 + P.hem.p * 0.006 * s) * w;
    }
    /* 侧发：根部固定，发梢随头摆 */
    if (lay.side) {
      /* 侧发和刘海在 x=400 / 800 处切开：越靠切线摆得越少，切线上为 0，两层始终贴合 */
      const cut = lay.side === 'L' ? ss(0.667, 0.74, u) : ss(0.333, 0.26, u);
      const w = ss(0.22, 0.38, v) * cut;
      x += P.side.p * 0.012 * w;
    }
    /* 呆毛：根部固定 */
    if (lay.ahoge) {
      const w = ss(0.112, 0.06, v);
      [x, y] = rot(x, y, 0.45, 0.112 * A, P.ahoge.p * 0.3 * w);
    }
    /* 兜帽桦枝：以枝根为支点 */
    if (lay.twig) {
      const d = Math.hypot(u - 0.63, (v - 0.215) * A);
      const w = ss(0.0, 0.08, d);
      [x, y] = rot(x, y, 0.63, 0.215 * A, P.twig.p * 0.24 * w);
    }
    /* 斗篷下摆（含后片内衬），避开中间的腿 */
    if (lay.hem) {
      const legMask = v > 0.68 ? ss(0.12, 0.22, Math.abs(u - 0.5)) : 1;
      const w = ss(0.56, 0.8, v) * (0.35 + Math.abs(u - 0.5) * 1.6) * legMask;
      /* 左右下摆各自有一点相位差（次级摆），不再整块同步 */
      const side = lay.hem === 'L' ? P.hem2.p : lay.hem === 'R' ? -P.hem2.p : 0;
      x += (P.hem.p * 0.018 + side * 0.008) * w;
      y += Math.abs(P.hem.p) * 0.004 * w * (u - 0.5);
      y += (L.ParamHemLift || 0) * 0.012 * w; // 跳跃时下摆滞后
    }
    /* 裙摆 */
    if (lay.skirt) {
      const w = ss(0.63, 0.72, v);
      x += P.skirt.p * 0.014 * w;
      y += (L.ParamHemLift || 0) * 0.006 * w;
    }
    /* 小云朵：挂在 Root 下，只自己漂浮 */
    if (lay.cloud) {
      out[i] = u;
      out[i + 1] = (v * A + L.ParamCloudFloat * 0.014) / A;
      return;
    }
    /* 呼吸 + 斗篷揪紧（身体层） */
    {
      const g = Math.exp(-(((u - 0.5) / 0.3) ** 2 + ((v - 0.52) / 0.12) ** 2));
      x += (u - 0.5) * L.ParamBreath * 0.014 * g;
      y -= L.ParamBreath * 0.008 * g;
      const gs = Math.exp(-(((u - 0.5) / 0.26) ** 2 + ((v - 0.47) / 0.08) ** 2));
      const cg = L.ParamCapeGrip - 0.5;
      y -= cg * 0.014 * gs;
      x -= (u - 0.5) * cg * 0.05 * gs;
    }
    /* 头部：每层按自己的 head 系数平移 → 前发 / 五官 / 脸 / 后发 / 兜帽之间产生视差 */
    if (lay.head) {
      const dH = Math.hypot((u - 0.51) / 0.4, (v - 0.235) / 0.215);
      const wH = lay.fall ? 1 - ss(0.82, 1.22, dH) : 1;
      if (wH > 0) {
        const ax = L.ParamAngleX / 30, ay = L.ParamAngleY / 30;
        x += ax * lay.head * wH;
        y -= ay * lay.head * 0.65 * wH;
        [x, y] = rot(x, y, 0.505, 0.4 * A, L.ParamAngleZ * 0.3 * D2R * wH);
      }
    }
    /* 身体整体（脚底固定） */
    {
      x += (L.ParamBodyAngleX / 10) * 0.012 * ss(0.96, 0.4, v);
      [x, y] = rot(x, y, 0.5, 0.96 * A, L.ParamBodyAngleZ * 0.25 * D2R * ss(0.97, 0.55, v));
    }
    /* 整体上下：负 = 以脚底为基准下蹲压扁（略变宽），正 = 整体离地 */
    {
      const by = L.ParamBodyY || 0;
      if (by < 0) {
        const y0 = 0.965 * A;
        y = y0 + (y - y0) * (1 + by * 0.035);
        x = 0.5 + (x - 0.5) * (1 - by * 0.022 * ss(0.96, 0.55, v));
      } else if (by > 0) y -= by * 0.035;
    }
    out[i] = x;
    out[i + 1] = y / A;
  };
})();

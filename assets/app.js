/* 小嬅 Live2D 互动预览 · 主程序（分层驱动版）：待机、动作、交互、参数面板、图层面板 */
(function () {
  'use strict';
  const XH = window.XH;
  const { clamp, ss, lerp } = XH;
  /* 桌宠模式（desktop-pet/web/pet.html 里先设 window.XH_PET = true）：没有面板 / 按钮，指针由 pet.js 接管 */
  const PET = !!window.XH_PET;
  /* 找不到的元素返回一个空壳，面板相关代码在桌宠页里自动变成空操作 */
  const STUB = { setAttribute() {}, addEventListener() {}, appendChild() {}, focus() {}, remove() {}, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, textContent: '' };
  const $ = (id) => document.getElementById(id) || STUB;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /* 参数：base = 面板滑杆值；live = 每帧实际值。ParamMouthForm / ParamStarTwinkle 只由动作驱动 */
  const EXTRA = {
    ParamMouthForm: 1, ParamStarTwinkle: 1,
    /* 嘴型（互斥权重，0–1）与表情叠加：星星眼 / 加深腮红 */
    ParamMouthSmile: 0, ParamMouthCat: 0, ParamMouthPout: 0, ParamMouthWavy: 0,
    ParamEyeSpark: 0, ParamBlush: 0,
    /* 以下只由动作驱动（不进面板）：整体上下、双手、眉毛、下摆滞后、鼓脸、表情符号 */
    ParamBodyY: 0, ParamHandRY: 0, ParamHandRRot: 0, ParamHandLY: 0, ParamHandLRot: 0,
    ParamBrowRY: 0, ParamBrowLY: 0, ParamBrowAngle: 0, ParamHemLift: 0, ParamPuff: 0,
    ParamShy: 0, ParamNote: 0, ParamSweat: 0, ParamQ: 0, ParamAngry: 0, ParamTear: 0,
    /* 拖动摇摆：整体转角（度）/ 竖直拉伸（+ 拉长、− 压扁）/ 支点（uv）/ 双腿晃角（度）/ 转圈眼 */
    ParamSwing: 0, ParamStretch: 0, ParamSwingPX: 0.5, ParamSwingPY: 0.3, ParamLegR: 0, ParamLegL: 0, ParamDizzy: 0,
  };
  const base = { ...XH.DEF };
  const live = { ...XH.DEF, ...EXTRA };

  const state = {
    follow: true, blink: true, props: true, hide: {}, solo: null,
    pointer: { x: 0, y: 0, active: false },
    look: { x: 0, y: 0 },
    keyLook: { x: 0, y: 0 },
    drag: null, dragV: 0, dragTilt: 0,
    /* 拖动摇摆（见 stepSwing）：swing 档位 0 关 / 1 轻 / 2 正常 / 3 夸张 */
    swing: 2,
    talking: false, talkK: 0,
    sw: {
      a: 0, av: 0, st: 0, sv: 0, legR: 0, legRv: 0, legL: 0, legLv: 0,
      vx: 0, vy: 0, ax: 0, ay: 0, px: 0, py: 0, // 平滑后的拖动速度 / 加速度（px/s, px/s²）+ 本帧待处理位移
      pivX: 0.5, pivY: 0.3, lift: 0, stress: 0, acc: 0,
      flips: [], sx: 0, sy: 0, dizzy: false,
    },
    motion: null, prev: null, queue: [],
    sleep: 0, sleepTarget: 0,
    blinkT: 0, nextBlink: 2.5,
    nextIdle: 8, lastIdle: null, nextBig: 18, lastBig: null, idleFreq: 2, bubbles: true,
    /* 视线：眼 → 头 → 身体三级滞后；sacc = 眼球小跳动 */
    eye: { x: 0, y: 0 }, body: { x: 0, y: 0 },
    sacc: { x: 0, y: 0, t: 1.5 }, leaveT: 0,
    lastInput: performance.now(),
  };

  /* ---------- 动作：关键帧时间轴 ----------
     每条轨道 [[时间, 值, 缓动], ...]，缓动作用于“到达该关键帧”的那一段：
     io 缓入缓出（默认）/ o 缓出 / i 缓入 / b 回弹（过冲）/ l 线性。
     add：叠加到当前值（转头、身体、手等，轨道首尾都是 0）；set：覆盖（眼、嘴、脸红等，按权重混合）。
     原则：视线先动 → 头 → 身体滞后；动作前有反向预备，结束有过冲；关键时刻给辫子 / 下摆 / 呆毛一下推力。 */
  const EASE = {
    l: (x) => x,
    io: (x) => x * x * (3 - 2 * x),
    o: (x) => 1 - (1 - x) * (1 - x),
    i: (x) => x * x,
    b: (x) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; },
  };
  function track(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, e] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        const x = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        return v0 + (v1 - v0) * EASE[e || 'io'](x);
      }
    }
    return keys[keys.length - 1][1];
  }
  /* 区间包络：a→b 淡入，c→d 淡出 */
  const win = (t, a, b, c, d) => Math.min(ss(a, b, t), ss(d, c, t));
  /* 快速眨眼的关键帧片段（在 t0 时刻闭合） */
  const blinkAt = (t0, k = 0.05) => [[t0 - 0.09, 1], [t0, k, 'i'], [t0 + 0.04, k], [t0 + 0.17, 1, 'o']];

  const MOTIONS = {
    /* 打招呼：轻低头预备 → 抬头歪头 + 右手在胸前轻抬晃两下 → 点一下头 → 回位 */
    greet: {
      d: 2.6, msg: '你好呀，我是小嬅',
      add: {
        ParamAngleY: [[0, 0], [0.16, -5], [0.5, 5, 'b'], [1.05, 5], [1.25, -9], [1.5, 2, 'o'], [2.0, 0]],
        ParamAngleZ: [[0, 0], [0.18, -2], [0.55, 9, 'b'], [1.9, 7], [2.5, 0]],
        ParamAngleX: [[0, 0], [0.5, -5], [1.9, -4], [2.5, 0]],
        ParamBodyAngleZ: [[0, 0], [0.26, -1], [0.65, 3.5, 'b'], [1.95, 2.5], [2.6, 0]],
        ParamBodyY: [[0, 0], [0.16, -0.22], [0.42, 0.06, 'o'], [0.62, 0]],
        ParamHandRY: [[0, 0], [0.18, 0.15], [0.55, -0.85, 'b'], [1.7, -0.75], [2.25, 0]],
        ParamBrowRY: [[0, 0], [0.5, -4], [1.9, -3], [2.4, 0]],
        ParamBrowLY: [[0, 0], [0.5, -4], [1.9, -3], [2.4, 0]],
      },
      set: {
        ParamEyeLSmile: [[0, 0], [0.4, 0.8], [1.9, 0.8], [2.4, 0]],
        ParamEyeRSmile: [[0, 0], [0.4, 0.8], [1.9, 0.8], [2.4, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.45, 0.9], [1.9, 0.85], [2.4, 0.6]],
        ParamCheek: [[0, 0.6], [0.5, 0.78], [2.0, 0.78], [2.5, 0.6]],
      },
      fn: (t) => ({ add: { ParamHandRRot: Math.sin((t - 0.6) * 10) * 8 * win(t, 0.55, 0.7, 1.4, 1.65) } }),
      kick: [[0.5, { ahoge: 0.6, braidL: 0.35, braidR: 0.35, twig: 0.4 }], [1.25, { ahoge: -0.4 }]],
    },

    /* 摸摸头：被按一下（缩脖子、下蹲）→ 眯眼蹭两下 → 弹回 */
    tapHead: {
      d: 1.9, msg: '被摸头啦',
      add: {
        ParamAngleY: [[0, 0], [0.18, -9, 'o'], [1.35, -7], [1.65, 2, 'o'], [1.9, 0]],
        ParamBodyY: [[0, 0], [0.14, -0.35, 'o'], [0.5, -0.12], [1.4, -0.1], [1.62, 0.08, 'o'], [1.85, 0]],
        ParamHandRY: [[0, 0], [0.4, -0.2], [1.4, -0.2], [1.8, 0]],
        ParamHandLY: [[0, 0], [0.45, -0.2], [1.4, -0.2], [1.8, 0]],
        ParamBrowRY: [[0, 0], [0.2, 3], [1.4, 2], [1.8, 0]],
        ParamBrowLY: [[0, 0], [0.2, 3], [1.4, 2], [1.8, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.1, 0, 'i'], [1.4, 0], [1.75, 1]],
        ParamEyeROpen: [[0, 1], [0.1, 0, 'i'], [1.4, 0], [1.75, 1]],
        ParamEyeLSmile: [[0, 1], [1.9, 1]],
        ParamEyeRSmile: [[0, 1], [1.9, 1]],
        ParamMouthOpenY: [[0, 0.6], [0.2, 0.75], [1.4, 0.7], [1.8, 0.6]],
        ParamCheek: [[0, 0.6], [0.3, 0.9], [1.4, 0.9], [1.9, 0.6]],
      },
      fn: (t) => ({ add: { ParamAngleZ: Math.sin((t - 0.3) * 8.5) * 6 * win(t, 0.25, 0.45, 1.2, 1.45), ParamBodyAngleZ: Math.sin((t - 0.38) * 8.5) * 1.6 * win(t, 0.3, 0.5, 1.2, 1.5) } }),
      kick: [[0.02, { ahoge: 0.9, twig: 0.8, hood: 0.4, side: 0.3 }], [1.62, { ahoge: -0.5 }]],
    },

    /* 害羞：愣住 → 视线先躲、头再低下转开、揪紧斗篷耸肩 → 红晕 /// + 汗滴、偷看一眼马上躲 → 慢慢恢复（红晕最后退） */
    shy: {
      d: 2.9, msg: '呀……好害羞',
      add: {
        ParamBodyY: [[0, 0], [0.1, 0.12, 'o'], [0.26, 0], [0.7, -0.28], [2.0, -0.22], [2.6, 0]],
        ParamBrowRY: [[0, 0], [0.12, -6, 'o'], [0.55, 2], [2.0, 2], [2.6, 0]],
        ParamBrowLY: [[0, 0], [0.12, -6, 'o'], [0.55, 2], [2.0, 2], [2.6, 0]],
        ParamBrowAngle: [[0, 0], [0.6, 1], [2.1, 1], [2.7, 0]],
        ParamAngleX: [[0, 0], [0.32, 1], [0.78, -15, 'o'], [1.22, -15], [1.38, -10], [1.58, -10], [1.72, -16, 'o'], [2.05, -14], [2.7, 0]],
        ParamAngleY: [[0, 0], [0.15, 3], [0.36, 2], [0.8, -13, 'o'], [1.3, -12], [1.42, -9], [1.62, -9], [1.75, -13], [2.05, -12], [2.7, 0]],
        ParamAngleZ: [[0, 0], [0.4, 0], [0.82, -7], [2.05, -6], [2.7, 0]],
        ParamBodyAngleX: [[0, 0], [0.45, 0], [0.9, -3.5], [2.1, -3], [2.8, 0]],
        ParamHandRY: [[0, 0], [0.3, 0], [0.72, -0.4, 'b'], [2.05, -0.36], [2.65, 0]],
        ParamHandLY: [[0, 0], [0.33, 0], [0.76, -0.4, 'b'], [2.05, -0.36], [2.68, 0]],
        ParamHandRRot: [[0, 0], [0.3, 0], [0.72, 7], [2.05, 6], [2.65, 0]],
        ParamHandLRot: [[0, 0], [0.33, 0], [0.76, -7], [2.05, -6], [2.68, 0]],
      },
      set: {
        ParamEyeBallX: [[0, 0], [0.3, 0], [0.48, -0.85, 'o'], [1.22, -0.85], [1.32, 0.55, 'o'], [1.58, 0.55], [1.66, -0.9, 'o'], [2.1, -0.8], [2.6, 0]],
        ParamEyeBallY: [[0, 0], [0.3, -0.15], [0.5, 0.6, 'o'], [1.22, 0.6], [1.32, 0.05], [1.58, 0.05], [1.66, 0.65], [2.1, 0.55], [2.6, 0]],
        ParamEyeLOpen: [[0, 1], [0.3, 1], [0.6, 0.72], [1.22, 0.72], [1.3, 0.9], [1.6, 0.9], [1.7, 0.68], [2.1, 0.72], [2.6, 1]],
        ParamEyeROpen: [[0, 1], [0.3, 1], [0.6, 0.72], [1.22, 0.72], [1.3, 0.9], [1.6, 0.9], [1.7, 0.68], [2.1, 0.72], [2.6, 1]],
        ParamEyeLSmile: [[0, 0], [0.7, 0.25], [2.1, 0.25], [2.6, 0]],
        ParamEyeRSmile: [[0, 0], [0.7, 0.25], [2.1, 0.25], [2.6, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.14, 0.32, 'o'], [0.5, 0.25], [0.78, 0.02], [2.1, 0.02], [2.6, 0.6]],
        ParamMouthForm: [[0, 1], [0.15, 0.1], [2.1, 0.2], [2.6, 1]],
        ParamCheek: [[0, 0.6], [0.4, 0.7], [0.95, 1], [2.3, 1], [2.9, 0.6]],
        ParamCapeGrip: [[0, 0.5], [0.3, 0.5], [0.72, 1, 'b'], [2.05, 1], [2.65, 0.5]],
        ParamShy: [[0, 0], [0.75, 0], [1.1, 1], [2.3, 1], [2.85, 0]],
        ParamSweat: [[0, 0], [0.9, 0], [1.1, 1, 'o'], [1.95, 1], [2.25, 0]],
      },
      fn: (t) => ({ add: { ParamBodyAngleZ: Math.sin((t - 0.9) * 5.2) * 2.2 * win(t, 0.85, 1.1, 1.9, 2.3) } }),
      kick: [[0.08, { ahoge: 0.7 }], [0.75, { braidL: -0.3, braidR: -0.3, hem: -0.25, side: -0.3 }], [1.7, { ahoge: -0.35 }]],
    },

    /* 看云朵：眼睛先瞟过去 → 头转过去 → 身体跟上；云朵弹跳 */
    tapCloud: {
      d: 2.0, msg: '云朵也很开心',
      add: {
        ParamAngleX: [[0, 0], [0.12, -2], [0.5, 19, 'b'], [1.5, 17], [1.95, 0]],
        ParamAngleZ: [[0, 0], [0.55, 7], [1.5, 6], [1.95, 0]],
        ParamBodyAngleX: [[0, 0], [0.2, 0], [0.65, 4], [1.55, 3.5], [2.0, 0]],
      },
      set: {
        ParamEyeBallX: [[0, 0], [0.16, 0.95, 'o'], [1.45, 0.85], [1.85, 0]],
        ParamCloudFace: [[0, 0], [0.45, 1], [1.5, 1], [1.9, 0]],
        ParamEyeLSmile: [[0, 0], [0.5, 0.6], [1.5, 0.6], [1.9, 0]],
        ParamEyeRSmile: [[0, 0], [0.5, 0.6], [1.5, 0.6], [1.9, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.5, 0.8], [1.5, 0.8], [1.9, 0.6]],
      },
      fn: (t) => ({ add: { ParamCloudFloat: -Math.abs(Math.sin((t - 0.4) * 7)) * win(t, 0.35, 0.5, 1.4, 1.7) } }),
      kick: [[0.5, { side: 0.4, braidL: 0.3, braidR: 0.3 }]],
    },

    /* 点头：下巴先微抬 → 点两下（第二下更轻）→ 眨一下眼 */
    nod: {
      d: 1.5, msg: '嗯嗯！',
      add: {
        ParamAngleY: [[0, 0], [0.15, 4], [0.4, -13, 'i'], [0.6, 2, 'o'], [0.8, -7, 'i'], [1.0, 1, 'o'], [1.3, 0]],
        ParamBodyY: [[0, 0], [0.45, -0.16], [0.65, 0], [0.85, -0.08], [1.05, 0]],
        ParamAngleZ: [[0, 0], [0.4, 3], [1.3, 0]],
      },
      set: {
        ParamEyeLOpen: blinkAt(0.42),
        ParamEyeROpen: blinkAt(0.42),
        ParamEyeLSmile: [[0, 0], [0.3, 0.5], [1.1, 0.5], [1.45, 0]],
        ParamEyeRSmile: [[0, 0], [0.3, 0.5], [1.1, 0.5], [1.45, 0]],
      },
      kick: [[0.4, { ahoge: 0.6, hood: 0.3 }], [0.8, { ahoge: 0.35 }]],
    },

    /* 歪头疑惑：头歪、身体反向一点 → 眼珠往上 → 单边挑眉 + 小 o 嘴 + 问号 */
    tilt: {
      d: 2.3, msg: '诶？',
      add: {
        ParamAngleZ: [[0, 0], [0.12, -2], [0.48, 15, 'b'], [1.7, 13], [2.2, 0]],
        ParamAngleX: [[0, 0], [0.5, 6], [1.7, 5], [2.2, 0]],
        ParamBodyAngleZ: [[0, 0], [0.2, 0], [0.6, -3, 'b'], [1.75, -2.5], [2.25, 0]],
        ParamBrowRY: [[0, 0], [0.42, -7, 'b'], [1.7, -6], [2.1, 0]],
        ParamBrowLY: [[0, 0], [0.42, 2], [1.7, 2], [2.1, 0]],
      },
      set: {
        ParamEyeBallX: [[0, 0], [0.25, 0.35, 'o'], [1.65, 0.3], [2.05, 0]],
        ParamEyeBallY: [[0, 0], [0.25, -0.7, 'o'], [1.65, -0.6], [2.05, 0]],
        ParamEyeLOpen: [[0, 1], ...blinkAt(1.15)],
        ParamEyeROpen: [[0, 1], ...blinkAt(1.15)],
        ParamMouthOpenY: [[0, 0.6], [0.4, 0.14], [1.7, 0.14], [2.15, 0.6]],
        ParamMouthForm: [[0, 1], [0.4, 0], [1.7, 0], [2.15, 1]],
        ParamQ: [[0, 0], [0.4, 0], [0.6, 1, 'b'], [1.75, 1], [2.05, 0]],
      },
      kick: [[0.48, { braidL: 0.45, braidR: 0.45, side: 0.5, ahoge: 0.5, hood: 0.4 }]],
    },

    /* 东张西望：视线先到、头随后、身体最后；换方向时眨眼 */
    look: {
      d: 3.0, msg: '那边有什么？',
      add: {
        ParamAngleX: [[0, 0], [0.18, 0], [0.62, -22, 'o'], [1.12, -21], [1.68, 21, 'io'], [2.15, 20], [2.75, 0]],
        ParamAngleZ: [[0, 0], [0.62, -4], [1.12, -4], [1.68, 4], [2.15, 4], [2.75, 0]],
        ParamAngleY: [[0, 0], [0.62, 3], [1.4, -2], [1.68, 3], [2.75, 0]],
        ParamBodyAngleX: [[0, 0], [0.3, 0], [0.78, -6], [1.2, -6], [1.85, 6], [2.25, 6], [2.95, 0]],
      },
      set: {
        ParamEyeBallX: [[0, 0], [0.24, -1, 'o'], [1.1, -0.9], [1.3, 1, 'o'], [2.1, 0.9], [2.4, 0], [3.0, 0]],
        ParamEyeBallY: [[0, 0], [0.24, -0.2], [2.4, -0.2], [2.7, 0]],
        ParamEyeLOpen: [[0, 1], ...blinkAt(1.22)],
        ParamEyeROpen: [[0, 1], ...blinkAt(1.22)],
        ParamMouthOpenY: [[0, 0.6], [0.5, 0.25], [2.4, 0.25], [2.9, 0.6]],
      },
      kick: [[0.6, { braidL: -0.4, braidR: -0.4, side: -0.5, ahoge: -0.4 }], [1.68, { braidL: 0.6, braidR: 0.6, side: 0.6, ahoge: 0.5, hood: 0.4 }]],
    },

    /* 开心小跳：下蹲预备 → 起跳（双手上扬、下摆滞后）→ 落地压低 → 回弹 */
    hop: {
      d: 1.6, msg: '耶！',
      add: {
        ParamBodyY: [[0, 0], [0.24, -0.6], [0.5, 0.95, 'o'], [0.72, 0, 'i'], [0.82, -0.45, 'o'], [1.0, 0.08, 'o'], [1.18, 0]],
        ParamHemLift: [[0, 0], [0.3, -0.3], [0.45, 0.85], [0.6, 0.3], [0.74, -0.9], [0.92, 0.35], [1.15, -0.1], [1.4, 0]],
        ParamAngleY: [[0, 0], [0.24, -7], [0.5, 8, 'o'], [0.82, -5], [1.12, 0]],
        ParamHandRY: [[0, 0], [0.24, 0.2], [0.5, -0.65, 'b'], [0.82, 0.15], [1.15, 0]],
        ParamHandLY: [[0, 0], [0.26, 0.2], [0.52, -0.65, 'b'], [0.84, 0.15], [1.17, 0]],
        ParamHandRRot: [[0, 0], [0.5, -6], [0.85, 0], [1.1, 0]],
        ParamHandLRot: [[0, 0], [0.52, 6], [0.87, 0], [1.1, 0]],
        ParamBrowRY: [[0, 0], [0.5, -5], [1.2, 0]],
        ParamBrowLY: [[0, 0], [0.5, -5], [1.2, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.24, 0.6], [0.4, 0, 'i'], [1.15, 0], [1.45, 1]],
        ParamEyeROpen: [[0, 1], [0.24, 0.6], [0.4, 0, 'i'], [1.15, 0], [1.45, 1]],
        ParamEyeLSmile: [[0, 0], [0.3, 1], [1.4, 1], [1.6, 0]],
        ParamEyeRSmile: [[0, 0], [0.3, 1], [1.4, 1], [1.6, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.24, 0.4], [0.5, 1, 'o'], [1.2, 0.85], [1.55, 0.6]],
        ParamCheek: [[0, 0.6], [0.5, 0.85], [1.3, 0.85], [1.6, 0.6]],
      },
      kick: [[0.5, { hem: 0.55, skirt: 0.7, braidL: 0.5, braidR: -0.5, ahoge: 0.9, twig: 0.5, hood: 0.5, side: 0.5 }], [0.82, { hem: -0.5, skirt: -0.6, braidL: -0.45, braidR: 0.45, ahoge: -0.7, hood: -0.4 }]],
    },

    /* 挥手（胸前小幅）：手先下沉预备 → 右拳抬到胸前回弹 → 绕肘左右摆 3 下（第 1 下最大）
       → 头偏向挥手一侧、身体轻跟 → 放下 */
    wave: {
      d: 2.6, msg: '拜拜～',
      add: {
        ParamHandRY: [[0, 0], [0.12, 0.2], [0.42, -0.95, 'b'], [1.95, -0.85], [2.4, 0, 'o']],
        ParamHandLY: [[0, 0], [0.3, 0], [0.6, -0.15], [1.9, -0.12], [2.35, 0]],
        ParamAngleZ: [[0, 0], [0.55, -6, 'b'], [2.1, -5], [2.7, 0]],
        ParamAngleX: [[0, 0], [0.55, -7], [2.1, -6], [2.7, 0]],
        ParamAngleY: [[0, 0], [0.15, -3], [0.6, 4, 'o'], [2.1, 3], [2.7, 0]],
        ParamBodyAngleZ: [[0, 0], [0.2, 0], [0.65, 3, 'b'], [2.15, 2.5], [2.8, 0]],
        ParamBodyAngleX: [[0, 0], [0.65, -2], [2.15, -1.6], [2.8, 0]],
        ParamBodyY: [[0, 0], [0.14, -0.15], [0.5, 0.05, 'o'], [0.7, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.4, 0, 'i'], [1.95, 0], [2.35, 1]],
        ParamEyeROpen: [[0, 1], [0.4, 0, 'i'], [1.95, 0], [2.35, 1]],
        ParamEyeLSmile: [[0, 1], [2.6, 1]],
        ParamEyeRSmile: [[0, 1], [2.6, 1]],
        ParamMouthOpenY: [[0, 0.6], [0.5, 0.95], [2.0, 0.9], [2.5, 0.6]],
        ParamCheek: [[0, 0.6], [0.6, 0.8], [2.1, 0.8], [2.6, 0.6]],
      },
      fn: (t) => {
        const w = win(t, 0.45, 0.6, 1.75, 1.98), ph = (t - 0.5) * 10.5;
        const amp = 1 - 0.35 * ss(0.7, 1.8, t);
        return { add: { ParamHandRRot: Math.sin(ph) * 13 * w * amp, ParamAngleZ: Math.sin(ph - 0.9) * 1.4 * w, ParamBodyAngleZ: Math.sin(ph - 1.4) * 0.6 * w } };
      },
      kick: [[0.45, { braidR: -0.35, braidL: -0.25, side: -0.35, ahoge: -0.5, hood: -0.25 }], [2.3, { ahoge: 0.4, side: 0.3 }]],
    },

    /* 打哈欠：吸气抬头、嘴慢慢张大、眼睛眯紧、伸展双手 → 闭嘴、泪花 → 回神 */
    yawn: {
      d: 3.0, msg: '哈——啊……',
      add: {
        ParamAngleY: [[0, 0], [0.3, -3], [1.05, 11], [1.7, 10], [2.2, -3], [2.7, 0]],
        ParamAngleZ: [[0, 0], [1.05, 6], [1.7, 6], [2.4, 0]],
        ParamBreath: [[0, 0], [1.05, 0.75], [1.7, 0.7], [2.3, -0.2], [2.8, 0]],
        ParamHandRY: [[0, 0], [0.4, 0], [1.05, -0.5], [1.7, -0.45], [2.25, 0]],
        ParamHandLY: [[0, 0], [0.45, 0], [1.1, -0.5], [1.7, -0.45], [2.3, 0]],
        ParamHandRRot: [[0, 0], [1.05, -8], [1.7, -8], [2.25, 0]],
        ParamHandLRot: [[0, 0], [1.1, 8], [1.7, 8], [2.3, 0]],
        ParamBrowAngle: [[0, 0], [1.0, 0.7], [1.75, 0.7], [2.3, 0]],
        ParamBrowRY: [[0, 0], [1.0, -3], [1.75, -3], [2.3, 0]],
        ParamBrowLY: [[0, 0], [1.0, -3], [1.75, -3], [2.3, 0]],
      },
      set: {
        ParamMouthOpenY: [[0, 0.6], [0.3, 0.35], [1.05, 1], [1.7, 1], [2.1, 0.02], [2.5, 0.02], [2.95, 0.6]],
        ParamMouthForm: [[0, 1], [1.0, 0.25], [1.7, 0.25], [2.1, 0.6], [2.9, 1]],
        ParamEyeLOpen: [[0, 1], [0.6, 0.5], [1.15, 0, 'i'], [1.85, 0], [2.25, 0.55], [2.45, 0.55], [2.85, 1]],
        ParamEyeROpen: [[0, 1], [0.6, 0.5], [1.15, 0, 'i'], [1.85, 0], [2.25, 0.55], [2.45, 0.55], [2.85, 1]],
        ParamTear: [[0, 0], [1.5, 0], [1.85, 1, 'o'], [2.45, 1], [2.85, 0]],
      },
      kick: [[1.05, { hood: -0.3, ahoge: -0.4 }], [2.2, { ahoge: 0.4 }]],
    },

    /* 生气鼓脸：小跺脚 → 倒八字眉、闭嘴鼓腮 → “哼”地把头扭开，眼睛还偷瞄你 */
    angry: {
      d: 2.5, msg: '哼！',
      add: {
        ParamBodyY: [[0, 0], [0.1, 0.1, 'o'], [0.2, -0.38, 'i'], [0.38, 0, 'o']],
        ParamBrowAngle: [[0, 0], [0.25, -1, 'b'], [2.0, -1], [2.45, 0]],
        ParamBrowRY: [[0, 0], [0.25, 4], [2.0, 4], [2.45, 0]],
        ParamBrowLY: [[0, 0], [0.25, 4], [2.0, 4], [2.45, 0]],
        ParamPuff: [[0, 0], [0.2, 0], [0.38, 1, 'b'], [1.95, 1], [2.3, 0]],
        ParamAngleX: [[0, 0], [0.32, -3], [0.62, 17, 'b'], [1.95, 15], [2.45, 0]],
        ParamAngleY: [[0, 0], [0.62, 5], [1.95, 4], [2.45, 0]],
        ParamAngleZ: [[0, 0], [0.62, 6], [1.95, 5], [2.45, 0]],
        ParamBodyAngleX: [[0, 0], [0.42, 0], [0.75, 4.5], [2.0, 4], [2.5, 0]],
        ParamHandRY: [[0, 0], [0.12, -0.15], [0.22, 0.3, 'i'], [2.0, 0.25], [2.4, 0]],
        ParamHandLY: [[0, 0], [0.12, -0.15], [0.22, 0.3, 'i'], [2.0, 0.25], [2.4, 0]],
      },
      set: {
        ParamMouthOpenY: [[0, 0.6], [0.2, 0.02], [2.05, 0.02], [2.45, 0.6]],
        ParamMouthForm: [[0, 1], [0.2, 0], [2.05, 0], [2.45, 1]],
        ParamEyeLOpen: [[0, 1], [0.25, 0.78], [2.0, 0.78], [2.4, 1]],
        ParamEyeROpen: [[0, 1], [0.25, 0.78], [2.0, 0.78], [2.4, 1]],
        ParamEyeBallX: [[0, 0], [0.62, 0], [0.95, -0.7, 'o'], [1.95, -0.6], [2.35, 0]],
        ParamCheek: [[0, 0.6], [0.35, 0.95], [2.05, 0.95], [2.5, 0.6]],
        ParamAngry: [[0, 0], [0.25, 0], [0.45, 1, 'b'], [1.9, 1], [2.2, 0]],
      },
      fn: (t) => ({ add: { ParamAngleZ: Math.sin(t * 34) * 1.4 * win(t, 0.36, 0.42, 0.62, 0.8) } }),
      kick: [[0.2, { hem: 0.45, skirt: 0.55, braidL: -0.3, braidR: 0.3, ahoge: 0.8 }], [0.62, { braidL: 0.55, braidR: 0.55, side: 0.6, hood: 0.45, twig: 0.4 }]],
    },

    drop: {
      d: 0.9,
      add: { ParamBodyY: [[0, 0], [0.1, -0.4, 'o'], [0.32, 0.06, 'o'], [0.55, 0]], ParamAngleY: [[0, 0], [0.1, -8, 'o'], [0.5, 1], [0.8, 0]] },
      set: { ParamEyeLOpen: blinkAt(0.12, 0.2), ParamEyeROpen: blinkAt(0.12, 0.2) },
      kick: [[0.02, { hem: 0.7, skirt: 0.6, braidL: 0.5, braidR: -0.5, ahoge: 0.6 }]],
    },
    /* 头晕（被来回甩太猛后松手）：转圈眼 → 落地一顿 → 摇摇头、身体晃两下 → 回神眨眼 */
    dizzy: {
      d: 2.4, msg: '晕乎乎…',
      add: {
        ParamBodyY: [[0, 0], [0.1, -0.35, 'o'], [0.32, 0.05, 'o'], [0.55, 0]],
        ParamBrowRY: [[0, 0], [0.3, 3], [1.8, 3], [2.3, 0]], ParamBrowLY: [[0, 0], [0.3, 3], [1.8, 3], [2.3, 0]],
      },
      set: {
        ParamDizzy: [[0, 1], [1.6, 1], [1.95, 0]],
        ParamBrowAngle: [[0, 0], [0.3, 0.8], [1.8, 0.8], [2.3, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.3, 0.75], [1.8, 0.7], [2.3, 0.6]],
        ParamMouthForm: [[0, 1], [0.3, -0.4], [1.8, -0.4], [2.3, 1]],
        ParamSweat: [[0, 0], [0.3, 1, 'o'], [1.7, 1], [2.1, 0]],
        ParamEyeLOpen: [[0, 1], ...blinkAt(2.05)], ParamEyeROpen: [[0, 1], ...blinkAt(2.05)],
      },
      /* 摇头：频率由快到慢、幅度衰减；身体反相小晃 */
      fn: (t) => {
        const w = win(t, 0.25, 0.4, 1.5, 1.9), ph = t * (11 - t * 2.5);
        return { add: { ParamAngleX: Math.sin(ph) * 14 * w, ParamAngleZ: Math.sin(ph * 0.5 + 1) * 7 * w, ParamBodyAngleZ: -Math.sin(ph * 0.5) * 3 * w } };
      },
      kick: [[0.02, { hem: 0.6, skirt: 0.5, braidL: 0.4, braidR: -0.4, ahoge: 0.6 }], [0.6, { braidL: 0.4, braidR: 0.4, ahoge: -0.7 }], [1.1, { braidL: -0.35, braidR: -0.35, ahoge: 0.6 }]],
    },
    wake: {
      d: 1.6, msg: '醒啦',
      add: { ParamAngleY: [[0, 0], [0.5, 12, 'o'], [1.1, 5], [1.6, 0]], ParamBreath: [[0, 0], [0.5, 0.6], [1.6, 0]], ParamBodyY: [[0, 0], [0.45, 0.08], [0.8, 0]] },
      set: {
        ParamCapeGrip: [[0, 0.5], [0.5, 0], [1.5, 0.5]],
        ParamEyeLOpen: [[0, 0.2], [0.5, 0.2], [0.7, 1], ...blinkAt(1.05)],
        ParamEyeROpen: [[0, 0.2], [0.5, 0.2], [0.7, 1], ...blinkAt(1.05)],
      },
      kick: [[0.45, { ahoge: 0.8 }]],
    },
  };
  /* 待机小动作（idle：不弹提示、不打断视线跟随、幅度约为正式动作的一半以内） */
  Object.assign(MOTIONS, {
    idleBlink2: {
      d: 0.75, idle: 1,
      set: { ParamEyeLOpen: [[0, 1], ...blinkAt(0.12), ...blinkAt(0.45)], ParamEyeROpen: [[0, 1], ...blinkAt(0.12), ...blinkAt(0.45)] },
    },
    idleGlance: {
      d: 2.2, idle: 1,
      add: { ParamAngleX: [[0, 0], [0.25, 0], [0.6, -12, 'o'], [1.5, -11], [2.0, 0]], ParamAngleY: [[0, 0], [0.6, -3], [1.5, -2], [2.0, 0]] },
      set: { ParamEyeBallX: [[0, 0], [0.12, -0.8, 'o'], [1.45, -0.75], [1.7, 0]], ParamEyeLOpen: blinkAt(1.5), ParamEyeROpen: blinkAt(1.5) },
    },
    idleTilt: {
      d: 1.8, idle: 1,
      add: { ParamAngleZ: [[0, 0], [0.45, 9, 'b'], [1.2, 8], [1.75, 0]], ParamBodyAngleZ: [[0, 0], [0.55, -2], [1.25, -1.7], [1.8, 0]] },
      set: { ParamEyeLSmile: [[0, 0], [0.4, 0.35], [1.2, 0.35], [1.7, 0]], ParamEyeRSmile: [[0, 0], [0.4, 0.35], [1.2, 0.35], [1.7, 0]] },
      kick: [[0.45, { braidL: 0.2, braidR: 0.2, ahoge: 0.25 }]],
    },
    idleSway: {
      d: 2.6, idle: 1,
      add: {
        ParamBodyAngleZ: [[0, 0], [0.6, 3.6], [1.3, -3.2], [2.0, 1.4], [2.6, 0]],
        ParamAngleZ: [[0, 0], [0.75, -3.5], [1.45, 3.5], [2.15, -1.2], [2.6, 0]],
        ParamBodyY: [[0, 0], [0.6, -0.06], [0.95, 0], [1.3, -0.06], [1.65, 0]],
      },
      kick: [[0.6, { hem: 0.2, skirt: 0.2 }], [1.3, { hem: -0.2, skirt: -0.2 }]],
    },
    idleBreath: {
      d: 2.4, idle: 1,
      add: {
        ParamBreath: [[0, 0], [0.9, 0.7], [1.3, 0.65], [2.0, -0.15], [2.4, 0]],
        ParamAngleY: [[0, 0], [0.9, 6], [1.3, 6], [2.0, -2], [2.4, 0]],
        ParamHandRY: [[0, 0], [0.9, -0.12], [1.9, 0]], ParamHandLY: [[0, 0], [0.95, -0.12], [1.95, 0]],
      },
      set: { ParamEyeLOpen: [[0, 1], [0.9, 0.7], [1.3, 0.7], [1.8, 1]], ParamEyeROpen: [[0, 1], [0.9, 0.7], [1.3, 0.7], [1.8, 1]] },
    },
    /* 哼歌：眯眼笑、左右摇摆 4 拍（头和身体反相），头边飘音符 ♪（ParamNote → drawFx） */
    hum: {
      d: 4.2, msg: '♪～',
      add: {
        ParamBrowRY: [[0, 0], [0.4, -3], [3.6, -3], [4.1, 0]],
        ParamBrowLY: [[0, 0], [0.4, -3], [3.6, -3], [4.1, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.35, 0, 'i'], [3.6, 0], [4.0, 1]],
        ParamEyeROpen: [[0, 1], [0.35, 0, 'i'], [3.6, 0], [4.0, 1]],
        ParamEyeLSmile: [[0, 0], [0.3, 1], [3.7, 1], [4.1, 0]],
        ParamEyeRSmile: [[0, 0], [0.3, 1], [3.7, 1], [4.1, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.4, 0.3], [3.6, 0.3], [4.1, 0.6]],
        ParamCheek: [[0, 0.6], [0.5, 0.8], [3.6, 0.8], [4.2, 0.6]],
        ParamNote: [[0, 0], [0.4, 1, 'o'], [3.5, 1], [4.0, 0]],
      },
      fn: (t) => {
        const w = win(t, 0.3, 0.7, 3.3, 3.9), ph = (t - 0.3) * Math.PI * 1.25;
        return {
          add: {
            ParamAngleZ: Math.sin(ph) * 9 * w, ParamBodyAngleZ: -Math.sin(ph - 0.5) * 3 * w,
            ParamAngleY: Math.abs(Math.sin(ph)) * 3 * w, ParamBodyY: -Math.abs(Math.sin(ph)) * 0.08 * w,
            ParamHandRY: -Math.max(0, Math.sin(ph)) * 0.2 * w, ParamHandLY: -Math.max(0, -Math.sin(ph)) * 0.2 * w,
          },
          set: { ParamMouthOpenY: 0.3 + Math.abs(Math.sin(t * 6.3)) * 0.25 * w },
        };
      },
      kick: [[0.9, { braidL: 0.3, braidR: 0.3, ahoge: 0.3 }], [1.7, { braidL: -0.3, braidR: -0.3, ahoge: -0.3 }], [2.5, { braidL: 0.3, braidR: 0.3 }], [3.3, { braidL: -0.3, braidR: -0.3 }]],
    },
    /* 发呆：眼神放空、半睁眼、头慢慢下沉 → 猛地回神（眨眼 + 呆毛弹）→ 不好意思地笑 */
    daze: {
      d: 4.0, msg: '发呆中…',
      add: {
        ParamAngleY: [[0, 0], [0.8, -4], [2.6, -7], [2.75, 4, 'o'], [3.2, 1], [3.8, 0]],
        ParamAngleZ: [[0, 0], [1.2, 4], [2.6, 6], [2.8, -1, 'o'], [3.8, 0]],
        ParamBodyY: [[0, 0], [2.6, -0.12], [2.75, 0.08, 'o'], [3.1, 0]],
        ParamBrowRY: [[0, 0], [1, 2], [2.6, 2], [2.75, -6, 'o'], [3.4, -2], [3.9, 0]],
        ParamBrowLY: [[0, 0], [1, 2], [2.6, 2], [2.75, -6, 'o'], [3.4, -2], [3.9, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.8, 0.55], [2.6, 0.45], [2.66, 0.05, 'i'], [2.72, 0.05], [2.85, 1.0, 'o']],
        ParamEyeROpen: [[0, 1], [0.8, 0.55], [2.6, 0.45], [2.66, 0.05, 'i'], [2.72, 0.05], [2.85, 1.0, 'o']],
        ParamEyeBallY: [[0, 0], [0.8, 0.35], [2.6, 0.4], [2.8, 0]],
        ParamMouthOpenY: [[0, 0.6], [1.0, 0.25], [2.6, 0.3], [2.75, 0.75], [3.3, 0.7], [3.9, 0.6]],
        ParamMouthForm: [[0, 1], [1.0, 0.5], [2.6, 0.5], [2.8, 1]],
        ParamEyeLSmile: [[0, 0], [2.9, 0], [3.2, 0.6], [3.7, 0.6], [4.0, 0]],
        ParamEyeRSmile: [[0, 0], [2.9, 0], [3.2, 0.6], [3.7, 0.6], [4.0, 0]],
        ParamSweat: [[0, 0], [2.75, 0], [2.9, 1, 'o'], [3.5, 1], [3.8, 0]],
      },
      look: 0.15, // 发呆时视线跟随减弱（眼神放空）
      kick: [[2.7, { ahoge: 1.0, twig: 0.5, braidL: 0.3, braidR: 0.3, hood: 0.3 }]],
    },
    /* 偷看你：眼睛先瞟向光标 → 头再转过去 → 被发现，眯眼笑一下 */
    peek: {
      d: 2.6, msg: '看到你啦',
      look: 1.6, // 视线跟随加强：明确地“看过来”
      add: {
        ParamAngleZ: [[0, 0], [0.5, 0], [0.9, 7, 'b'], [2.0, 6], [2.5, 0]],
        ParamBrowRY: [[0, 0], [0.9, -4], [2.0, -3], [2.5, 0]],
        ParamBrowLY: [[0, 0], [0.9, -4], [2.0, -3], [2.5, 0]],
        ParamBodyY: [[0, 0], [0.85, -0.1], [1.05, 0.04, 'o'], [1.3, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.2, 0.75], [0.7, 0.75], ...blinkAt(0.85).slice(1)],
        ParamEyeROpen: [[0, 1], [0.2, 0.75], [0.7, 0.75], ...blinkAt(0.85).slice(1)],
        ParamEyeLSmile: [[0, 0], [0.95, 0], [1.2, 0.9], [2.0, 0.9], [2.45, 0]],
        ParamEyeRSmile: [[0, 0], [0.95, 0], [1.2, 0.9], [2.0, 0.9], [2.45, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.6, 0.3], [1.1, 0.85], [2.0, 0.8], [2.5, 0.6]],
        ParamCheek: [[0, 0.6], [1.0, 0.85], [2.1, 0.85], [2.6, 0.6]],
      },
      kick: [[0.9, { ahoge: 0.6, braidL: 0.3, braidR: 0.3 }]],
    },
    /* 思考（等对话回复）：眼睛往上瞟、歪头、右手抬到下巴附近，轻轻晃 */
    think: {
      d: 2.6, idle: 1, look: 0.2,
      add: {
        ParamAngleZ: [[0, 0], [0.4, 8, 'o'], [2.1, 7], [2.6, 0]],
        ParamAngleY: [[0, 0], [0.4, 4], [2.1, 3], [2.6, 0]],
        ParamHandRY: [[0, 0], [0.4, -0.35, 'o'], [2.1, -0.32], [2.6, 0]], ParamHandRRot: [[0, 0], [0.4, -8], [2.1, -8], [2.6, 0]],
        ParamBrowRY: [[0, 0], [0.4, -2], [2.1, -2], [2.6, 0]],
      },
      set: {
        ParamEyeBallX: [[0, 0], [0.3, 0.45], [2.2, 0.4], [2.5, 0]], ParamEyeBallY: [[0, 0], [0.3, -0.6], [2.2, -0.55], [2.5, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.4, 0.15], [2.2, 0.15], [2.6, 0.6]], ParamMouthForm: [[0, 1], [0.4, 0.3], [2.2, 0.3], [2.6, 1]],
      },
      fn: (t) => ({ add: { ParamAngleZ: Math.sin(t * 2.4) * 1.5 * win(t, 0.4, 0.8, 1.8, 2.2) } }),
      kick: [[0.4, { ahoge: 0.35, braidL: 0.2, braidR: 0.2 }]],
    },
    /* 开心（对话情绪 [开心]）：眯眼笑 + 小幅弹一下 */
    happy: {
      d: 1.5,
      add: { ParamBodyY: [[0, 0], [0.15, -0.12], [0.4, 0.1, 'o'], [0.7, 0]], ParamAngleZ: [[0, 0], [0.4, -6, 'b'], [1.1, -5], [1.5, 0]] },
      set: {
        ParamEyeLSmile: [[0, 0], [0.25, 1], [1.1, 1], [1.45, 0]], ParamEyeRSmile: [[0, 0], [0.25, 1], [1.1, 1], [1.45, 0]],
        ParamEyeLOpen: [[0, 1], [0.25, 0], [1.1, 0], [1.4, 1]], ParamEyeROpen: [[0, 1], [0.25, 0], [1.1, 0], [1.4, 1]],
        ParamMouthOpenY: [[0, 0.6], [0.3, 0.9], [1.1, 0.85], [1.5, 0.6]], ParamCheek: [[0, 0.6], [0.3, 0.9], [1.1, 0.9], [1.5, 0.6]],
      },
      kick: [[0.4, { ahoge: 0.6, braidL: 0.35, braidR: -0.35, hem: 0.3 }]],
    },
    /* 动作收尾余韵：头轻点一下 + 呆毛弹一下 */
    settle: {
      d: 0.55, idle: 1,
      add: { ParamAngleY: [[0, 0], [0.16, -2.5, 'o'], [0.38, 0.6], [0.55, 0]] },
      kick: [[0.02, { ahoge: 0.3 }]],
    },
  });
  /* 表情扩充：挑眉 / 皱眉 / 担心 / 星星眼 / 嘟嘴 / 猫嘴 / 得意 / 无聊 */
  Object.assign(MOTIONS, {
    browRaise: {
      d: 1.7, msg: '嗯？',
      add: {
        ParamBrowRY: [[0, 0], [0.18, -10, 'o'], [1.15, -9], [1.55, 0]],
        ParamBrowLY: [[0, 0], [0.18, -10, 'o'], [1.15, -9], [1.55, 0]],
        ParamAngleY: [[0, 0], [0.2, 2], [1.15, 1], [1.6, 0]],
        ParamAngleZ: [[0, 0], [0.2, -2], [1.15, -1.5], [1.6, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.2, 0.9], [1.15, 0.9], [1.55, 1]],
        ParamEyeROpen: [[0, 1], [0.2, 0.9], [1.15, 0.9], [1.55, 1]],
        ParamMouthOpenY: [[0, 0.6], [0.2, 0.5], [1.15, 0.5], [1.6, 0.6]],
        ParamMouthSmile: [[0, 0], [0.2, 0.35], [1.1, 0.35], [1.45, 0]],
        ParamEyeSpark: [[0, 0], [0.3, 0.35], [1.0, 0.3], [1.35, 0]],
      },
      kick: [[0.18, { ahoge: 0.45, twig: 0.25 }]],
    },
    frown: {
      d: 2.0, msg: '唔…',
      add: {
        ParamBrowRY: [[0, 0], [0.22, 4], [1.4, 4], [1.8, 0]],
        ParamBrowLY: [[0, 0], [0.22, 4], [1.4, 4], [1.8, 0]],
        ParamBrowAngle: [[0, 0], [0.22, -0.7], [1.4, -0.7], [1.8, 0]],
        ParamAngleY: [[0, 0], [0.3, -2], [1.5, -1], [1.9, 0]],
        ParamAngleZ: [[0, 0], [0.3, -4], [1.5, -3], [1.9, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.25, 0.82], [1.45, 0.82], [1.85, 1]],
        ParamEyeROpen: [[0, 1], [0.25, 0.82], [1.45, 0.82], [1.85, 1]],
        ParamMouthOpenY: [[0, 0.6], [0.25, 0.02], [1.5, 0.02], [1.9, 0.6]],
        ParamMouthPout: [[0, 0], [0.25, 1], [1.45, 1], [1.8, 0]],
        ParamBlush: [[0, 0], [0.4, 0.15], [1.5, 0.15], [1.85, 0]],
      },
      kick: [[0.22, { ahoge: -0.35, braidL: -0.2, braidR: 0.2 }]],
    },
    worried: {
      d: 2.4, msg: '有点担心…',
      add: {
        ParamBrowAngle: [[0, 0], [0.25, 0.55], [1.8, 0.55], [2.2, 0]],
        ParamBrowRY: [[0, 0], [0.25, -3], [1.8, -3], [2.2, 0]],
        ParamBrowLY: [[0, 0], [0.25, -3], [1.8, -3], [2.2, 0]],
        ParamAngleZ: [[0, 0], [0.35, 6], [1.9, 5], [2.3, 0]],
        ParamBodyY: [[0, 0], [0.35, -0.08], [1.9, -0.06], [2.3, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.3, 0.72], [1.9, 0.72], [2.3, 1]],
        ParamEyeROpen: [[0, 1], [0.3, 0.72], [1.9, 0.72], [2.3, 1]],
        ParamEyeBallY: [[0, 0], [0.3, 0.2], [1.9, 0.15], [2.3, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.3, 0.02], [1.95, 0.02], [2.35, 0.6]],
        ParamMouthWavy: [[0, 0], [0.3, 1], [1.9, 1], [2.25, 0]],
        ParamBlush: [[0, 0], [0.45, 0.25], [1.9, 0.25], [2.3, 0]],
        ParamSweat: [[0, 0], [1.2, 0], [1.6, 0.7], [2.1, 0]],
      },
      kick: [[0.35, { ahoge: 0.3, braidL: 0.2, braidR: 0.2 }]],
    },
    sparkle: {
      d: 2.2, msg: '哇…',
      add: {
        ParamBodyY: [[0, 0], [0.18, -0.16], [0.45, 0.08, 'o'], [0.8, 0]],
        ParamAngleZ: [[0, 0], [0.35, -7, 'b'], [1.5, -6], [2.1, 0]],
        ParamAngleY: [[0, 0], [0.35, 3], [1.5, 2], [2.1, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.3, 0.9], [1.7, 0.9], [2.1, 1]],
        ParamEyeROpen: [[0, 1], [0.3, 0.9], [1.7, 0.9], [2.1, 1]],
        ParamEyeLSmile: [[0, 0], [0.3, 0.3], [1.7, 0.3], [2.1, 0]],
        ParamEyeRSmile: [[0, 0], [0.3, 0.3], [1.7, 0.3], [2.1, 0]],
        ParamEyeSpark: [[0, 0], [0.25, 1, 'o'], [1.75, 1], [2.15, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.3, 0.02], [1.8, 0.02], [2.2, 0.6]],
        ParamMouthSmile: [[0, 0], [0.3, 1], [1.75, 1], [2.1, 0]],
        ParamCheek: [[0, 0.6], [0.4, 0.95], [1.8, 0.95], [2.2, 0.6]],
        ParamBlush: [[0, 0], [0.4, 0.7], [1.8, 0.7], [2.15, 0]],
      },
      kick: [[0.25, { ahoge: 0.7, braidL: 0.35, braidR: -0.35, hem: 0.3 }]],
    },
    pout: {
      d: 2.0, msg: '哼…',
      add: {
        ParamAngleX: [[0, 0], [0.3, -10], [1.4, -9], [1.9, 0]],
        ParamAngleZ: [[0, 0], [0.3, -5], [1.4, -4], [1.9, 0]],
        ParamBodyY: [[0, 0], [0.3, -0.1], [1.5, -0.08], [1.9, 0]],
        ParamPuff: [[0, 0], [0.25, 0.85], [1.5, 0.8], [1.9, 0]],
        ParamBrowAngle: [[0, 0], [0.25, -0.4], [1.5, -0.4], [1.9, 0]],
        ParamBrowRY: [[0, 0], [0.25, 2], [1.5, 2], [1.9, 0]],
        ParamBrowLY: [[0, 0], [0.25, 2], [1.5, 2], [1.9, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.3, 0.75], [1.5, 0.75], [1.9, 1]],
        ParamEyeROpen: [[0, 1], [0.3, 0.75], [1.5, 0.75], [1.9, 1]],
        ParamEyeBallX: [[0, 0], [0.3, -0.35], [1.5, -0.3], [1.9, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.3, 0.02], [1.55, 0.02], [1.95, 0.6]],
        ParamMouthPout: [[0, 0], [0.3, 1], [1.5, 1], [1.85, 0]],
        ParamBlush: [[0, 0], [0.4, 0.35], [1.5, 0.35], [1.9, 0]],
      },
      kick: [[0.3, { hem: 0.25, skirt: 0.3, ahoge: -0.3 }]],
    },
    cat: {
      d: 2.1, msg: '喵？',
      add: {
        ParamAngleZ: [[0, 0], [0.3, 10, 'b'], [1.55, 9], [2.0, 0]],
        ParamAngleY: [[0, 0], [0.3, 3], [1.55, 2], [2.0, 0]],
        ParamBodyAngleZ: [[0, 0], [0.4, 3], [1.55, 2.5], [2.0, 0]],
        ParamHandRY: [[0, 0], [0.25, -0.4], [1.5, -0.35], [1.95, 0]],
        ParamHandRRot: [[0, 0], [0.25, -6], [1.5, -6], [1.95, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.25, 0.02], [1.55, 0.02], [1.95, 1]],
        ParamEyeROpen: [[0, 1], [0.25, 0.02], [1.55, 0.02], [1.95, 1]],
        ParamEyeLSmile: [[0, 0], [0.25, 1], [1.55, 1], [1.95, 0]],
        ParamEyeRSmile: [[0, 0], [0.25, 1], [1.55, 1], [1.95, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.25, 0.02], [1.6, 0.02], [2.0, 0.6]],
        ParamMouthCat: [[0, 0], [0.25, 1], [1.55, 1], [1.9, 0]],
        ParamCheek: [[0, 0.6], [0.35, 0.9], [1.6, 0.9], [2.0, 0.6]],
        ParamBlush: [[0, 0], [0.35, 0.5], [1.6, 0.5], [1.95, 0]],
      },
      kick: [[0.3, { ahoge: 0.55, braidL: 0.3, braidR: -0.3 }]],
    },
    smug: {
      d: 2.2, msg: '哼哼～',
      add: {
        ParamBrowRY: [[0, 0], [0.25, -8], [1.6, -7], [2.05, 0]],
        ParamBrowLY: [[0, 0], [0.25, -2], [1.6, -1.5], [2.05, 0]],
        ParamAngleZ: [[0, 0], [0.35, 8, 'b'], [1.6, 7], [2.1, 0]],
        ParamAngleY: [[0, 0], [0.35, 2], [1.6, 1.5], [2.1, 0]],
        ParamBodyAngleZ: [[0, 0], [0.4, 2], [1.6, 1.5], [2.1, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.3, 0.55], [1.65, 0.55], [2.05, 1]],
        ParamEyeROpen: [[0, 1], [0.3, 0.85], [1.65, 0.85], [2.05, 1]],
        ParamEyeLSmile: [[0, 0], [0.3, 0.5], [1.65, 0.5], [2.05, 0]],
        ParamEyeRSmile: [[0, 0], [0.3, 0.1], [1.65, 0.1], [2.05, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.3, 0.02], [1.7, 0.02], [2.1, 0.6]],
        ParamMouthSmile: [[0, 0], [0.3, 1], [1.65, 1], [2.0, 0]],
        ParamCheek: [[0, 0.6], [0.4, 0.8], [1.7, 0.8], [2.1, 0.6]],
        ParamBlush: [[0, 0], [0.4, 0.5], [1.7, 0.5], [2.05, 0]],
      },
      kick: [[0.35, { ahoge: 0.4, braidL: 0.2, braidR: -0.2 }]],
    },
    bored: {
      d: 2.8, msg: '好无聊…',
      add: {
        ParamAngleZ: [[0, 0], [0.4, 7], [2.0, 6], [2.7, 0]],
        ParamAngleY: [[0, 0], [0.4, -3], [2.0, -2.5], [2.7, 0]],
        ParamBodyY: [[0, 0], [0.4, -0.08], [2.0, -0.06], [2.7, 0]],
        ParamBrowRY: [[0, 0], [0.4, 2], [2.0, 2], [2.5, 0]],
        ParamBrowLY: [[0, 0], [0.4, 2], [2.0, 2], [2.5, 0]],
      },
      set: {
        ParamEyeLOpen: [[0, 1], [0.4, 0.55], [2.1, 0.55], [2.6, 1]],
        ParamEyeROpen: [[0, 1], [0.4, 0.55], [2.1, 0.55], [2.6, 1]],
        ParamEyeBallY: [[0, 0], [0.4, 0.35], [2.1, 0.3], [2.6, 0]],
        ParamEyeBallX: [[0, 0], [0.4, -0.2], [2.1, -0.15], [2.6, 0]],
        ParamMouthOpenY: [[0, 0.6], [0.4, 0.02], [2.2, 0.02], [2.7, 0.6]],
        ParamMouthWavy: [[0, 0], [0.4, 1], [2.1, 1], [2.55, 0]],
        ParamBlush: [[0, 0], [0.5, 0.12], [2.1, 0.12], [2.5, 0]],
      },
      kick: [[0.4, { ahoge: 0.25 }]],
    },
  });
  const IDLE = ['idleBlink2', 'idleGlance', 'idleTilt', 'idleSway', 'idleBreath'];
  MOTIONS.tapBody = MOTIONS.shy;
  /* 展示一遍：按顺序把所有动作串起来 */
  const SHOWCASE = ['greet', 'nod', 'tilt', 'look', 'hop', 'wave', 'shy', 'angry', 'yawn', 'tapCloud'];

  /* 求值：返回 {add, set, w}。set 的权重 w 在动作首尾 0.12 / 0.25s 内渐变，避免切入切出时跳变 */
  function evalMotion(m) {
    const M = m.M, t = Math.min(m.t, M.d);
    const out = { add: {}, set: {} };
    if (M.add) for (const p in M.add) out.add[p] = track(M.add[p], t);
    if (M.set) for (const p in M.set) out.set[p] = track(M.set[p], t);
    if (M.fn) {
      const r = M.fn(t, M.d);
      if (r.add) for (const p in r.add) out.add[p] = (out.add[p] || 0) + r.add[p];
      if (r.set) Object.assign(out.set, r.set);
    }
    out.w = Math.min(ss(0, 0.12, m.t), ss(M.d, M.d - 0.25, m.t));
    return out;
  }
  /* g：动作力度（落地按松手速度缩放），只作用于叠加轨道 */
  function applyMotion(r, k, g = 1) {
    for (const p in r.add) live[p] += r.add[p] * k * g;
    const w = r.w * k;
    for (const p in r.set) {
      const v = lerp(live[p], r.set[p], w);
      live[p] = p.includes('EyeLOpen') || p.includes('EyeROpen') ? Math.min(live[p], v) : v;
    }
  }

  /* auto：待机时自己做的正式动作（音效减半） */
  /* opts.quiet：不弹动作自带的台词（报时 / 对话时自己给气泡文字） */
  function play(name, fromQueue, auto, gain, opts) {
    if (name === 'showcase') { state.queue = SHOWCASE.slice(1); name = SHOWCASE[0]; fromQueue = true; }
    const M = MOTIONS[name];
    if (!M) return;
    if (!fromQueue) state.queue = [];
    if (state.sleepTarget > 0 && name !== 'wake') setSleep(false, true);
    /* 切换：旧动作继续播放并在 0.25s 内淡出，新动作同时淡入 */
    if (state.motion) state.prev = { m: state.motion, k: 1 };
    state.motion = { name, t: 0, M, kicked: 0, g: Number.isFinite(gain) ? gain : 1 };
    if (M.msg && state.bubbles && !(opts && opts.quiet)) toast(M.msg);
    if (XH.sfx && !(opts && opts.silent)) XH.sfx.play(name, { auto: !!auto });
    if (!M.idle) touch();
    state.nextIdle = idleGap(IDLE_GAP);
  }

  /* 待机节奏：小动作 / 正式动作两层计时。freq 0 关 / 1 低 / 2 中 / 3 高（桌宠控制面板可调） */
  const IDLE_GAP = [6, 9], BIG_GAP = [20, 25];
  const FREQ_K = [0, 1.8, 1, 0.55];
  function idleGap([a, b]) { const k = FREQ_K[state.idleFreq] || 1; return (a + Math.random() * b) * k; }
  /* 深夜（23–6 点）打哈欠概率更高 */
  const night = () => { const h = new Date().getHours(); return h >= 23 || h < 6; };
  function pickBig() {
    const pool = ['nod', 'look', 'tilt', 'hop', 'wave', 'tapCloud', 'yawn', 'hum', 'daze', 'peek', 'browRaise', 'frown', 'worried', 'sparkle', 'pout', 'cat', 'smug', 'bored'];
    if (night()) pool.push('yawn', 'yawn', 'daze');
    if (!state.props) pool.splice(pool.indexOf('tapCloud'), 1);
    let n;
    do n = pool[(Math.random() * pool.length) | 0]; while (n === state.lastBig);
    return (state.lastBig = n);
  }

  /* 点击反应：同一部位 2.5s 内连点 3 次以上换成“生气”；点身体在害羞 / 歪头之间随机 */
  const combo = { hit: null, n: 0, t: 0 };
  function react(hit) {
    const now = performance.now();
    combo.n = combo.hit === hit && now - combo.t < 2500 ? combo.n + 1 : 1;
    combo.hit = hit; combo.t = now;
    if (combo.n >= 3 && hit !== 'tapCloud') { combo.n = 0; play('angry'); return; }
    if (hit === 'tapBody') play(Math.random() < 0.65 ? 'shy' : 'tilt');
    else play(hit);
  }

  /* 台词气泡（v0.2.0 起由 app-bubble.js 绘制；没加载时退回旧的 #msg 胶囊）。opt：{type, code, temp, ms, force} */
  let toastTimer = 0;
  function toast(text, opt) {
    if (XH.bubble && XH.bubble.state && document.querySelector('.xb')) { XH.bubble.say(text, opt); return; }
    const el = $('msg');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }
  const touch = () => { state.lastInput = performance.now(); };

  function setSleep(on, silent) {
    state.sleepTarget = on ? 1 : 0;
    $('sleepBtn').setAttribute('aria-pressed', String(on));
    $('sleepBtn').textContent = on ? '叫醒她' : '睡觉';
    if (!on && !silent) play('wake');
    if (on) { state.motion = null; state.prev = null; state.queue = []; toast('小嬅睡着了'); if (XH.sfx && !silent) XH.sfx.play('sleep'); }
  }

  /* ---------- 每帧计算 live 参数 ---------- */
  function computeParams(dt, t) {
    const calm = reduced.matches;
    for (const k in base) live[k] = base[k];
    Object.assign(live, EXTRA);

    /* 待机 */
    if (!calm) {
      live.ParamBreath = clamp(base.ParamBreath + (Math.sin(t * (Math.PI * 2 / 3.2)) * 0.5 + 0.5) * lerp(1, 0.6, state.sleep), 0, 1.4);
      live.ParamBodyAngleZ += Math.sin(t * 0.9) * 1.6;
      live.ParamAngleZ += Math.sin(t * 0.7 + 1) * 2.5;
      live.ParamCloudFloat += Math.sin(t * 1.3) * 0.6;
      live.ParamStarTwinkle = 1;
    } else {
      live.ParamStarTwinkle = 0;
    }

    /* 视线跟随：眼睛最快（~0.07s）→ 头（~0.2s）→ 身体（~0.5s）。鼠标离开后停 1 秒再慢慢回正 */
    let tx = state.keyLook.x, ty = state.keyLook.y;
    if (state.follow && state.pointer.active) { tx = state.pointer.x; ty = state.pointer.y; state.leaveT = 0; }
    else if (state.follow && state.leaveT < 1) { state.leaveT += dt; tx = state.look.x; ty = state.look.y; }
    const back = !state.pointer.active && state.leaveT >= 1;
    const ke = 1 - Math.exp(-dt / 0.07), kh = 1 - Math.exp(-dt / (back ? 0.6 : 0.2)), kb = 1 - Math.exp(-dt / (back ? 1.0 : 0.5));
    state.eye.x += (tx - state.eye.x) * ke; state.eye.y += (ty - state.eye.y) * ke;
    state.look.x += (tx - state.look.x) * kh; state.look.y += (ty - state.look.y) * kh;
    state.body.x += (tx - state.body.x) * kb;
    /* 眼球小跳动：每 0.8–2.5s 换一个微小偏移，瞬间跳过去 */
    const S = state.sacc;
    S.t -= dt;
    if (S.t <= 0) { S.t = 0.8 + Math.random() * 1.7; S.x = (Math.random() - 0.5) * 0.16; S.y = (Math.random() - 0.5) * 0.1; }
    /* 动作可调视线跟随强度（发呆 0.15 / 偷看 1.6），首尾 0.3s 渐变 */
    let gk = 1;
    if (state.motion && state.motion.M.look != null) {
      const mm = state.motion, e = Math.min(ss(0, 0.3, mm.t), ss(mm.M.d, mm.M.d - 0.3, mm.t));
      gk = lerp(1, mm.M.look, e);
    }
    const awake = (1 - state.sleep) * gk;
    live.ParamAngleX += state.look.x * 30 * awake;
    live.ParamAngleY += -state.look.y * 30 * awake;
    live.ParamBodyAngleX += state.body.x * 10 * awake;
    const sk = calm ? 0 : 1;
    live.ParamEyeBallX = clamp(live.ParamEyeBallX + (state.eye.x + S.x * sk) * awake, -1, 1);
    live.ParamEyeBallY = clamp(live.ParamEyeBallY + (state.eye.y + S.y * sk) * awake, -1, 1);
    /* 呼吸带动肩部：斗篷下摆随呼吸极轻微起伏 */
    if (!calm) live.ParamHemLift -= (live.ParamBreath - 0.5) * 0.12;

    /* 拖拽倾斜（旧版）：摇摆关掉时才用；开着时整体摇摆已经包含了倾斜 */
    if (!(state.swing | 0)) {
      live.ParamBodyAngleZ += state.dragTilt * 10;
      live.ParamAngleZ += state.dragTilt * 12;
    }

    /* 自动眨眼 */
    let blink = 1;
    if (state.blink && state.sleep < 0.5) {
      state.blinkT += dt;
      if (state.blinkT > state.nextBlink) {
        /* 0.26s：闭合 0.08s（加速）→ 停 0.04s → 睁开 0.14s（减速），比线性更柔 */
        const p = (state.blinkT - state.nextBlink) / 0.26;
        blink = p < 0.3 ? 1 - ss(0, 0.3, p) : p < 0.45 ? 0 : p < 1 ? ss(0.45, 1, p) : 1;
        if (p >= 1) { state.blinkT = 0; state.nextBlink = 2 + Math.random() * 4; }
      }
    }
    live.ParamEyeLOpen *= blink;
    live.ParamEyeROpen *= blink;

    /* 动作 */
    const pv = state.prev;
    if (pv) {
      pv.m.t += dt;
      pv.k -= dt / 0.25;
      if (pv.k <= 0 || pv.m.t >= pv.m.M.d) state.prev = null;
      else applyMotion(evalMotion(pv.m), ss(0, 1, pv.k), pv.m.g);
    }
    const m = state.motion;
    if (m) {
      const t0 = m.t;
      m.t += dt;
      applyMotion(evalMotion(m), 1, m.g);
      /* 推力：关键帧时刻给物理一下速度，辫子 / 下摆 / 呆毛跟着甩 */
      if (m.M.kick) for (const [kt, ks] of m.M.kick) if (kt >= t0 && kt < m.t) for (const p in ks) XH.PHYS[p].v += ks[p] * 6 * m.g;
      if (m.t >= m.M.d) {
        state.motion = null;
        if (state.queue && state.queue.length) play(state.queue.shift(), true);
        else if (!m.M.idle && m.name !== 'drop' && !calm) play('settle', true);
      }
    }
    /* 待机：小动作每 6–15s、正式动作每 20–45s（按频率档缩放）；睡觉 / 拖拽 / 减弱动态 / 频率关时不做 */
    if (!calm && state.idleFreq > 0 && state.sleepTarget === 0 && !state.drag) {
      state.nextBig -= dt;
      if (!state.motion) {
        state.nextIdle -= dt;
        if (state.nextBig <= 0) {
          state.nextBig = idleGap(BIG_GAP);
          play(pickBig(), true, true);
        } else if (state.nextIdle <= 0) {
          let n;
          do n = IDLE[(Math.random() * IDLE.length) | 0]; while (n === state.lastIdle);
          state.lastIdle = n;
          play(n, true);
        }
      }
    }

    /* 睡眠 */
    state.sleep += (state.sleepTarget - state.sleep) * (1 - Math.pow(0.04, dt));
    if (state.sleep > 0.001) {
      const s = state.sleep;
      live.ParamSleepy = Math.max(live.ParamSleepy, s);
    }
    const sl = live.ParamSleepy;
    if (sl > 0.001) {
      live.ParamEyeLOpen = Math.min(live.ParamEyeLOpen, lerp(1, 0, sl));
      live.ParamEyeROpen = Math.min(live.ParamEyeROpen, lerp(1, 0, sl));
      live.ParamAngleY -= 14 * sl;
      live.ParamAngleZ += 8 * sl;
      live.ParamMouthOpenY = lerp(live.ParamMouthOpenY, 0.05, sl);
      live.ParamMouthForm = lerp(live.ParamMouthForm, 0.6, sl);
    }

    applySwing(t);

    /* 说话嘴型（对话气泡打字时）：嘴巴一张一合，频率不规则一点更像说话 */
    state.talkK += ((state.talking ? 1 : 0) - state.talkK) * (1 - Math.exp(-dt / 0.08));
    if (state.talkK > 0.01 && state.sleep < 0.5) {
      const o = 0.35 + 0.4 * Math.abs(Math.sin(t * 13) * Math.sin(t * 7.3 + 1));
      live.ParamMouthOpenY = lerp(live.ParamMouthOpenY, o, state.talkK);
      live.ParamMouthForm = lerp(live.ParamMouthForm, 0.8, state.talkK);
    }

    /* 保险：任何参数变成 NaN / Infinity 都退回默认值，避免身体整块消失 */
    for (const p in live) if (!Number.isFinite(live[p])) live[p] = p in XH.DEF ? XH.DEF[p] : EXTRA[p] || 0;
    for (const p in XH.RANGE) {
      const [a, b] = XH.RANGE[p];
      live[p] = clamp(live[p], a, p === 'ParamBreath' ? 1.4 : b);
    }
  }

  /* ---------- 拖动摇摆：被拎住的挂件 ----------
     支点 = 抓取点。窗口（或鼠标）的位移先平滑成速度 / 加速度，再驱动阻尼摆：
       θ'' = −ω²(θ − θv) − 2ζω·θ' + K·ax     θv = 匀速时的“风阻”后倾，K·ax = 惯性（加速向右 → 脚往左荡）
     ω≈10、ζ≈0.2：急停 / 松手后来回 2–3 下、约 1.5s 内停稳。上下方向是同样的弹簧，驱动拉长 / 压扁。
     腿是更慢的二级摆（滞后于身体），左右频率略不同，不会同步。固定 1/240s 步长，帧率高低手感一致 */
  const SW_K = [0, 0.5, 1, 1.5], SW_MAX = [0, 10, 20, 28];
  const SW_H = 1 / 240;
  let swAcc = 0;
  function swingStep(h, drag, kAmp, maxA) {
    const S = state.sw;
    /* 速度平滑（τ 60ms）→ 加速度再平滑（τ 40ms）：Rust 30ms 一次的阶梯位移被抹平 */
    const rvx = S.px / h, rvy = S.py / h;
    S.px = 0; S.py = 0;
    const kv = 1 - Math.exp(-h / 0.06), ka = 1 - Math.exp(-h / 0.04);
    const ovx = S.vx, ovy = S.vy;
    S.vx += (clamp(rvx, -6000, 6000) - S.vx) * kv;
    S.vy += (clamp(rvy, -6000, 6000) - S.vy) * kv;
    S.ax += ((S.vx - ovx) / h - S.ax) * ka;
    S.ay += ((S.vy - ovy) / h - S.ay) * ka;
    const w = 11, z = 0.19;
    const thV = drag ? clamp(S.vx * 0.009, -10, 10) * kAmp : 0;
    const f = -w * w * (S.a - thV) - 2 * z * w * S.av + clamp(S.ax, -20000, 20000) * 0.017 * kAmp;
    S.av = clamp(S.av + f * h, -400, 400);
    S.a += S.av * h;
    /* 软限幅：接近上限时逐渐“拉不动”，不会硬顶 */
    if (Math.abs(S.a) > maxA * 0.7) S.a = Math.sign(S.a) * (maxA * 0.7 + (maxA * 0.3) * Math.tanh((Math.abs(S.a) - maxA * 0.7) / (maxA * 0.3)));
    /* 上下：往上提（vy<0）→ 拉长；往下放 → 压扁 */
    const ws = 14, zs = 0.28;
    const stV = drag ? clamp(-S.vy / 1500, -0.8, 0.8) * kAmp : 0;
    const fs = -ws * ws * (S.st - stV) - 2 * zs * ws * S.sv - clamp(S.ay, -20000, 20000) * 0.00012 * kAmp;
    S.sv = clamp(S.sv + fs * h, -40, 40);
    S.st = clamp(S.st + S.sv * h, -1, 1);
    /* 腿：相对身体，重力让它往回垂（−0.35θ）+ 二级滞后 */
    const lt = -S.a * 0.35;
    S.legRv += (-49 * (S.legR - lt) - 2 * 0.18 * 7 * S.legRv) * h; S.legR += S.legRv * h;
    S.legLv += (-72 * (S.legL - lt) - 2 * 0.18 * 8.5 * S.legLv) * h; S.legL += S.legLv * h;
  }
  /* 头晕检测：拖动中横向速度 > 500px/s 的方向翻转，1.2s 内 ≥ 3 次 */
  function swingDizzy(now) {
    const S = state.sw;
    const sg = Math.abs(S.vx) > 500 ? Math.sign(S.vx) : 0;
    if (sg && S.sx && sg !== S.sx) S.flips.push(now);
    if (sg) S.sx = sg;
    S.flips = S.flips.filter((t) => now - t < 1200);
    if (S.flips.length >= 3 && !S.dizzy) S.dizzy = true;
  }
  function updateSwing(dt, t) {
    const S = state.sw, lvl = state.swing | 0;
    const kAmp = SW_K[lvl] * (reduced.matches ? 0.5 : 1), maxA = SW_MAX[lvl] * (reduced.matches ? 0.5 : 1);
    const drag = !!state.drag;
    if (!kAmp) {
      S.a = S.av = S.st = S.sv = S.legR = S.legRv = S.legL = S.legLv = 0; S.px = S.py = 0; S.vx = S.vy = S.ax = S.ay = 0;
      S.lift = 0; S.stress = 0;
      return;
    }
    swAcc = Math.min(swAcc + dt, 0.1);
    /* 待处理位移按子步均分 */
    const n = Math.floor(swAcc / SW_H);
    if (n < 1) return; // 帧率高于 240：位移留到下一帧
    const dx = S.px / n, dy = S.py / n;
    S.px = 0; S.py = 0;
    for (let i = 0; i < n; i++) { S.px = dx; S.py = dy; swingStep(SW_H, drag, kAmp, maxA); }
    S.px = 0; S.py = 0;
    swAcc -= n * SW_H;
    if (!Number.isFinite(S.a) || !Number.isFinite(S.av) || !Number.isFinite(S.st)) { S.a = S.av = S.st = S.sv = 0; S.vx = S.vy = S.ax = S.ay = 0; }
    if (drag) swingDizzy(performance.now());
    S.lift += ((drag ? 1 : 0) - S.lift) * (1 - Math.exp(-dt / (drag ? 0.12 : 0.25)));
    const st = clamp((Math.abs(S.a) - maxA * 0.5) / (maxA * 0.4), 0, 1) + clamp((Math.abs(S.av) - 120) / 200, 0, 1);
    S.stress += (clamp(st, 0, 1) - S.stress) * (1 - Math.exp(-dt / (st > S.stress ? 0.08 : 0.5)));
  }
  /* 写进 live（computeParams 末尾、夹范围之前调用；这些都是 EXTRA 参数，不被 PARAMS 范围夹住） */
  function applySwing(t) {
    const S = state.sw;
    if (!(state.swing | 0)) return;
    live.ParamSwing = S.a;
    live.ParamStretch = S.st;
    live.ParamSwingPX = S.pivX; live.ParamSwingPY = S.pivY;
    const li = S.lift;
    /* 被拎起：脚轻轻荡（两只脚相位错开）、手臂下垂、手腕跟着身体反向垂 */
    live.ParamLegR = S.legR + Math.sin(t * 3.1) * 2.2 * li;
    live.ParamLegL = S.legL + Math.sin(t * 3.1 + 1.9) * 2.2 * li;
    live.ParamHandRY += 0.22 * li; live.ParamHandLY += 0.22 * li;
    live.ParamHandRRot += -S.a * 0.4; live.ParamHandLRot += -S.a * 0.4;
    /* 拉长 → 下摆下坠；压扁 → 裙摆上飘 */
    live.ParamHemLift += S.st * 0.9;
    /* 头相对身体被甩：滞后于角速度 */
    live.ParamAngleZ += clamp(-S.av * 0.04, -8, 8);
    /* 太猛：眯眼 + 冒汗 + 眉毛八字 */
    const sr = S.stress;
    if (sr > 0.01) {
      live.ParamEyeLOpen = Math.min(live.ParamEyeLOpen, 1 - 0.55 * sr);
      live.ParamEyeROpen = Math.min(live.ParamEyeROpen, 1 - 0.55 * sr);
      live.ParamSweat = Math.max(live.ParamSweat, sr);
      live.ParamBrowAngle = Math.max(live.ParamBrowAngle, 0.7 * sr);
    }
    if (S.dizzy && state.drag) live.ParamDizzy = Math.max(live.ParamDizzy, 1);
  }

  /* 调试入口：XH.debug.set({ParamEyeLOpen:0}) / XH.debug.stop() 停止待机与眨眼 */
  XH.debug = { base, state, set: (o) => Object.assign(base, o), stop: () => { state.blink = false; state.follow = false; state.motion = null; state.prev = null; state.queue = []; }, play, MOTIONS };

  /* ---------- UI：参数面板 ---------- */
  const outputs = {};
  function buildPanel() {
    const box = $('params');
    for (const [id, name, min, max, def, step] of XH.PARAMS) {
      const row = document.createElement('div');
      row.className = 'param';
      row.innerHTML =
        `<div class="od-row"><label class="od-field od-fill" for="r-${id}"><span class="name">${name}</span><span class="pid">${id}</span></label>` +
        `<output class="od-fixed" for="r-${id}">${(+def).toFixed(2)}</output></div>` +
        `<input type="range" id="r-${id}" min="${min}" max="${max}" step="${step}" value="${def}">`;
      box.appendChild(row);
      const input = row.querySelector('input');
      outputs[id] = row.querySelector('output');
      input.addEventListener('input', () => { base[id] = parseFloat(input.value); touch(); });
    }
    const mbox = $('meters');
    for (const k in XH.PHYS) {
      const P = XH.PHYS[k];
      const row = document.createElement('div');
      row.className = 'meter od-row';
      row.innerHTML = `<span class="lbl od-fixed">${P.name}</span><span class="bar od-fill"><i></i></span><code class="od-fixed">${P.id}</code>`;
      mbox.appendChild(row);
      P.el = row.querySelector('i');
    }
  }
  /* 图层面板：显隐 / 单独查看，名字与 PSD 一致 */
  function buildLayerPanel(R) {
    const box = $('layers');
    if (!box) return;
    const groups = {};
    const meta = window.XH_LAYERS.layers;
    for (const l of [...R.layers].reverse()) {
      const row = document.createElement('div');
      row.className = 'layer od-row';
      const [cn, en] = l.name.split(' | ');
      row.innerHTML =
        `<label class="od-row od-fill lyr-main"><input type="checkbox" checked aria-label="显示 ${cn}"><span class="od-field od-fill"><span class="name">${cn}</span><code>${en}</code></span></label>` +
        `<button class="btn solo od-fixed" type="button" aria-pressed="false" aria-label="单独查看 ${cn}">单看</button>`;
      const cb = row.querySelector('input'), solo = row.querySelector('.solo');
      cb.addEventListener('change', () => { if (cb.checked) delete state.hide[l.id]; else state.hide[l.id] = true; });
      solo.addEventListener('click', () => {
        const on = state.solo !== l.id;
        box.querySelectorAll('.solo').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        state.solo = on ? l.id : null;
        solo.setAttribute('aria-pressed', String(on));
      });
      box.appendChild(row);
    }
    $('layerCount').textContent = R.layers.length + ' 层';
  }

  let uiTick = 0;
  function updatePanel(dt) {
    uiTick += dt;
    if (uiTick < 0.1) return;
    uiTick = 0;
    for (const id in outputs) {
      const v = live[id], s = v.toFixed(Math.abs(XH.RANGE[id][1]) >= 10 ? 1 : 2);
      if (outputs[id].textContent !== s) outputs[id].textContent = s;
    }
    for (const k in XH.PHYS) {
      const P = XH.PHYS[k];
      P.el.style.transform = `scaleX(${P.p.toFixed(3)})`;
    }
  }
  function resetParams() {
    Object.assign(base, XH.DEF);
    for (const [id, , , , def] of XH.PARAMS) $('r-' + id).value = def;
    state.solo = null;
    state.hide = {};
    document.querySelectorAll('#layers input[type=checkbox]').forEach((c) => { c.checked = true; });
    document.querySelectorAll('#layers .solo').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    state.keyLook.x = state.keyLook.y = 0;
    state.motion = null; state.prev = null; state.queue = [];
    setSleep(false, true);
    toast('参数已重置');
  }

  /* ---------- 命中区域（原图像素坐标） ---------- */
  function hitTest(x, y) {
    const C = XH.CLOUD;
    if (state.props && Math.hypot(x - C.cx, y - C.cy) < C.r && x > C.minX) return 'tapCloud';
    if (Math.hypot((x - 612) / 380, (y - 470) / 360) < 1) return 'tapHead';
    if (x > 120 && x < 1060 && y > 830 && y < 1560) return 'tapBody';
    return null;
  }

  /* ---------- 启动 ---------- */
  function start(imgs, pats) {
    const glCv = $('gl'), fxCv = $('fx');
    let R;
    try {
      R = XH.createRenderer(glCv, fxCv, imgs, pats);
    } catch (err) {
      $('loading').textContent = '无法启动预览：' + err.message + '。请换用新版 Chrome / Edge / Safari 打开。';
      return;
    }
    $('loading').remove();
    if (!PET) { buildPanel(); buildLayerPanel(R); }
    if (XH.bubble) { XH.bubble.mount($('stage')); XH.bubble.onTalk((on) => { state.talking = on; }); }
    new ResizeObserver(() => R && R.resize()).observe($('stage'));

    /* 显卡渲染上下文丢失（驱动重置 / 后台回收 / 显存不足）：暂停绘制，恢复后重新上传图集，不会一直空白 */
    let lost = false;
    glCv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; toast('正在恢复画面…'); });
    glCv.addEventListener('webglcontextrestored', () => {
      try { R = XH.createRenderer(glCv, fxCv, imgs, pats); lost = false; state.wbOutfit = null; XH.resetPhys && XH.resetPhys(); toast('画面已恢复'); }
      catch (err) { toast('画面恢复失败，请刷新页面'); }
    });

    /* 指针：跟随、点击、拖拽 */
    const local = (e) => {
      const r = glCv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top, r];
    };
    /* 视线目标：客户区坐标（桌宠里可以在窗口外，坐标为负或超出窗口）。
       网页里以舞台半宽为满偏；桌宠窗口很小，改用固定 600px 为满偏，鼠标在屏幕另一侧时才看到底 */
    const aim = (clientX, clientY) => {
      const r = glCv.getBoundingClientRect();
      const [hx, hy] = [R.view.ox + 612 * R.view.s, R.view.oy + 560 * R.view.s];
      const sx = PET ? 600 : r.width * 0.5, sy = PET ? 600 : r.height * 0.5;
      state.pointer.x = clamp((clientX - r.left - hx) / sx, -1, 1);
      state.pointer.y = clamp((clientY - r.top - hy) / sy, -1, 1);
      state.pointer.active = true;
    };
    const clickAt = (cx, cy) => {
      const [ix, iy] = R.toImage(cx, cy);
      if (state.sleepTarget > 0) { setSleep(false); return 'wake'; }
      const hit = hitTest(ix, iy);
      if (hit && !(XH.pet.onHit && XH.pet.onHit(hit))) react(hit);
      return hit;
    };
    /* 拖动三段（桌宠 / 网页共用）。抓取点（客户区坐标）→ 原图 uv，作为摇摆支点；限制在身体范围内，
       抓脚时支点不会跑到最底下（那样整个人会倒立着甩） */
    const swingGrab = (cx, cy) => {
      const S = state.sw;
      let u = 0.5, v = 0.3;
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        const [ix, iy] = R.toImage(cx, cy);
        u = clamp(ix / XH.IW, 0.25, 0.75); v = clamp(iy / XH.IH, 0.1, 0.62);
      }
      /* 松手后还在晃时又抓住：先把现有转角换算到新支点下不跳（近似：直接沿用角度，支点平滑过去） */
      S.pivX = u; S.pivY = v;
      S.flips = []; S.sx = 0; S.dizzy = false;
    };
    const swingMove = (dx, dy) => {
      const S = state.sw;
      S.px += Number.isFinite(dx) ? dx : 0; S.py += Number.isFinite(dy) ? dy : 0;
      state.dragV = clamp(state.dragV + (dx || 0) * 0.02 * ((state.swing | 0) ? 0.5 : 1), -1.5, 1.5);
    };
    /* 松手：落地力度按松手前 ~0.15s 的速度（0.6–1.6 倍）；甩晕了 → 头晕动作 */
    const swingRelease = () => {
      const S = state.sw;
      if (state.sleepTarget > 0) { setSleep(false); return; }
      const sp = Math.hypot(S.vx, S.vy);
      const g = (state.swing | 0) ? clamp(0.6 + sp / 1500, 0.6, 1.6) : 1;
      if (S.dizzy && (state.swing | 0)) { S.dizzy = false; play('dizzy'); if (XH.sfx) XH.sfx.play('drop'); }
      else play('drop', false, false, g);
      S.flips = [];
    };
    /* 桌宠接口：pet.js 调用。onFrame 在每帧 render 之后调用（此时才能读到当帧像素） */
    XH.pet = {
      aim, leave: () => { state.pointer.active = false; },
      /* 以下坐标均为窗口客户区坐标（v0.2.0 起画布在窗口里下移了气泡区高度，这里统一换算到画布） */
      alphaAt: (cx, cy, r) => (lost ? 0 : R.alphaAt(cx - glCv.offsetLeft, cy - glCv.offsetTop, r)),
      click: (cx, cy) => { touch(); return clickAt(cx - glCv.offsetLeft, cy - glCv.offsetTop); },
      dragStart: (cx, cy) => { state.drag = { lx: 0, ly: 0, moved: 99 }; swingGrab(cx - glCv.offsetLeft, cy - glCv.offsetTop); touch(); if (XH.sfx && state.sleepTarget === 0) XH.sfx.play('lift'); },
      dragMove: (dx, dy) => { swingMove(dx, dy); touch(); },
      dragEnd: () => { if (!state.drag) return; state.drag = null; swingRelease(); },
      /* 没真正拖起来（左键已松开）：静默取消，不播落地 */
      dragCancel: () => { state.drag = null; },
      play, toast, touch, state, onFrame: null,
      nextOutfit: () => (XH.dress ? XH.dress.next() : 'classic'),
      /* 小助手 / 对话：说一句（带动作，不弹动作自带台词）；hit 回调：点到某部位后调用（返回 true = 已处理） */
      say: (text, opt, motion) => { if (motion) play(motion, false, true, 1, { quiet: true, silent: !!(opt && opt.silent) }); toast(text, { ...(opt || {}), force: true }); touch(); },
      bubble: () => XH.bubble,
      onHit: null,
      /* 对话情绪 → 动作 */
      emote: (tag) => {
        const M = { 开心: 'happy', 高兴: 'happy', 害羞: 'shy', 生气: 'angry', 困: 'yawn', 思考: 'think', 惊讶: 'tilt', 疑惑: 'tilt', 难过: 'daze', 点头: 'nod', 打招呼: 'greet', 挥手: 'wave', 得意: 'smug', 无聊: 'bored', 星星眼: 'sparkle', 嘟嘴: 'pout', 猫嘴: 'cat' };
        const n = M[tag];
        if (n) play(n, false, true, 1, { quiet: true, silent: n !== 'happy' && n !== 'shy' });
        return n || null;
      },
      wake: () => { if (state.sleepTarget > 0) setSleep(false, true); },
      /* 当前是否在播正式动作（待机小动作 / 收尾不算） */
      busy: () => !!(state.motion && !state.motion.M.idle),
      sleeping: () => state.sleepTarget > 0,
      setSleep: (on) => setSleep(on),
      /* 控制面板设置：idleFreq 0–3 / bubbles / follow / props / sfx / vol / voice */
      set: (o) => {
        if ('idleFreq' in o) { state.idleFreq = clamp(o.idleFreq | 0, 0, 3); state.nextIdle = idleGap(IDLE_GAP); state.nextBig = idleGap(BIG_GAP); }
        if ('bubbles' in o) state.bubbles = !!o.bubbles;
        if ('follow' in o) state.follow = !!o.follow;
        if ('props' in o) state.props = !!o.props;
        if (XH.dress) XH.dress.apply(o);
        if ('swing' in o) state.swing = clamp(Number.isFinite(+o.swing) ? +o.swing | 0 : 2, 0, 3);
        if (XH.sfx) XH.sfx.set(o); // sfx / vol
      },
    };
    if (!PET) window.addEventListener('pointermove', (e) => {
      aim(e.clientX, e.clientY);
      if (state.drag) {
        /* 网页里角色不跟着鼠标走，但按鼠标的移动来摇摆（相当于手拎着她晃） */
        const dx = e.clientX - state.drag.lx, dy = e.clientY - state.drag.ly;
        state.drag.lx = e.clientX;
        state.drag.ly = e.clientY;
        state.drag.moved += Math.abs(dx) + Math.abs(dy);
        if (!state.drag.lifted && state.drag.moved >= 8) {
          state.drag.lifted = true;
          const [cx, cy] = local({ clientX: state.drag.x, clientY: state.drag.y });
          swingGrab(cx, cy);
          if (XH.sfx && state.sleepTarget === 0) XH.sfx.play('lift');
        }
        if (state.drag.lifted) swingMove(dx, dy);
      }
      touch();
    });
    if (!PET) document.addEventListener('pointerleave', () => { state.pointer.active = false; });
    if (!PET) glCv.addEventListener('pointerdown', (e) => {
      glCv.setPointerCapture(e.pointerId);
      state.drag = { lx: e.clientX, ly: e.clientY, moved: 0, x: e.clientX, y: e.clientY };
      glCv.classList.add('dragging');
      touch();
      state.drag.lifted = false;
    });
    const endDrag = (e) => {
      if (!state.drag) return;
      const d = state.drag;
      state.drag = null;
      glCv.classList.remove('dragging');
      if (d.moved < 8) {
        const [cx, cy] = local(e);
        clickAt(cx, cy);
      } else swingRelease();
    };
    if (!PET) glCv.addEventListener('pointerup', endDrag);
    if (!PET) glCv.addEventListener('pointercancel', () => { state.drag = null; glCv.classList.remove('dragging'); });

    /* 键盘 */
    glCv.addEventListener('keydown', (e) => {
      const step = 0.25;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        e.preventDefault();
        state.pointer.active = false;
        state.leaveT = 1;
        state.keyLook.x = clamp(state.keyLook.x + map[e.key][0], -1, 1);
        state.keyLook.y = clamp(state.keyLook.y + map[e.key][1], -1, 1);
      } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play('tapHead'); }
      else if (e.key === 'b' || e.key === 'B') play('tapBody');
      else if (e.key === 'c' || e.key === 'C') play('tapCloud');
      else if ('1234567'.includes(e.key)) play(['greet', 'wave', 'nod', 'tilt', 'look', 'hop', 'angry'][+e.key - 1]);
      touch();
    });

    /* 面板控件 */
    document.querySelectorAll('[data-motion]').forEach((b) => b.addEventListener('click', () => play(b.dataset.motion)));
    $('sleepBtn').addEventListener('click', () => setSleep(state.sleepTarget === 0));
    $('resetBtn').addEventListener('click', resetParams);
    $('optFollow').addEventListener('change', (e) => { state.follow = e.target.checked; });
    $('optBlink').addEventListener('change', (e) => { state.blink = e.target.checked; });
    $('optProps').addEventListener('change', (e) => { state.props = e.target.checked; });

    /* 手机抽屉 */
    const panel = $('panel'), scrim = $('scrim'), openBtn = $('openPanel');
    const setPanel = (open) => {
      panel.classList.toggle('open', open);
      scrim.classList.toggle('open', open);
      openBtn.setAttribute('aria-expanded', String(open));
      if (open) $('closePanel').focus(); else openBtn.focus();
    };
    openBtn.addEventListener('click', () => setPanel(true));
    $('closePanel').addEventListener('click', () => setPanel(false));
    scrim.addEventListener('click', () => setPanel(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) setPanel(false); });

    /* 主循环 */
    let last = performance.now();
    /* v0.2.1：开机自启拉起时跳过开场招呼（XH_GREET_GATE 由 pet.html 提供，resolve 为 true 表示跳过） */
    (window.XH_GREET_GATE || Promise.resolve(false)).then((skip) => { if (!skip) play('greet'); }, () => play('greet'));
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      /* 无操作入睡：网页 1 分钟；桌宠 10 分钟（常驻桌面，不宜太快睡着） */
      if (state.sleepTarget === 0 && !state.drag && now - state.lastInput > (PET ? 600000 : 60000)) setSleep(true);
      state.dragV *= Math.pow(0.02, dt);
      const tiltTarget = state.drag ? clamp(state.dragV * 0.6, -1, 1) : 0;
      state.dragTilt += (tiltTarget - state.dragTilt) * (1 - Math.pow(0.001, dt));
      updateSwing(dt, t);
      computeParams(dt, t);
      const inputs = XH.physInputs(live, state.dragV, live.ParamSwing / 20);
      const sub = 2;
      for (let i = 0; i < sub; i++) XH.stepPhys(dt / sub, inputs);
      /* 套装图集懒加载：未就绪前先按原版画，就绪后自动切过去 */
      let dressReady = true;
      if (XH.dress && XH.wardrobeLoader && !lost) {
        const of = XH.dress.outfit();
        if (of !== state.wbOutfit) { state.wbOutfit = of; XH.wardrobeLoader.ensure(R, imgs, of); }
        dressReady = XH.wardrobeLoader.ready(R, of);
      }
      if (!lost) R.render(live, t, { props: state.props, zzz: state.sleep, hide: Object.assign({}, state.hide, XH.dress ? XH.dress.hideMap(dressReady) : null), solo: state.solo });
      /* 气泡跟着头顶（兜帽顶 ≈ 原图 (600, 150)），画布在舞台里的偏移要加上 */
      if (XH.bubble && !lost) {
        const [hx, hy] = R.headScreen(live, 600, 150, 0.006);
        XH.bubble.frame(dt, hx + glCv.offsetLeft, hy + glCv.offsetTop, R.swingDeg());
      }
      if (XH.pet.onFrame) XH.pet.onFrame(dt);
      if (!PET) updatePanel(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* 图集修补（加载时做一次，不改原始素材）：
     1) 兜帽外壳顶上 1px 的切图残线（原图 y≈1 横贯整幅），深色背景上像一条细线 → 清掉 y < 50 的像素；
     2) 兜帽外壳在呆毛尖处被抠掉了一个洞（原来呆毛画在兜帽上），呆毛一动就露出背后的背景成“小黑点” →
        用洞边缘的兜帽颜色一圈圈往里补满。 */
  function patchAtlas(ims) {
    const D = window.XH_LAYERS, hf = D.layers.find((l) => l.id === 'Hood_Front');
    if (!hf) return ims;
    const out = ims.slice(), im = ims[hf.page];
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const W = hf.w, H = hf.h, id = g.getImageData(hf.u, hf.v, W, H), d = id.data;
    const A = (x, y) => d[(y * W + x) * 4 + 3];
    /* 1) 顶部残线 */
    for (let y = 0; y < Math.min(H, 50 - hf.y); y++) for (let x = 0; x < W; x++) d[(y * W + x) * 4 + 3] = 0;
    /* 2) 洞：兜帽外壳范围内（每行最左到最右不透明之间）、四个方向 40px 内都有不透明像素的透明点，只在头顶区域找 */
    /* 只在呆毛尖附近（原图 x 560–640, y 80–135）找，免得把兜帽脸部开口当成洞 */
    const y0 = Math.max(0, 80 - hf.y), y1 = Math.min(H, 135 - hf.y), xa = Math.max(1, 560 - hf.x), xb = Math.min(W - 1, 640 - hf.x), hole = new Uint8Array(W * H);
    for (let y = y0; y < y1; y++) for (let x = xa; x < xb; x++) {
      if (A(x, y) > 230) continue;
      let u = 0, dn = 0, l = 0, r = 0;
      for (let k = 1; k <= 40; k++) {
        if (!u && y - k >= 0 && A(x, y - k) > 230) u = 1;
        if (!dn && y + k < H && A(x, y + k) > 230) dn = 1;
        if (!l && x - k >= 0 && A(x - k, y) > 230) l = 1;
        if (!r && x + k < W && A(x + k, y) > 230) r = 1;
      }
      if (u && dn && l && r) hole[y * W + x] = 1;
    }
    /* 一圈圈往里扩：每个洞点取周围 8 邻里已不透明像素的平均色（预乘前的普通 RGBA） */
    for (let it = 0; it < 40; it++) {
      const fill = [];
      for (let y = y0; y < y1; y++) for (let x = xa; x < xb; x++) {
        const i = y * W + x; if (!hole[i]) continue;
        let n = 0, R = 0, G = 0, B = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * W + x + dx; if ((dx || dy) && !hole[j] && d[j * 4 + 3] > 230) { n++; R += d[j * 4]; G += d[j * 4 + 1]; B += d[j * 4 + 2]; }
        }
        if (n >= 2) fill.push([i, R / n, G / n, B / n]);
      }
      if (!fill.length) break;
      for (const [i, R, G, B] of fill) { d[i * 4] = R; d[i * 4 + 1] = G; d[i * 4 + 2] = B; d[i * 4 + 3] = 255; hole[i] = 0; }
    }
    g.putImageData(id, hf.u, hf.v);
    out[hf.page] = c;
    return out;
  }

  /* 加载分层图集（xiaohua_layers.js 内嵌 data URI，本地双击 index.html 也能打开） */
  const baseSrcs = window.XH_ATLAS || [];
  const WB = window.XH_WARDROBE;
  /* 套装页（lazy）不在启动时加载：穿上时由 wardrobeLoader 拉取，换下后释放显存 */
  const wbSrcs = WB ? WB.pages.map((p, i) => (p.lazy ? null : (p.src || ('assets/wardrobe/atlas' + i + '.png')))) : [];
  const patSrcs = WB ? Object.values(WB.patterns || {}).map((p) => p.src) : [];
  const srcs = baseSrcs.concat(wbSrcs, patSrcs);
  const loadImg = (src) => new Promise((ok, bad) => { if (!src) return ok(null); const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; });
  if (WB && XH.dress) {
    const off = () => window.XH_LAYERS.pages.length - WB.pages.length; // 合并后衣柜页在总页表里的起点
    const want = {}; // 页号 → 正在加载的 Promise
    XH.wardrobeLoader = {
      /* 确保 outfit 的页已上传；其他套装页释放。返回 Promise<是否就绪> */
      ensure(R, imgs, outfit) {
        const base = off(), jobs = [];
        WB.pages.forEach((p, i) => {
          if (!p.lazy) return;
          const gi = base + i;
          if (p.lazy !== outfit) { if (imgs[gi]) { imgs[gi] = null; R.setPage(gi, null); } delete want[gi]; return; }
          if (imgs[gi] && R.hasPage(gi)) return;
          if (!want[gi]) want[gi] = loadImg(p.src).then((im) => {
            if (!want[gi]) return; // 已经换走
            delete want[gi];
            imgs[gi] = im; R.setPage(gi, im);
          }).catch(() => { delete want[gi]; });
          jobs.push(want[gi]);
        });
        return Promise.all(jobs);
      },
      ready(R, outfit) {
        const base = off();
        return WB.pages.every((p, i) => p.lazy !== outfit || R.hasPage(base + i));
      },
    };
  }
  if (!baseSrcs.length || !window.XH_LAYERS) {
    $('loading').textContent = '分层数据加载失败：请确认 assets/xiaohua_layers.js 与 index.html 放在一起。';
  } else {
    Promise.all(srcs.map(loadImg))
      .then((ims) => {
        const base = ims.slice(0, baseSrcs.length);
        let pats = null;
        if (WB) {
          const off = XH_LAYERS.pages.length;
          WB.pages.forEach((pg) => XH_LAYERS.pages.push(pg));
          XH_LAYERS.layers = XH.dress.merge(XH_LAYERS.layers, WB.layers.map((l) => ({ ...l, hidden: false, page: l.page + off })));
          pats = {};
          Object.keys(WB.patterns || {}).forEach((k, i) => { pats[k] = ims[baseSrcs.length + wbSrcs.length + i]; });
        }
        let patched = base;
        try { patched = patchAtlas(base); } catch (_) {}
        return { ims: patched.concat(ims.slice(baseSrcs.length)), pats };
      })
      .then(({ ims, pats }) => start(ims, pats))
      .catch(() => { $('loading').textContent = '图层图集解码失败，请换用新版 Chrome / Edge / Safari 打开。'; });
  }
})();

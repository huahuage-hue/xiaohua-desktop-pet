/* 小嬅 Live2D 互动预览 · 渲染（分层驱动版）
   数据来自 assets/xiaohua_layers.js（由 tools/build_layers.js 从 psd/xiaohua_layers.psd 同源生成）。
   每个图层一张网格，挂到对应变形器；眼、嘴靠图层的显隐 / 缩放 / 裁剪实现，不再在原图上“盖色”。 */
(function () {
  'use strict';
  const XH = window.XH;
  const { clamp, ss, lerp } = XH;

  /* ---------- 图层 → 变形器 / 视差 ----------
     head：转头时的位移系数（图宽单位），越靠前越大。后发 < 兜帽 < 脸 < 五官 < 前发 */
  const RIG = {
    /* 切图剩下的散碎描边（斗篷 / 腿的外轮廓残线）。它不跟着变形，斗篷一摆、拖动一晃就会在旁边留下细线 → 不画 */
    Misc: { fixed: 1, off: 1 },
    Hood_Back: { head: 0.004, fall: 1 },
    Hood_Lining: { head: 0.005, fall: 1 },
    Hood_Front: { head: 0.006, fall: 1, hood: 1 },
    Hood_Rim: { head: 0.007, fall: 1, hood: 1 },
    HoodSide_R: { head: 0.005, fall: 1, hoodSide: 'R' },
    HoodSide_L: { head: 0.005, fall: 1, hoodSide: 'L' },
    Hair_Back: { head: 0.004, fall: 1 },
    Cape_Back_Lining: { hem: 1 },
    Neck: { head: 0.003, fall: 1 },
    Skirt: { skirt: 1 },
    /* 腿 / 袜 / 鞋：以胯部为支点（被拎起时脚轻轻荡，ParamLegR / ParamLegL） */
    Leg_R: { leg: 'R' }, Sock_R: { leg: 'R' }, Shoe_R: { leg: 'R' }, ShoeBow_R: { leg: 'R' },
    Leg_L: { leg: 'L' }, Sock_L: { leg: 'L' }, Shoe_L: { leg: 'L' }, ShoeBow_L: { leg: 'L' },
    Sweater: {},
    Cape_Front_R: { hem: 'R' }, Cape_Front_L: { hem: 'L' },
    Cape_Hem_R: { hem: 'R' }, Cape_Hem_L: { hem: 'L' },
    Brooch: {},
    Face: { head: 0.012, face: 1 },
    Hand_R: { hand: 'R' }, Hand_L: { hand: 'L' },
    Nose: { head: 0.02 },
    Mouth_Inner: { head: 0.019, mouth: 1 },
    Mouth_Tongue: { head: 0.019, mouth: 1, tongue: 1 },
    Mouth_LineLow: { head: 0.019, mouth: 1 },
    Mouth_LineUp: { head: 0.019, mouth: 1 },
    MouthClose: { head: 0.019, mouthClose: 1 },
    Mouth_Smile: { head: 0.019, mouthShape: 'Smile' },
    Mouth_Cat: { head: 0.019, mouthShape: 'Cat' },
    Mouth_Pout: { head: 0.019, mouthShape: 'Pout' },
    Mouth_Wavy: { head: 0.019, mouthShape: 'Wavy' },
    Cheek_Blush: { head: 0.016, blush: 1, face: 1 },
    /* 前发按 x 切成 5 束，转头系数必须一致，否则切线处会被拉开露出细线（辫子上方最明显） */
    Hair_Side_R: { head: 0.024, side: 'R' },
    Hair_Side_L: { head: 0.024, side: 'L' },
    Bangs_R: { head: 0.024 }, Bangs_C: { head: 0.024 }, Bangs_L: { head: 0.024 },
    Ahoge: { head: 0.024, ahoge: 1 },
    Twig: { head: 0.008, twig: 1, hood: 1 },
    Cloud_Body: { cloud: 1, prop: 1 },
    Cloud_Blush: { cloud: 1, prop: 1 },
    Cloud_FaceOpen: { cloud: 1, prop: 1, cloudFace: 0 },
    Cloud_FaceHappy: { cloud: 1, prop: 1, cloudFace: 1 },
  };
  function rigFor(id) {
    if (RIG[id]) return RIG[id];
    if (/^Star_/.test(id)) return { fixed: 1, prop: 1, star: +id.slice(-2) - 1 };
    let m = id.match(/^Braid_(L|R)_(\d)$/);
    if (m) return { braid: m[1], seg: +m[2], head: 0.007, fall: 1 };
    m = id.match(/^BraidTie_(L|R)$/);
    if (m) return { braid: m[1], seg: 2, head: 0.007, fall: 1 };
    m = id.match(/^(EyeWhite|Iris|Pupil|EyeHi|EyeLidUp|EyeLidLow|EyeClose|EyeSmile|Brow)_(L|R)$/);
    if (m) return { head: m[1] === 'Brow' ? 0.02 : m[1] === 'EyeHi' ? 0.019 : 0.018, eye: m[2], part: m[1] };
    return {}; // 腿 / 袜 / 鞋 / 手：只跟身体
  }
  const EYEBALL = { Iris: 1, Pupil: 1, EyeHi: 1 };

  /* ---------- 眼睛几何：用 app-core 的轮廓点，算出眼睑高度和眼眶裁剪 ---------- */
  function eyeGeom(E) {
    const p = E.pts, x0 = p[0][0], x1 = p[p.length - 1][0];
    let top = 1e9, low = -1e9, lash = 0;
    for (const q of p) { top = Math.min(top, q[1]); low = Math.max(low, q[3]); lash += q[2] - q[1]; }
    return { x0, x1, cx: (x0 + x1) / 2, top, low, lashH: lash / p.length, pts: p };
  }
  const EYE = {};
  for (const E of XH.EYES) EYE[E.key] = eyeGeom(E);

  /* ---------- WebGL ---------- */
  /* uSwM / uSwP：拖动摇摆的整体变换（整图 uv 空间，绕抓取点旋转 + 拉伸）；vImg 保留变换前坐标给眼部裁剪用 */
  const VS = `attribute vec2 aPos; attribute vec2 aUV; uniform vec4 uView; uniform mat2 uSwM; uniform vec2 uSwP; varying vec2 vUV; varying vec2 vImg;
    void main(){ vec2 q = uSwM * (aPos - uSwP) + uSwP; vec2 p = q * uView.xy + uView.zw; gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0); vUV = aUV; vImg = aPos; }`;
  /* uClip：按“变形后整图 uv”的矩形裁剪（眼白 / 虹膜限制在眼睑之间） */
  /* highp：mediump 在部分显卡上只有 fp16，2048 图集的 uv 会偏 1 个像素，采到相邻图层间的透明缝 → 细线 */
  const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D uTex; uniform sampler2D uPat;
    uniform float uAlpha; uniform vec4 uClip;
    uniform vec3 uTint; uniform float uPatOn; uniform float uPatMix; uniform float uPatScale;
    varying vec2 vUV; varying vec2 vImg;
    void main(){
      vec4 c = texture2D(uTex, vUV);
      if (vImg.x < uClip.x || vImg.x > uClip.z || vImg.y < uClip.y || vImg.y > uClip.w) discard;
      vec3 base = c.rgb / max(c.a, 0.0001);
      vec3 col = base * uTint;
      if (uPatOn > 0.001) {
        vec2 puv = vImg / uPatScale, tx = vec2(1.0 / 512.0);
        vec3 p = (texture2D(uPat, puv).rgb + texture2D(uPat, puv + vec2(tx.x, 0.0)).rgb
          + texture2D(uPat, puv + vec2(0.0, tx.y)).rgb + texture2D(uPat, puv + tx).rgb) * 0.25;
        p = clamp(p * 1.06, 0.0, 1.0);
        vec3 b = clamp(col, 0.0, 1.0);
        vec3 ov = mix(2.0 * b * p, 1.0 - 2.0 * (1.0 - b) * (1.0 - p), step(0.5, b));
        col = mix(col, ov, uPatMix);
      }
      gl_FragColor = vec4(col * c.a, c.a) * uAlpha;
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function makePatTex(gl, src) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    return t;
  }
  function makeTex(gl, src) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    return t;
  }
  /* 每个图层一张规则网格：密度按图层尺寸，约 24px 一格 */
  function makeGrid(gl, Ly, pageW, pageH) {
    const cols = Math.max(2, Math.min(40, Math.round(Ly.w / 24)));
    const rows = Math.max(2, Math.min(60, Math.round(Ly.h / 24)));
    const n = (cols + 1) * (rows + 1);
    const base = new Float32Array(n * 2), uv = new Float32Array(n * 2), pos = new Float32Array(n * 2);
    let k = 0;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const fx = i / cols, fy = j / rows;
        uv[k] = (Ly.u + (Ly.tw || Ly.w) * fx) / pageW;
        uv[k + 1] = (Ly.v + (Ly.th || Ly.h) * fy) / pageH;
        base[k] = (Ly.x + Ly.w * fx) / XH.IW;
        base[k + 1] = (Ly.y + Ly.h * fy) / XH.IH;
        k += 2;
      }
    }
    const idx = new Uint16Array(cols * rows * 6);
    k = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        idx.set([a, b, c, b, d, c], k);
        k += 6;
      }
    }
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    return { n, base, pos, uvBuf, posBuf, idxBuf, count: idx.length };
  }

  XH.createRenderer = function (glCanvas, fxCanvas, atlasImgs, patternImgs) {
    const DATA = window.XH_LAYERS;
    if (!DATA) throw new Error('缺少分层数据 assets/xiaohua_layers.js');
    const gl = glCanvas.getContext('webgl', { premultipliedAlpha: true, antialias: true, alpha: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL');
    /* 图集单页 2048²；若设备上限更小则报错提示，而不是静默画空 */
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (DATA.pages.some((p) => p.w > maxTex || p.h > maxTex)) throw new Error('显卡纹理上限 ' + maxTex + ' 小于图集尺寸');
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aUV = gl.getAttribLocation(prog, 'aUV');
    const uView = gl.getUniformLocation(prog, 'uView');
    const uAlpha = gl.getUniformLocation(prog, 'uAlpha');
    const uClip = gl.getUniformLocation(prog, 'uClip');
    const uSwM = gl.getUniformLocation(prog, 'uSwM'), uSwP = gl.getUniformLocation(prog, 'uSwP');
    const uTint = gl.getUniformLocation(prog, 'uTint'), uPat = gl.getUniformLocation(prog, 'uPat');
    const uPatOn = gl.getUniformLocation(prog, 'uPatOn'), uPatMix = gl.getUniformLocation(prog, 'uPatMix'), uPatScale = gl.getUniformLocation(prog, 'uPatScale');
    gl.uniform1i(uPat, 1);
    /* 摇摆矩阵（原图像素空间）：M = k · R(a) · diag(sx, sy)，支点 (px, py) 像素。fx 画布和点击换算共用 */
    const sw = { a: 0, b: 0, c: 0, d: 1, px: 600, py: 600, on: false };
    function swingFrom(L) {
      const ang = (L.ParamSwing || 0) * Math.PI / 180, st = L.ParamStretch || 0;
      const k = 1 - Math.min(0.1, Math.abs(ang) * 0.25);
      const sx = (1 - st * 0.04) * k, sy = (1 + st * 0.08) * k;
      const c = Math.cos(ang), s = Math.sin(ang);
      sw.a = c * sx; sw.b = -s * sy; sw.c = s * sx; sw.d = c * sy; // [a b; c d]
      sw.px = (L.ParamSwingPX == null ? 0.5 : L.ParamSwingPX) * XH.IW;
      sw.py = (L.ParamSwingPY == null ? 0.3 : L.ParamSwingPY) * XH.IH;
      sw.on = !!(ang || st);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    /* 图集页可以为空（懒加载的套装页）：没贴图的层直接跳过，setPage 补上或释放 */
    const texs = atlasImgs.map((im) => (im ? makeTex(gl, im) : null));
    const patTex = {};
    if (patternImgs) for (const k in patternImgs) patTex[k] = makePatTex(gl, patternImgs[k]);
    const layers = DATA.layers.map((Ly) => {
      const pg = DATA.pages[Ly.page];
      return { ...Ly, rig: Object.assign({}, rigFor(Ly.rigOf || Ly.id), Ly.rig || {}), grid: makeGrid(gl, Ly, pg.w, pg.h) };
    });
    function setPage(i, im) {
      if (texs[i]) { gl.deleteTexture(texs[i]); texs[i] = null; }
      if (im) texs[i] = makeTex(gl, im);
    }
    const hasPage = (i) => !!texs[i];
    const byId = Object.fromEntries(layers.map((l) => [l.id, l]));

    const fx = fxCanvas.getContext('2d');
    const view = { s: 1, ox: 0, oy: 0, w: 1, h: 1, dpr: 1 };

    function resize() {
      const r = glCanvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      view.w = Math.max(1, r.width);
      view.h = Math.max(1, r.height);
      view.dpr = dpr;
      for (const c of [glCanvas, fxCanvas]) {
        c.width = Math.round(view.w * dpr);
        c.height = Math.round(view.h * dpr);
      }
      const pad = 0.03;
      view.s = Math.min((view.w * (1 - pad * 2)) / XH.IW, (view.h * (1 - pad * 2)) / XH.IH);
      view.ox = (view.w - XH.IW * view.s) / 2;
      view.oy = (view.h - XH.IH * view.s) / 2;
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    }

    /* 层内局部变换（在变形之前，单位：原图像素）。返回 [dx, dy, sx, sy, ox, oy] */
    /* 眼睑行程：0 = 睁开，1 = 合到闭眼线位置（眼眶 62% 处）。笑眼时只合到 45% 并向上弯 */
    const lidTravel = (G, smile) => lerp((G.low - G.top) * 0.62, (G.low - G.top) * 0.45, smile);
    const closeAmt = (L, k) => 1 - Math.pow(clamp(L['ParamEye' + k + 'Open'], 0, 1), 0.8);
    function localXf(l, L) {
      const r = l.rig;
      if (r.eye) {
        const G = EYE[r.eye];
        const smile = clamp(L['ParamEye' + r.eye + 'Smile'], 0, 1);
        if (EYEBALL[r.part]) {
          /* 视线：虹膜 / 瞳孔在眼白里移动；高光反向少量移动（球面反光感） */
          const k = r.part === 'EyeHi' ? -0.35 : r.part === 'Pupil' ? 1.12 : 1;
          return [L.ParamEyeBallX * 14 * k, L.ParamEyeBallY * 8 * k, 1, 1, 0, 0];
        }
        if (r.part === 'EyeLidUp') {
          /* 眼睑合上：睫毛下移并压扁（锚点在睫毛中心），最后 15% 交给闭眼线 */
          const c = closeAmt(L, r.eye);
          return [0, lidTravel(G, smile) * c, 1, lerp(1, 0.55, c), G.cx, G.top + G.lashH * 0.5];
        }
        if (r.part === 'EyeLidLow') {
          const open = clamp(L['ParamEye' + r.eye + 'Open'], 0, 1);
          return [0, -smile * open * (G.low - G.top) * 0.2, 1, 1, 0, 0];
        }
        if (r.part === 'EyeClose' || r.part === 'EyeSmile') return [0, 0, 1, 1, 0, 0];
        if (r.part === 'Brow') {
          /* 眉毛：笑 → 上扬；闭眼 → 微降 */
          const c = closeAmt(L, r.eye);
          return [0, -smile * 7 + c * (1 - smile) * 4 + (L['ParamBrow' + r.eye + 'Y'] || 0), 1, 1, 0, 0];
        }
      }
      if (r.mouth) {
        /* 嘴以上唇线为锚点缩放；ParamMouthOpenY 0.6 = 原画张开程度 */
        const M = XH.MOUTH, o = clamp(L.ParamMouthOpenY / 0.6, 0, 1.35);
        const sy = lerp(0.08, 1, Math.min(o, 1)) * (o > 1 ? o : 1);
        const sx = lerp(0.86, 1, (clamp(L.ParamMouthForm, -1, 1) + 1) / 2) * lerp(0.8, 1, ss(0, 0.8, o));
        return [0, 0, sx, sy, M.cx, M.top];
      }
      return null;
    }

    function layerAlpha(l, L, opts) {
      const r = l.rig;
      if (r.off && !opts.solo) return 0;
      if (r.prop && !opts.props) return 0;
      if (r.eye) {
        /* 先后顺序：眼睑下移（0 → 0.85）→ 最后 15% 睫毛淡出、闭眼线淡入（交叉不超过 0.1，避免双线） */
        const close = 1 - clamp(L['ParamEye' + r.eye + 'Open'], 0, 1);
        const smile = clamp(L['ParamEye' + r.eye + 'Smile'], 0, 1);
        const swap = ss(0.85, 0.97, close);
        if (r.part === 'EyeClose') return swap * (1 - smile);
        if (r.part === 'EyeSmile') return swap * smile;
        /* 头晕：虹膜 / 瞳孔 / 高光淡出，由 drawFx 画转圈眼 */
        if (EYEBALL[r.part]) return (1 - ss(0.8, 0.9, close)) * (1 - ss(0.1, 0.6, L.ParamDizzy || 0));
        if (r.part === 'EyeWhite') return 1 - ss(0.8, 0.9, close);
        if (r.part === 'EyeLidUp') return 1 - ss(0.86, 0.93, close);
        if (r.part === 'EyeLidLow') return 1 - ss(0.85, 0.95, close);
        return 1;
      }
      if (r.mouth) {
        const openM = L.ParamMouthOpenY / 0.6;
        const shapeOpen = ss(0.12, 0.45, openM);
        const shapeW = Math.max(
          clamp(L.ParamMouthSmile || 0, 0, 1), clamp(L.ParamMouthCat || 0, 0, 1),
          clamp(L.ParamMouthPout || 0, 0, 1), clamp(L.ParamMouthWavy || 0, 0, 1));
        const base = ss(0.04, 0.3, openM) * (r.tongue ? ss(0.2, 0.5, openM) : 1);
        return base * (1 - shapeW * (1 - shapeOpen));
      }
      if (r.mouthShape) {
        const openM = L.ParamMouthOpenY / 0.6;
        const shapeOpen = ss(0.12, 0.45, openM);
        const w = clamp(L['ParamMouth' + r.mouthShape] || 0, 0, 1);
        const total = Math.max(
          clamp(L.ParamMouthSmile || 0, 0, 1), clamp(L.ParamMouthCat || 0, 0, 1),
          clamp(L.ParamMouthPout || 0, 0, 1), clamp(L.ParamMouthWavy || 0, 0, 1));
        return total > 0 ? (w / total) * (1 - shapeOpen) : 0;
      }
      if (r.mouthClose) {
        const openM = L.ParamMouthOpenY / 0.6;
        const shapeOpen = ss(0.12, 0.45, openM);
        const shapeW = Math.max(
          clamp(L.ParamMouthSmile || 0, 0, 1), clamp(L.ParamMouthCat || 0, 0, 1),
          clamp(L.ParamMouthPout || 0, 0, 1), clamp(L.ParamMouthWavy || 0, 0, 1));
        return ss(0.24, 0.05, openM) * (1 - shapeW * (1 - shapeOpen));
      }
      if (r.cloudFace != null) { const f = clamp(L.ParamCloudFace, 0, 1); return r.cloudFace ? ss(0.35, 0.65, f) : 1 - ss(0.35, 0.65, f); }
      if (r.blush) return Math.max(clamp((L.ParamCheek - 0.6) / 0.4, 0, 1), clamp(L.ParamBlush || 0, 0, 1));
      if (r.star != null) return 1;
      return l.hidden ? 0 : 1;
    }

    const tmp = [0, 0];
    function drawLayer(l, L, alpha) {
      const G = l.grid, r = l.rig;
      const xf = localXf(l, L);
      for (let k = 0; k < G.n * 2; k += 2) {
        let u = G.base[k], v = G.base[k + 1];
        if (xf) {
          const px = u * XH.IW, py = v * XH.IH;
          u = (xf[4] + (px - xf[4]) * xf[2] + xf[0]) / XH.IW;
          v = (xf[5] + (py - xf[5]) * xf[3] + xf[1]) / XH.IH;
        }
        XH.deform(u, v, L, G.pos, k, r);
        /* 保险：任何参数异常导致的 NaN 都退回原位，图层不会整块消失 */
        if (!(G.pos[k] === G.pos[k]) || !(G.pos[k + 1] === G.pos[k + 1])) { G.pos[k] = G.base[k]; G.pos[k + 1] = G.base[k + 1]; }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, G.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, G.pos);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, G.uvBuf);
      gl.enableVertexAttribArray(aUV);
      gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, G.idxBuf);
      const sf = window.XH.dress && window.XH.dress.surface(l.id);
      if (sf) {
        gl.uniform3f(uTint, sf.tint[0], sf.tint[1], sf.tint[2]);
        gl.uniform1f(uPatOn, sf.pat ? 1 : 0);
        gl.uniform1f(uPatMix, sf.mix || 0);
        gl.uniform1f(uPatScale, sf.scale || 1);
        if (sf.pat && patTex[sf.pat]) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, patTex[sf.pat]);
        }
      } else {
        gl.uniform3f(uTint, 1, 1, 1);
        gl.uniform1f(uPatOn, 0);
        gl.uniform1f(uPatMix, 0);
        gl.uniform1f(uPatScale, 1);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texs[l.page]);

      gl.uniform1f(uAlpha, alpha);
      gl.drawElements(gl.TRIANGLES, G.count, gl.UNSIGNED_SHORT, 0);
    }

    /* 眼眶裁剪：眼白 / 虹膜只画在“眼睑下沿以下、下眼睑以上”。变形后的坐标由眼眶中心点推算 */
    function eyeClip(key, L) {
      const G = EYE[key];
      XH.deform(G.cx / XH.IW, (G.top + G.low) / 2 / XH.IH, L, tmp, 0, { head: 0.018 });
      const dx = tmp[0] * XH.IW - G.cx, dy = tmp[1] * XH.IH - (G.top + G.low) / 2;
      const open = clamp(L['ParamEye' + key + 'Open'], 0, 1), smile = clamp(L['ParamEye' + key + 'Smile'], 0, 1);
      const lidY = G.top + G.lashH * 0.6 + lidTravel(G, smile) * closeAmt(L, key);
      const lowY = G.low + 6 - smile * open * (G.low - G.top) * 0.2;
      return { x0: (G.x0 - 30 + dx) / XH.IW, x1: (G.x1 + 30 + dx) / XH.IW, y0: (lidY + dy) / XH.IH, y1: (lowY + dy) / XH.IH, rot: L.ParamAngleZ };
    }

    const toScreen = (x, y) => [view.ox + x * view.s, view.oy + y * view.s];

    function drawFx(L, t, props, zzz) {
      const dpr = view.dpr;
      fx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fx.clearRect(0, 0, view.w, view.h);
      if (sw.on) {
        /* 屏幕空间里同一个摇摆：x' = M (x − P) + P（视图是等比缩放，矩阵不变） */
        const [qx, qy] = toScreen(sw.px, sw.py);
        fx.setTransform(dpr * sw.a, dpr * sw.c, dpr * sw.b, dpr * sw.d, dpr * (qx - sw.a * qx - sw.b * qy), dpr * (qy - sw.c * qx - sw.d * qy));
      }
      const s = view.s;
      if (props) {
        XH.STARS.forEach(([x, y, r], i) => {
          const tw = Math.max(0, Math.sin(t * 1.6 + i * 1.9)) ** 6 * L.ParamStarTwinkle;
          if (tw < 0.02) return;
          const [sx, sy] = toScreen(x, y);
          const R = r * s * 1.1;
          fx.save();
          fx.globalAlpha = tw;
          fx.fillStyle = '#FFF8DA';
          fx.beginPath();
          fx.moveTo(sx, sy - R);
          fx.quadraticCurveTo(sx, sy, sx + R * 0.32, sy);
          fx.quadraticCurveTo(sx, sy, sx, sy + R);
          fx.quadraticCurveTo(sx, sy, sx - R * 0.32, sy);
          fx.quadraticCurveTo(sx, sy, sx, sy - R);
          fx.fill();
          fx.restore();
        });

      }
      /* 表情符号：挂在头部变形上，随转头 / 歪头一起动（坐标为网页图像素） */
      const headPt = (x, y, k = 0.016) => { XH.deform(x / XH.IW, y / XH.IH, L, tmp, 0, { head: k }); return toScreen(tmp[0] * XH.IW, tmp[1] * XH.IH); };
      const spark = clamp(L.ParamEyeSpark || 0, 0, 1);
      if (spark > 0.01) {
        /* 星星眼：瞳孔上的四角星 + 旁边的小亮点，轻轻呼吸闪动 */
        const star = (x, y, rx, ry) => {
          fx.beginPath();
          fx.moveTo(x, y - ry);
          fx.quadraticCurveTo(x + rx * 0.12, y - ry * 0.12, x + rx, y);
          fx.quadraticCurveTo(x + rx * 0.12, y + ry * 0.12, x, y + ry);
          fx.quadraticCurveTo(x - rx * 0.12, y + ry * 0.12, x - rx, y);
          fx.quadraticCurveTo(x - rx * 0.12, y - ry * 0.12, x, y - ry);
          fx.closePath();
          fx.fill();
        };
        fx.save();
        fx.globalCompositeOperation = 'lighter';
        for (const k of ['R', 'L']) {
          const G = EYE[k], cy = G.top + (G.low - G.top) * 0.52;
          const [x, y] = headPt(G.cx, cy, 0.018);
          const R = Math.min(G.x1 - G.x0, G.low - G.top) * 0.42 * s * spark;
          const pulse = 0.78 + 0.22 * Math.sin(t * 7 + (k === 'R' ? 0 : 2.1));
          fx.globalAlpha = spark * 0.95;
          fx.fillStyle = '#FFFDF2';
          star(x, y, R * 0.55 * pulse, R * 0.92 * pulse);
          fx.fillStyle = '#FFE6A8';
          star(x + R * 0.62, y - R * 0.42, R * 0.3, R * 0.5);
          fx.globalAlpha = spark * 0.7;
          fx.beginPath(); fx.arc(x - R * 0.62, y + R * 0.38, R * 0.12, 0, Math.PI * 2); fx.fill();
        }
        fx.restore();
      }
      const shy = clamp(L.ParamShy || 0, 0, 1);
      if (shy > 0.01) {
        /* 害羞红晕斜线 ///：每颊 3 道，依次出现，轻微抖动 */
        fx.save();
        fx.strokeStyle = '#E2686B';
        fx.lineCap = 'round';
        fx.lineWidth = Math.max(1.6, 8 * s);
        for (const [cx, cy] of [[462, 664], [742, 654]]) {
          for (let j = 0; j < 3; j++) {
            const a = clamp(shy * 3 - j * 0.6, 0, 1);
            if (a <= 0) continue;
            const jit = Math.sin(t * 22 + j * 2 + cx) * 2;
            const [x0, y0] = headPt(cx - 44 + j * 30 + jit, cy + 20);
            const [x1, y1] = headPt(cx - 24 + j * 30 + jit, cy - 20);
            fx.globalAlpha = a * 0.85;
            fx.beginPath(); fx.moveTo(x0, y0); fx.lineTo(x1, y1); fx.stroke();
          }
        }
        fx.restore();
      }
      const drop = (x, y, r, a, fill) => {
        fx.save();
        fx.globalAlpha = a;
        fx.fillStyle = fill;
        fx.strokeStyle = '#6E95B5';
        fx.lineWidth = Math.max(1, 2.4 * s);
        fx.beginPath();
        fx.moveTo(x, y - r * 1.7);
        fx.bezierCurveTo(x + r * 0.5, y - r * 0.9, x + r, y - r * 0.3, x + r, y + r * 0.15);
        fx.arc(x, y + r * 0.15, r, 0, Math.PI);
        fx.bezierCurveTo(x - r, y - r * 0.3, x - r * 0.5, y - r * 0.9, x, y - r * 1.7);
        fx.fill(); fx.stroke();
        fx.fillStyle = '#FFFFFF';
        fx.beginPath(); fx.ellipse(x - r * 0.35, y, r * 0.18, r * 0.32, -0.4, 0, Math.PI * 2); fx.fill();
        fx.restore();
      };
      const dz = clamp(L.ParamDizzy || 0, 0, 1);
      if (dz > 0.01) {
        /* 头晕转圈眼：每只眼里一条旋转的螺旋线（虹膜层已淡出） */
        fx.save();
        fx.globalAlpha = ss(0.1, 0.6, dz);
        fx.strokeStyle = '#4A3A32';
        fx.lineCap = 'round';
        fx.lineWidth = Math.max(1.2, 5 * s);
        for (const k of ['R', 'L']) {
          const G = EYE[k], cy = G.top + (G.low - G.top) * 0.55;
          const [x, y] = headPt(G.cx, cy, 0.018);
          const R = Math.min(G.x1 - G.x0, G.low - G.top) * 0.36 * s;
          const ph = t * 9 * (k === 'R' ? 1 : -1);
          fx.beginPath();
          for (let i = 0; i <= 48; i++) {
            const q = i / 48, a = ph + q * Math.PI * 5 * (k === 'R' ? 1 : -1), r = R * q;
            const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.9;
            if (i) fx.lineTo(px, py); else fx.moveTo(px, py);
          }
          fx.stroke();
        }
        fx.restore();
      }
      const swt = clamp(L.ParamSweat || 0, 0, 1);
      if (swt > 0.01) {
        const [x, y] = headPt(842, 540 + swt * 18, 0.02);
        drop(x, y, 26 * s, swt, '#CFE6F6');
      }
      const tear = clamp(L.ParamTear || 0, 0, 1);
      if (tear > 0.01) {
        const [x, y] = headPt(784, 622 + tear * 10, 0.018);
        drop(x, y, 14 * s, tear, '#DDEFFB');
      }
      const q = clamp(L.ParamQ || 0, 0, 1);
      if (q > 0.01) {
        const [x, y] = headPt(880, 300 - q * 16 + Math.sin(t * 5) * 4, 0.02);
        fx.save();
        fx.globalAlpha = q;
        fx.translate(x, y);
        fx.rotate(0.18 + Math.sin(t * 3) * 0.08);
        fx.font = `800 ${Math.max(14, 92 * s)}px "Trebuchet MS", sans-serif`;
        fx.textAlign = 'center';
        fx.lineJoin = 'round';
        fx.lineWidth = Math.max(2, 10 * s);
        fx.strokeStyle = '#FFFFFF';
        fx.strokeText('?', 0, 0);
        fx.fillStyle = '#7A5A44';
        fx.fillText('?', 0, 0);
        fx.restore();
      }
      const note = clamp(L.ParamNote || 0, 0, 1);
      if (note > 0.01) {
        /* 哼歌音符：3 个 ♪ 从头侧依次飘起、左右轻摆、淡出 */
        fx.save();
        fx.textAlign = 'center';
        fx.lineJoin = 'round';
        for (let i = 0; i < 3; i++) {
          const ph = (t * 0.55 + i / 3) % 1;
          const [x, y] = headPt(890 + Math.sin(ph * 6 + i) * 22, 420 - ph * 260, 0.02);
          fx.globalAlpha = note * Math.sin(ph * Math.PI);
          fx.font = `700 ${Math.max(12, (54 + i * 10) * s)}px "Segoe UI Symbol", "Segoe UI", sans-serif`;
          fx.lineWidth = Math.max(2, 8 * s);
          fx.strokeStyle = '#FFFFFF';
          fx.strokeText(i === 1 ? '♫' : '♪', x, y);
          fx.fillStyle = '#8B6A4E';
          fx.fillText(i === 1 ? '♫' : '♪', x, y);
        }
        fx.restore();
      }
      const ang = clamp(L.ParamAngry || 0, 0, 1);
      if (ang > 0.01) {
        /* 生气“井”字青筋：四段弧，一跳一跳 */
        const [x, y] = headPt(818, 368, 0.02);
        const R = 30 * s * (0.85 + 0.15 * Math.abs(Math.sin(t * 7))) * ss(0, 0.6, ang) ;
        fx.save();
        fx.globalAlpha = ang;
        fx.strokeStyle = '#E0534F';
        fx.lineCap = 'round';
        fx.lineWidth = Math.max(1.5, 6 * s);
        fx.translate(x, y);
        for (let k = 0; k < 4; k++) {
          fx.rotate(Math.PI / 2);
          fx.beginPath();
          fx.arc(R * 1.15, R * 1.15, R, Math.PI * 1.05, Math.PI * 1.45);
          fx.stroke();
        }
        fx.restore();
      }
      if (zzz > 0.02) {
        const [hx, hy] = toScreen(860, 360);
        fx.save();
        fx.fillStyle = '#4A524D';
        for (let i = 0; i < 3; i++) {
          const ph = (t * 0.35 + i / 3) % 1;
          fx.globalAlpha = zzz * Math.sin(ph * Math.PI);
          const k = 0.6 + ph * 0.6;
          fx.font = `600 ${Math.max(12, 56 * s * k)}px serif`;
          fx.fillText('z', hx + ph * 90 * s, hy - ph * 160 * s);
        }
        fx.restore();
      }
    }

    const NOCLIP = [-10, -10, 10, 10];
    function render(L, t, opts) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform4f(uView, (XH.IW * view.s) / view.w, (XH.IH * view.s) / view.h, view.ox / view.w, view.oy / view.h);
      swingFrom(L);
      /* 像素空间矩阵换到 uv 空间：Muv = D⁻¹ M D，D = diag(IW, IH)；mat2 按列主序上传 */
      const r = XH.IH / XH.IW;
      const SWM = [sw.a, sw.c / r, sw.b * r, sw.d], ID = [1, 0, 0, 1];
      let swFixed = null; // 背景散件 / 星星（fixed）不跟着摆
      gl.uniformMatrix2fv(uSwM, false, SWM);
      gl.uniform2f(uSwP, sw.px / XH.IW, sw.py / XH.IH);
      const clips = { L: eyeClip('L', L), R: eyeClip('R', L) };
      for (const l of layers) {
        if (opts.solo && opts.solo !== l.id) continue;
        if (opts.hide && opts.hide[l.id]) continue;
        if (!texs[l.page]) continue;
        const a = layerAlpha(l, L, opts);
        if (a <= 0.003) continue;
        const r = l.rig;
        if (r.eye && (r.part === 'EyeWhite' || EYEBALL[r.part])) {
          const c = clips[r.eye];
          gl.uniform4f(uClip, c.x0, c.y0, c.x1, c.y1);
        } else gl.uniform4f(uClip, ...NOCLIP);
        const f = !!r.fixed;
        if (f !== swFixed) { swFixed = f; gl.uniformMatrix2fv(uSwM, false, f ? ID : SWM); }
        drawLayer(l, L, a);
      }
      drawFx(L, t, opts.props, opts.zzz);
    }

    /* 屏幕 → 原图像素（扣掉摇摆：松手后还在晃时点击也准） */
    const toImage = (cx, cy) => {
      let x = (cx - view.ox) / view.s, y = (cy - view.oy) / view.s;
      if (sw.on) {
        const det = sw.a * sw.d - sw.b * sw.c || 1, dx = x - sw.px, dy = y - sw.py;
        x = sw.px + (sw.d * dx - sw.b * dy) / det;
        y = sw.py + (-sw.c * dx + sw.a * dy) / det;
      }
      return [x, y];
    };

    /* 桌宠点击穿透用：读 (cx, cy) 周围 rad 像素方块内的最大不透明度（0–1）。必须在 render() 之后同一帧内调用 */
    let pxBuf = null;
    function alphaAt(cx, cy, rad = 6) {
      const d = view.dpr, r = Math.max(1, Math.round(rad * d)), w = r * 2 + 1;
      const x = Math.round(cx * d) - r, y = Math.round(glCanvas.height - cy * d) - r;
      if (x + w < 0 || y + w < 0 || x >= glCanvas.width || y >= glCanvas.height) return 0;
      if (!pxBuf || pxBuf.length !== w * w * 4) pxBuf = new Uint8Array(w * w * 4);
      pxBuf.fill(0);
      gl.readPixels(x, y, w, w, gl.RGBA, gl.UNSIGNED_BYTE, pxBuf);
      let m = 0;
      for (let i = 3; i < pxBuf.length; i += 4) if (pxBuf[i] > m) m = pxBuf[i];
      return m / 255;
    }

    /* 原图点 (x, y)（跟头部变形 + 拖动摇摆）→ 画布客户区坐标。气泡锚点用 */
    function headScreen(L, x, y, k = 0.016) {
      XH.deform(x / XH.IW, y / XH.IH, L, tmp, 0, { head: k, fall: 0 });
      let px = tmp[0] * XH.IW, py = tmp[1] * XH.IH;
      if (sw.on) { const dx = px - sw.px, dy = py - sw.py; px = sw.px + sw.a * dx + sw.b * dy; py = sw.py + sw.c * dx + sw.d * dy; }
      return toScreen(px, py);
    }

    resize();
    return { render, resize, toImage, alphaAt, headScreen, view, layers, byId, setPage, hasPage, swingDeg: () => (sw.on ? Math.atan2(sw.c, sw.a) * 180 / Math.PI : 0) };
  };
})();

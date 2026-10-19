/* 小嬅 · 轻量音效（Web Audio 实时合成，不带任何音频文件）
   - XH.sfx.play(name, {auto})  按动作名播放；auto = 待机时自己做的动作，音量减半
   - XH.sfx.set({ sfx: bool, vol: 0–100, voice: bool })
   - XH.sfx.unlock()  在用户手势里调用一次，解除浏览器自动播放限制
   两层声音：
   - 音色层：叮叮、啵嗒这类短音（tone / air）
   - 人声层：合成的小女孩声色（voice）—— 基频 420–700Hz + 三个共振峰模拟元音“啊 / 嗯 / 唔 / 哎 / 呀”，带颤音和气声。
     voice 关掉时，用对应的柔和短音代替
   规则：深夜 23–6 点音量再减半；同一音效 0.4s 内不重复；没有对应音效的动作（待机小动作 / 收尾）保持安静
   v0.1.4：人声更甜更高、不尖（见 voice 注释）；v0.1.3：默认音量 40% → 25%，各音效本身再压低约 30%，总线加 5.5kHz 低通去刺；生气、哈欠改软；拖动改亮 */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});
  const S = { on: true, vol: 0.25, voice: true };
  let ctx = null, master = null, noiseBuf = null;
  const last = {};

  function ac() {
    if (ctx) return ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    /* 总线：低通去掉刺耳的高频 → 轻压限，防止叠音爆音 */
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 5500; lp.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4; comp.knee.value = 10;
    master = ctx.createGain();
    master.connect(lp); lp.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /* 包络：短 attack，指数衰减到 d */
  function env(g, t0, v, a, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  }

  /* 单个音：频率从 f 滑到 f2 */
  function tone(t0, o) {
    const { f, f2 = f, d = 0.12, type = 'sine', v = 0.3, a = 0.01, vib = 0 } = o;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (f2 !== f) osc.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    if (vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 8; lg.gain.value = f * vib;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t0 + d + 0.05);
    }
    env(g, t0, v, a, d);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + d + 0.05);
  }

  /* 气声 / 扫动：带通噪声，滤波频率可滑动 */
  function air(t0, o) {
    const { f = 800, f2 = f, q = 2, d = 0.3, v = 0.15, a = 0.05 } = o;
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f, t0);
    bp.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    env(g, t0, v, a, d);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + d + 0.05);
  }

  /* ---------- 人声层：小女孩声色（v0.1.4：更甜、更高、不尖） ----------
     “尖”主要来自 2.5–5kHz 的泛音，而不是音高本身，所以：
     - 音高整体 ×PITCH_K（约 +3.5 个半音），各音效里写的音调曲线保持不变
     - 声源：三角波为主 + 30% 锯齿（原来纯锯齿，泛音太多；太少又会像口哨）
     - 共振峰：F2 减弱、F3 几乎去掉，元音整体偏圆（啊 / 哎带一点“哦”）
     - 人声单独过一道 3kHz −6dB 的削峰 + 4.2kHz 低通；气声先低通 2.2kHz 去嘶嘶声
     - 颤音：幅度 ×VIB_K（1/3），4.8Hz，声音出来 0.15s 后才进；短于 0.3s 的声音不加 */
  const PITCH_K = Math.pow(2, 3.5 / 12), VIB_K = 1 / 3;
  /* 元音共振峰：[F1, F2, F3] + 各峰增益 */
  const VOW = {
    a: { f: [980, 1500, 3300], g: [1, 0.5, 0.05] }, // 啊 / 呀（偏圆）
    e: { f: [680, 2100, 3400], g: [1, 0.42, 0.05] }, // 哎（F2 压低，不发扁）
    i: { f: [480, 2500, 3600], g: [1, 0.28, 0.04] },  // 咿
    o: { f: [700, 1100, 3200], g: [1, 0.45, 0.04] }, // 哦
    u: { f: [480, 1000, 3100], g: [1, 0.32, 0.03] }, // 唔
    n: { f: [360, 2100, 3200], g: [1, 0.08, 0.02] }, // 嗯 / 哼（鼻音）
  };
  const LVL = { a: 0.75, e: 0.6, o: 1.2, i: 1.1, u: 3, n: 2.1 };
  /* voice(t0, { vow: 'a' 或 [[时间, 元音], …], pitch: [[时间, Hz], …], d, v, a, vib, breath }) */
  function voice(t0, o) {
    const { vow = 'a', pitch = [[0, 520]], d = 0.3, v = 0.25, a = 0.05, vib = 0.012, breath = 0.12, raw = false } = o;
    const vows = typeof vow === 'string' ? [[0, vow]] : vow;
    const P = raw ? pitch : pitch.map(([tt, f]) => [tt, f * PITCH_K]); // raw：已是最终音高（哼歌要和叮叮声同调）
    /* 声源：三角波 + 少量锯齿，频率曲线一致 */
    const tri = ctx.createOscillator(), saw = ctx.createOscillator(), sg = ctx.createGain();
    tri.type = 'triangle'; saw.type = 'sawtooth'; sg.gain.value = 0.3;
    for (const osc of [tri, saw]) {
      osc.frequency.setValueAtTime(P[0][1], t0);
      for (let i = 1; i < P.length; i++) osc.frequency.linearRampToValueAtTime(P[i][1], t0 + P[i][0]);
    }
    const src = ctx.createGain();
    tri.connect(src); saw.connect(sg); sg.connect(src);
    /* 颤音：只给长音，起音 0.15s 后再慢慢进来 */
    let lfo = null;
    if (vib > 0 && d >= 0.3) {
      const lg = ctx.createGain();
      lfo = ctx.createOscillator(); lfo.frequency.value = 4.8;
      lg.gain.setValueAtTime(0, t0);
      lg.gain.setValueAtTime(0, t0 + 0.15);
      lg.gain.linearRampToValueAtTime(P[0][1] * vib * VIB_K, t0 + Math.min(d, 0.3));
      lfo.connect(lg); lg.connect(tri.frequency); lg.connect(saw.frequency);
    }
    /* 气声：低通去嘶嘶声 */
    const nz = ctx.createBufferSource(), nlp = ctx.createBiquadFilter(), ng = ctx.createGain();
    nz.buffer = noiseBuf; nlp.type = 'lowpass'; nlp.frequency.value = 2200; ng.gain.value = breath;
    nz.connect(nlp); nlp.connect(ng);
    /* 输出：3kHz 削峰 → 4.2kHz 低通 → 包络 */
    const dip = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), out = ctx.createGain();
    dip.type = 'peaking'; dip.frequency.value = 3000; dip.Q.value = 0.9; dip.gain.value = -6;
    lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.5;
    dip.connect(lp); lp.connect(out);
    /* 鼻音 n、圆唇 u 的共振峰都在音高附近或以下，滤完更轻，按元音补响度，让各音效音量大致齐平 */
    env(out, t0, v * 0.5 * (LVL[vows[0][1]] || 1), a, d);
    out.connect(master);
    for (let k = 0; k < 3; k++) {
      const bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass';
      const F0 = VOW[vows[0][1]];
      bp.frequency.setValueAtTime(F0.f[k], t0);
      bp.Q.value = F0.f[k] / (k === 0 ? 110 : k === 1 ? 160 : 240);
      g.gain.setValueAtTime(F0.g[k] * (k ? 1.4 : 1), t0);
      for (let i = 1; i < vows.length; i++) { /* 元音过渡：共振峰平滑滑过去 */
        const F = VOW[vows[i][1]], tt = t0 + vows[i][0];
        bp.frequency.linearRampToValueAtTime(F.f[k], tt);
        g.gain.linearRampToValueAtTime(F.g[k] * (k ? 1.4 : 1), tt);
      }
      src.connect(bp); ng.connect(bp); bp.connect(g); g.connect(dip);
    }
    const end = t0 + d + 0.05;
    tri.start(t0); tri.stop(end); saw.start(t0); saw.stop(end); nz.start(t0); nz.stop(end);
    if (lfo) { lfo.start(t0); lfo.stop(end); }
  }
  /* 五声音阶，哼歌用（小女孩哼唱音域 C5–A5） */
  const HUM = [523.3, 587.3, 659.3, 784, 880].map((f) => f * Math.pow(2, 3 / 12)); // v0.1.4 整体上移小三度（E♭5–C6），仍是五声音阶
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const sparkle = (t, fs, step, v) => fs.forEach((f, i) => tone(t + i * step, { f, d: 0.2, v }));

  /* 每个音效：fn(t, V)，V = 是否带人声 */
  const SFX = {
    /* 打招呼：“哎~”上扬，接叮-叮 */
    greet: (t, V) => {
      /* 结尾再轻轻往上翘一点（甜） */
      if (V) voice(t, { vow: 'e', pitch: [[0, 500], [0.16, 600], [0.24, 660]], d: 0.26, v: 0.26 });
      tone(t + (V ? 0.2 : 0), { f: 880, d: 0.12, type: 'triangle', v: V ? 0.12 : 0.2 });
      tone(t + (V ? 0.31 : 0.11), { f: 1318.5, d: 0.2, type: 'triangle', v: V ? 0.1 : 0.18 });
    },
    wave: (t) => { [987.8, 1318.5, 1568].forEach((f, i) => tone(t + i * 0.1, { f, d: i === 2 ? 0.18 : 0.1, type: 'triangle', v: 0.17 })); },
    nod: (t) => { tone(t, { f: 560, f2: 440, d: 0.09, type: 'triangle', v: 0.26, a: 0.004 }); },
    /* 歪头：疑问的“嗯？” */
    tilt: (t, V) => {
      if (V) voice(t, { vow: 'n', pitch: [[0, 440], [0.12, 450], [0.26, 620], [0.32, 660]], d: 0.32, v: 0.3, vib: 0, breath: 0.08 });
      else tone(t, { f: 700, f2: 1250, d: 0.16, v: 0.2 });
    },
    peek: (t, V) => {
      if (V) voice(t, { vow: [[0, 'n'], [0.14, 'i']], pitch: [[0, 480], [0.2, 660]], d: 0.24, v: 0.26, breath: 0.08 });
      else { tone(t, { f: 900, f2: 1500, d: 0.13, v: 0.18 }); tone(t + 0.14, { f: 1500, d: 0.06, v: 0.1 }); }
    },
    look: (t) => { air(t, { f: 1800, f2: 3000, q: 4, d: 0.22, v: 0.09 }); air(t + 0.28, { f: 3000, f2: 1800, q: 4, d: 0.22, v: 0.07 }); },
    /* 小跳：更亮的“啵”+ 一点闪光 */
    hop: (t) => { tone(t, { f: 520, f2: 1040, d: 0.12, type: 'triangle', v: 0.24, a: 0.004 }); tone(t + 0.09, { f: 1760, d: 0.1, v: 0.08 }); },
    /* 被拎起来：轻快上扬的“咻”+ 小小一声“呀” */
    lift: (t, V) => {
      air(t, { f: 1200, f2: 3200, q: 1.6, d: 0.2, v: 0.08, a: 0.04 });
      if (V) voice(t + 0.02, { vow: [[0, 'i'], [0.06, 'a']], pitch: [[0, 560], [0.16, 700]], d: 0.18, v: 0.24, a: 0.03, vib: 0 });
      else tone(t, { f: 700, f2: 1400, d: 0.14, type: 'triangle', v: 0.18 });
    },
    /* 落地：亮一点的“啵嗒”，去掉了原来 90–180Hz 的闷声 */
    drop: (t) => {
      tone(t, { f: 900, f2: 620, d: 0.07, type: 'triangle', v: 0.17, a: 0.002 });
      tone(t + 0.075, { f: 1250, f2: 940, d: 0.08, type: 'triangle', v: 0.14, a: 0.002 });
      tone(t + 0.12, { f: 2637, d: 0.16, v: 0.06 });
    },
    /* 头晕：音高打转的“呜哇～”+ 两颗小星星叮 */
    dizzy: (t, V) => {
      if (V) voice(t, { vow: [[0, 'u'], [0.3, 'a'], [0.6, 'a']], pitch: [[0, 620], [0.15, 520], [0.3, 640], [0.45, 500], [0.7, 420]], d: 0.75, v: 0.2, a: 0.05, vib: 0 });
      else tone(t, { f: 900, f2: 450, d: 0.5, type: 'triangle', v: 0.12, a: 0.02 });
      tone(t + 0.1, { f: 2093, d: 0.12, v: 0.05 }); tone(t + 0.3, { f: 2637, d: 0.12, v: 0.04 });
    },
    /* 生气：鼓着气的两声“哼哼”—— 鼻音、慢起音、很轻；不再用方波 */
    angry: (t, V) => {
      if (V) {
        voice(t, { vow: 'n', pitch: [[0, 540], [0.18, 450]], d: 0.2, v: 0.2, a: 0.05, vib: 0, breath: 0.22 });
        voice(t + 0.26, { vow: 'n', pitch: [[0, 520], [0.2, 420]], d: 0.22, v: 0.18, a: 0.05, vib: 0, breath: 0.22 });
      } else {
        tone(t, { f: 460, f2: 380, d: 0.16, type: 'triangle', v: 0.085, a: 0.03 });
        tone(t + 0.22, { f: 430, f2: 350, d: 0.18, type: 'triangle', v: 0.075, a: 0.03 });
      }
    },
    shy: (t, V) => {
      if (V) voice(t, { vow: 'u', pitch: [[0, 560], [0.45, 490]], d: 0.48, v: 0.2, a: 0.07, vib: 0.03, breath: 0.16 });
      sparkle(t + (V ? 0.08 : 0), [1568, 1864.7, 2093], 0.06, V ? 0.045 : 0.14);
    },
    /* 哈欠：“啊~呼”——音调从高处慢慢滑下，结尾一口软软的呼气；去掉了原来的低频持续音 */
    yawn: (t, V) => {
      if (V) voice(t, { vow: [[0, 'a'], [0.4, 'o'], [0.62, 'u']], pitch: [[0, 640], [0.15, 660], [0.65, 430]], d: 0.7, v: 0.22, a: 0.15, vib: 0.012, breath: 0.2 });
      else tone(t, { f: 700, f2: 480, d: 0.55, v: 0.1, a: 0.12 });
      air(t + 0.5, { f: 1100, f2: 650, q: 1.2, d: 0.42, v: 0.05, a: 0.1 });
    },
    /* 哼歌：“嗯~啦”哼唱，和飘起的音符同步（0.4s 起，5 个音） */
    hum: (t, V) => {
      for (let i = 0; i < 5; i++) {
        const tt = t + 0.4 + i * 0.62 + Math.random() * 0.05, f = pick(HUM);
        if (V) voice(tt, { vow: i % 2 ? [[0, 'n'], [0.08, 'a']] : 'n', pitch: [[0, f * 0.97], [0.05, f]], d: 0.34, v: 0.17, a: 0.04, vib: 0.02, breath: 0.08, raw: true });
        tone(tt, { f, d: 0.3, type: 'triangle', v: V ? 0.035 : 0.17, a: 0.02 });
      }
    },
    daze: (t) => { tone(t, { f: 660, d: 0.6, v: 0.09, a: 0.08, vib: 0.006 }); },
    tapCloud: (t) => { sparkle(t, [2093, 2637, 3136, 2637], 0.07, 0.1); },
    tapHead: (t) => { sparkle(t, [1760, 2349.3, 2793.8], 0.07, 0.11); },
    /* 叫醒：迷糊的“嗯…？” */
    wake: (t, V) => {
      if (V) voice(t, { vow: 'n', pitch: [[0, 420], [0.2, 430], [0.36, 600], [0.42, 630]], d: 0.44, v: 0.22, a: 0.07, breath: 0.14 });
      tone(t + (V ? 0.3 : 0), { f: 1046.5, f2: 1318.5, d: 0.18, v: 0.1 });
    },
    sleep: (t) => { tone(t, { f: 880, f2: 440, d: 0.35, v: 0.12, a: 0.03 }); },
  };

  const night = () => { const h = new Date().getHours(); return h >= 23 || h < 6; };

  function play(name, opt) {
    const fn = SFX[name];
    if (!fn || !S.on || S.vol <= 0) return false;
    const c = ac();
    if (!c) return false;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const now = performance.now();
    if (last[name] && now - last[name] < 400) return false;
    last[name] = now;
    let v = S.vol;
    if (opt && opt.auto) v *= 0.5;
    if (night()) v *= 0.5;
    master.gain.setValueAtTime(v, c.currentTime);
    fn(c.currentTime + 0.01, S.voice);
    return true;
  }

  function set(o) {
    if (!o) return;
    if ('sfx' in o) S.on = !!o.sfx;
    if ('vol' in o) S.vol = Math.max(0, Math.min(100, +o.vol || 0)) / 100;
    if ('voice' in o) S.voice = !!o.voice;
  }

  function unlock() { const c = ac(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }
  ['pointerdown', 'keydown', 'contextmenu'].forEach((ev) => window.addEventListener(ev, unlock, { once: true, capture: true }));

  XH.sfx = { play, set, unlock, names: Object.keys(SFX), state: S, ctx: () => ctx };
})();

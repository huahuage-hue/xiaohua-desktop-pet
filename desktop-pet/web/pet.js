/* 小嬅桌宠 · 网页端桥接（运行在 Tauri 透明窗口里）
   - 光标：窗口开着点击穿透时网页收不到鼠标事件，所以由 Rust 每 30ms 推送全局光标位置（pet://cursor）
   - 点击穿透：每 50ms 读一次光标处（±6px）画面的不透明度：在角色上 → 关闭穿透（能点、能拖）；在空白处 → 打开穿透
   - 拖动：按下后移动超过 6px → 请 Rust 开始拖窗口；Rust 检测到松开左键后推送 pet://drag-end，并负责贴边
   - 普通浏览器直接打开 / 加 ?debug：棋盘格背景 + 判定圆点，用鼠标事件模拟以上流程，方便调试 */
(function () {
  'use strict';
  const T = window.__TAURI__;
  const DEBUG = !T || /[?&]debug\b/.test(location.search);
  if (DEBUG) document.body.classList.add('debug');
  const invoke = T ? T.core.invoke : null;
  const gl = document.getElementById('gl'), dot = document.getElementById('dot'), dbg = document.getElementById('dbg'), quick = document.getElementById('quick');

  const PAD = 6;              // 判定容差（CSS px）：角色边缘外 6px 内也算点到
  /* 不透明度阈值（带回差，边缘不抖）。原画四周有一圈约 0.3 不透明度的淡边框残留（Misc 层），阈值取 0.5 避开它；
     角色本体是实色，配合 ±6px 容差，边缘照样能点到 */
  const ON = 0.5, OFF = 0.35;
  const st = { x: -1, y: -1, inside: false, alpha: 0, hit: false, pass: null, press: null, dragging: false, sinceProbe: 1, simDrag: null };
  window.PET = st;

  function setPass(ignore) {
    if (st.pass === ignore) return;
    st.pass = ignore;
    if (invoke) invoke('set_passthrough', { ignore }).catch(() => { st.pass = null; });
  }

  function boot() {
    if (!window.XH || !XH.pet) return setTimeout(boot, 50);
    const P = XH.pet;

    /* 设置：localStorage 与控制面板窗口共享（同源），面板改动后通过 pet://settings 通知 */
    const DEF = { idleFreq: 2, bubbles: true, follow: true, props: true, react: true, scale: 100, top: true, sfx: true, vol: 25, voice: true, swing: 2, outfit: 'classic', acc: {}, autoDress: true, festival: true, ...(XH.DEF_ASSIST || {}), ...(XH.DEF_SCENE || {}), ...((XH.chat && XH.chat.DEF_CHAT) || {}), ...(XH.DEF_VISION || {}) };
    /* sv：设置版本。v0.1.3 起默认音量 40 → 25；v0.3.0 去掉 roam，加 outfit / acc / autoDress；v0.5.0 加场景感知；v0.6.0 加聊天方式 chatMode */
    const load = () => {
      let s; try { s = JSON.parse(localStorage.getItem('xh-pet') || '{}'); } catch (_) { s = {}; }
      if (!s.sv) { if (s.vol === 40) s.vol = 25; s.sv = 2; }
      if (s.sv < 3) { if (s.roam == null) s.roam = true; s.sv = 3; }
      if (s.sv < 4) { if (s.outfit == null) s.outfit = 'classic'; if (!s.acc) s.acc = {}; if (s.autoDress == null) s.autoDress = true; delete s.roam; s.sv = 4; }
      if (s.sv < 5) { if (s.festival == null) s.festival = true; s.sv = 5; }
      if (s.sv < 6) { if (s.sceneOn == null) s.sceneOn = true; if (s.sceneTitle == null) s.sceneTitle = false; if (s.quietFull == null) s.quietFull = true; if (s.hideFull == null) s.hideFull = false; if (s.sceneBlock == null) s.sceneBlock = ''; s.sv = 6; }
      if (s.sv < 7) { if (s.chatMode == null) s.chatMode = 'comic'; s.sv = 7; }
      return { ...DEF, ...s };
    };
    let S = load();
    P.set(S);
    if (invoke) invoke('set_top', { on: S.top !== false }).catch(() => {});
    window.PET_SETTINGS = () => S;

    /* 光标互动：远处靠近 → 打招呼；停在身上 2s → 歪头；身上快速来回晃 → 生气 */
    const R = { near: true, farAt: 0, still: 0, lx: 0, ly: 0, flips: [], lastDx: 0, cool: 0 };
    const reactTo = (name) => { if (!S.react || P.sleeping() || P.busy() || R.cool > 0 || st.dragging) return; R.cool = 6; P.play(name, true); };
    const onCursor = (x, y, inside) => {
      st.x = x; st.y = y; st.inside = inside;
      if (XH.assist && (x !== R.lx || y !== R.ly)) XH.assist.input(); // 有人在用电脑（喝水提醒计时 / 深夜劝睡）
      P.aim(x, y); // 窗口外也会看向光标
      const dx = x - R.lx, dy = y - R.ly;
      if (Math.hypot(dx, dy) > 2) {
        R.still = 0;
        if (st.hit && Math.abs(dx) > 6) {
          if (R.lastDx && Math.sign(dx) !== Math.sign(R.lastDx)) R.flips.push(performance.now());
          R.lastDx = dx;
        }
      }
      R.lx = x; R.ly = y;
      const W = innerWidth, H = innerHeight, dist = Math.max(0, Math.hypot(Math.max(0, -x, x - W), Math.max(0, -y, y - H)));
      /* 光标在 400px 外待过 3s 以上，再靠近到 120px 内 → 打招呼或偷看（一次靠近只触发一次） */
      const now = performance.now();
      if (dist > 400) { if (!R.farAt) R.farAt = now; R.near = false; }
      else if (dist < 120 && !R.near) { R.near = true; if (R.farAt && now - R.farAt > 3000) reactTo(Math.random() < 0.5 ? 'greet' : 'peek'); R.farAt = 0; }
    };
    const tickReact = (dt) => {
      R.cool -= dt;
      if (st.hit && !st.dragging) { R.still += dt; if (R.still > 2 && R.still - dt <= 2) reactTo('tilt'); }
      const now = performance.now();
      R.flips = R.flips.filter((f) => now - f < 1200);
      if (R.flips.length >= 4) { R.flips = []; reactTo('angry'); }
    };

    /* ---------- 聊天（v0.6.0）：漫画对白输入栏（脚边一条）+ 侧边聊天窗（独立窗口 label=chat，跟着她走） ----------
       对话逻辑仍在本窗口（chat.js）：回复走头顶 chat 气泡；侧边窗只是视图——这里用 pet://chatui 推进度，它用 pet://cmd 回话 */
    const bar = document.getElementById('cb'), input = document.getElementById('cbIn');
    const tip = document.getElementById('cbTip'), tipText = document.getElementById('cbTipText'), retry = document.getElementById('cbRetry');
    const stopBtn = document.getElementById('cbStop'), sendBtn = document.getElementById('cbSend');
    const CHIP = { coding: '写代码', video: '看视频', game: '玩游戏', meeting: '开会', office: '写文档', browser: '逛网页' };
    const PH = input ? input.placeholder : '';
    st.barOpen = false; st.sideOpen = false;
    Object.defineProperty(st, 'chatOpen', { get: () => st.barOpen || st.sideOpen, enumerable: true });
    let lastSent = '', autoHidden = false, busyNow = false, partial = '', mood = '', sideRef = null;

    /* 推给侧边窗（Tauri：emitTo；浏览器调试：window.open 出来的窗口 postMessage） */
    const toWin = (m) => {
      if (!st.sideOpen) return;
      if (T) T.event.emitTo('chat', 'pet://chatui', m).catch(() => {});
      else if (sideRef && !sideRef.closed) sideRef.postMessage({ chatui: m }, '*');
    };
    const clip = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };
    /* 侧边窗标题下那一行：“你在写代码 · 我会安静点”；看不出在干嘛就不写 */
    const sceneLabel = () => {
      const sc = XH.scene;
      if (!S.sceneOn || !sc || !sc.state.proc || sc.state.cls === 'self') return '';
      if (sc.state.blocked || sc.state.cls === 'private') return '你在用隐私应用 · 我先不打扰';
      const what = CHIP[sc.state.cls];
      if (!what) return sc.quiet() ? '我先安静待着' : '';
      return '你在' + what + (sc.quiet() ? ' · 我会安静点' : '');
    };
    const sync = () => toWin({ k: 'sync', busy: busyNow, partial, mood, scene: sceneLabel(), think: !!S.think, vision: !!S.visionOn, ask: curAsk });
    /* 眼睛按钮只在打开了「看屏幕」时出现 */
    const lookBtn = document.getElementById('cbLook');
    const paintLook = () => { if (lookBtn) lookBtn.hidden = !S.visionOn; toWin({ k: 'vision', on: !!S.visionOn }); };

    /* ---------- 深度思考开关（输入栏 🧠 / 侧边窗同一个开关，存进设置） ---------- */
    const thinkBtn = document.getElementById('cbThink');
    const paintThink = () => { if (thinkBtn) thinkBtn.setAttribute('aria-pressed', String(!!S.think)); };
    function setThink(on) {
      S.think = !!on;
      try { const s = JSON.parse(localStorage.getItem('xh-pet') || '{}'); s.think = S.think; localStorage.setItem('xh-pet', JSON.stringify(s)); } catch (_) { /* 无所谓 */ }
      paintThink();
      toWin({ k: 'think', on: S.think });
      P.toast(S.think ? '深度思考：开（会想得久一点）' : '深度思考：关');
    }

    /* ---------- 帮你做事前问一句（输入栏 / 侧边窗都能答，60 秒没答算不要） ---------- */
    const askBox = document.getElementById('cbAsk'), askText = document.getElementById('cbAskText');
    const asks = new Map();
    let askSeq = 0, curAsk = null;
    function confirmAsk(text) {
      return new Promise((resolve) => {
        const id = ++askSeq;
        let tm = 0;
        const fin = (v) => {
          if (!asks.has(id)) return;
          asks.delete(id); clearTimeout(tm);
          if (curAsk && curAsk.id === id) curAsk = null;
          if (askBox && +askBox.dataset.id === id) askBox.hidden = true;
          toWin({ k: 'askdone', id, ok: !!v });
          resolve(!!v);
        };
        tm = setTimeout(() => fin(false), 60000);
        asks.set(id, fin);
        curAsk = { id, text };
        if (!st.sideOpen && !st.barOpen) openBar();
        if (askBox) { askBox.dataset.id = id; askText.textContent = text; askBox.hidden = false; }
        toWin({ k: 'ask', id, text });
        P.play('tilt', false, true, 1, { quiet: true, silent: true });
      });
    }
    const answerAsk = (id, ok) => { const f = asks.get(+id); if (f) f(ok); };
    const cancelAsks = () => [...asks.values()].forEach((f) => f(false));
    function updateScene() { toWin({ k: 'scene', text: sceneLabel() }); }
    function applyHide() {
      if (!invoke || !XH.scene) return;
      const sc = XH.scene.state;
      const want = !!S.sceneOn && !!S.hideFull && sc.full && !st.chatOpen;
      if (want && !autoHidden) { autoHidden = true; invoke('pet_show', { on: false }).catch(() => { autoHidden = false; }); }
      else if (!want && autoHidden) { autoHidden = false; invoke('pet_show', { on: true }).catch(() => {}); }
    }
    function updateStop(on) {
      busyNow = !!on;
      if (stopBtn) { stopBtn.hidden = !on; sendBtn.hidden = !!on; }
      toWin({ k: 'busy', on: busyNow });
    }
    function showTip(text) { if (!tip) return; tip.hidden = false; tipText.textContent = text; }
    function chatReady() {
      if (S.chatOn) return true;
      P.say('想和我聊天的话…\n先在控制面板「对话」里打开吧', { type: 'say' }, 'tilt');
      return false;
    }

    function openBar() {
      if (!bar || !chatReady()) return;
      if (st.sideOpen) closeSide();
      if (!st.barOpen) {
        st.barOpen = true;
        bar.classList.add('on');
        if (XH.bubble) XH.bubble.hold(true); // 输入栏开着时，她最后一句话留在头顶
      }
      if (invoke) invoke('pet_focus', { on: true }).catch(() => {});
      updateStop(busyNow);
      setTimeout(() => input.focus(), 30);
    }
    function closeBar() {
      if (!bar || !st.barOpen) return;
      st.barOpen = false; bar.classList.remove('on'); input.blur(); tip.hidden = true;
      if (XH.bubble) XH.bubble.hold(false);
      st.sinceProbe = 1;
      applyHide();
    }
    function openSide() {
      if (!chatReady()) return;
      if (st.barOpen) closeBar();
      st.sideOpen = true;
      /* 窗口只是隐藏过的话不会重新加载：显示后主动同步一次（新建的窗口加载完会自己要） */
      if (invoke) invoke('chatwin_open').then(() => setTimeout(sync, 80)).catch(() => { st.sideOpen = false; openBar(); });
      else { sideRef = window.open('chatwin.html', 'xh-chat', 'width=340,height=520'); if (!sideRef) { st.sideOpen = false; openBar(); } }
    }
    /* fromWin：侧边窗自己关掉的（Esc / × / 系统关闭），不用再让它隐藏 */
    function closeSide(fromWin) {
      if (!st.sideOpen) return;
      st.sideOpen = false;
      if (!fromWin) {
        if (invoke) invoke('chatwin_hide').catch(() => {});
        else if (sideRef && !sideRef.closed) sideRef.close();
      }
      sideRef = null;
      st.sinceProbe = 1;
      applyHide();
    }
    /* 双击 / 托盘 / 面板：按设置打开漫画输入栏或侧边窗；侧边窗已开就只是把它叫到前面 */
    function openChat() {
      if (st.sideOpen) return openSide();
      if (S.chatMode === 'side') openSide(); else openBar();
    }
    function closeAll() { closeBar(); closeSide(); }

    const H = {
      user(text) {
        if (tip) tip.hidden = true;
        if (input) input.placeholder = '你：' + clip(text, 14);
        toWin({ k: 'user', text, t: Date.now() });
      },
      start() { if (tip) tip.hidden = true; partial = ''; mood = ''; updateStop(true); toWin({ k: 'start' }); },
      mood(tag) { mood = tag; toWin({ k: 'mood', tag }); },
      delta(s) { partial += s; if (input && input.placeholder.startsWith('她在')) input.placeholder = PH; toWin({ k: 'delta', text: s }); },
      think(s) { if (input) input.placeholder = '她在认真想…'; toWin({ k: 'think', text: s }); },
      tool(o) {
        if (input) input.placeholder = o.state === 'run' ? '她在帮你' + o.label : PH;
        if (o.state !== 'run') P.play(o.state === 'ok' ? 'nod' : 'tilt', false, true, 1, { quiet: true, silent: true });
        toWin({ k: 'tool', ...o });
      },
      confirm: confirmAsk,
      askCancel: cancelAsks,
      end(k, t) {
        updateStop(false);
        cancelAsks();
        if (input) input.placeholder = PH;
        if (k === 'error') showTip(t || '出错了…');
        else if (k === 'cancel') showTip('停在半路啦');
        toWin({ k: 'end', kind: k, text: t || '', mood, t: Date.now() });
        partial = '';
        /* 回复途中你点去别处了：说完再收起输入栏（出错时留着，好点重发） */
        if (k === 'done' && st.barOpen && !input.value && !document.hasFocus()) closeBar();
      },
    };
    /* opt.look：先看一眼屏幕再回答 */
    function chatSend(text, opt) {
      if (!XH.chat) return;
      text = String(text || '').trim(); if (!text) return;
      if (!chatReady()) return;
      lastSent = text;
      if (input) input.value = '';
      if (tip) tip.hidden = true;
      XH.chat.send(text, S, P, H, opt);
    }
    const lookSend = (text) => {
      const can = XH.vision ? XH.vision.canLook(S) : { ok: false, why: '看屏幕功能没加载' };
      if (!can.ok) { showTip(can.why); toWin({ k: 'tip', text: can.why }); return; }
      chatSend(String(text || '').trim() || '你看看我的屏幕', { look: true });
    };
    if (bar) {
      bar.addEventListener('submit', (e) => { e.preventDefault(); chatSend(input.value); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeBar(); } });
      document.getElementById('cbClose').addEventListener('click', closeBar);
      document.getElementById('cbSide').addEventListener('click', openSide);
      stopBtn.addEventListener('click', () => { XH.chat.stop(); updateStop(false); });
      retry.addEventListener('click', () => { tip.hidden = true; chatSend(lastSent); });
      window.addEventListener('blur', () => { if (st.barOpen && !input.value && !busyNow) closeBar(); });
      if (thinkBtn) thinkBtn.addEventListener('click', () => setThink(!S.think));
      if (lookBtn) lookBtn.addEventListener('click', () => { if (!busyNow) lookSend(input.value); });
      paintLook();
      if (askBox) askBox.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) answerAsk(askBox.dataset.id, b.dataset.a === '1'); });
      paintThink();
    }
    /* 提醒到点由 tools.js 自己计时 */
    if (XH.tools) XH.tools.start(P);
    gl.addEventListener('dblclick', (e) => { if (e.button === 0 && !st.dragging) openChat(); });
    window.PET_CHAT = {
      open: openChat, close: closeAll, send: chatSend, openBar, closeBar, openSide, closeSide, setScene: updateScene,
      state: () => ({ bar: st.barOpen, side: st.sideOpen, busy: busyNow, think: !!S.think, ask: curAsk }),
      answer: answerAsk, setThink,
    };

    /* 桌面场景：变化时更新徽标、全屏自动隐藏 */
    if (XH.scene) {
      XH.scene.onChange(() => { updateScene(); applyHide(); });
      XH.scene.start(() => S);
      updateScene();
    }

    /* 小助手：报时 / 天气 / 提醒 / 劝睡 */
    if (XH.assist) XH.assist.start(P, () => S, null);

    /* 右键打开控制面板（Tauri：独立窗口；浏览器：新标签） */
    const openPanel = () => { if (invoke) invoke('open_panel').catch(() => {}); else window.open('panel.html', 'xh-panel', 'width=380,height=620'); };
    window.addEventListener('contextmenu', (e) => { e.preventDefault(); if (st.hit || !T) openPanel(); });

    /* ---------- 悬停快捷按钮（v0.2.2）：聊天 / 睡觉 / 面板 ---------- */
    const bindQuick = () => {
      if (!quick) return;
      const hit = (q, fn) => { const b = quick.querySelector(`[data-q="${q}"]`); if (b) b.addEventListener('click', fn); };
      hit('chat', openChat);
      hit('sleep', () => P.setSleep(!P.sleeping()));
      hit('panel', openPanel);
    };
    bindQuick();

    /* ---------- 新手引导（v0.2.2）---------- */
    const ONB_KEY = 'xh-onboarded';
    let onbTimers = [];
    const clearOnb = () => { onbTimers.forEach(clearTimeout); onbTimers = []; };
    function runOnboard(force) {
      clearOnb();
      if (!force) { try { if (localStorage.getItem(ONB_KEY) === '1') return; } catch (_) { /* 无所谓 */ } }
      const lines = [
        '第一次见面呀，我是小嬅～',
        '右键我可以打开控制面板，那里能改声音、大小和我的样子。',
        S.chatOn ? '双击我就能和我说话啦；点输入栏右边的小对话框，能看我们聊过的全部。' : '想聊天的话，在「对话」里连上模型就好；我会记住聊过的事，也会偶尔主动找你。',
      ];
      lines.forEach((text, i) => {
        onbTimers.push(setTimeout(() => {
          if (st.chatOpen || st.dragging) return;
          P.wake();
          P.say(text, { type: 'say', force: true }, i ? 'nod' : 'greet');
        }, 2200 + i * 4600));
      });
      onbTimers.push(setTimeout(() => { try { localStorage.setItem(ONB_KEY, '1'); } catch (_) { /* 无所谓 */ } }, 2200 + lines.length * 4600 + 1000));
    }

    /* ---------- 主动搭话（v0.2.2）：闲下来自己开口，免打扰/睡觉不打扰 ---------- */
    const PRO_GAP = { 0: [0, 0], 1: [45, 90], 2: [20, 40], 3: [8, 20] };
    let proNext = 0, proSet = null;
    const proGap = (k) => {
      const g = PRO_GAP[k] || PRO_GAP[2];
      let m = 1;
      const cls = XH.scene && XH.scene.state.cls;
      if (cls === 'coding' || cls === 'office' || cls === 'video') m = 0.85;
      else if (cls === 'browser') m = 0.95;
      else if (cls === 'other') m = 1.15;
      return (g[0] + Math.random() * (g[1] - g[0])) * 60000 * m;
    };
    function armProactive(force) {
      const k = +S.proactive || 0;
      if (!k) { proNext = 0; proSet = 0; return; }
      if (force || proSet !== k || !proNext) proNext = Date.now() + proGap(k);
      proSet = k;
    }
    function proactiveTick() {
      const k = +S.proactive || 0;
      if (!k || !S.chatOn || !XH.chat || Date.now() < proNext) return;
      if (st.chatOpen || st.dragging || st.press || P.busy()) return;
      if (XH.scene && XH.scene.quiet()) return;
      if (XH.assist && XH.assist.inQuiet && XH.assist.inQuiet(new Date().getHours(), S)) return;
      if (performance.now() - P.state.lastInput < 3 * 60000) return;
      if (XH.chat.busy()) return;
      if (XH.chat.proactive(S, P)) proNext = Date.now() + proGap(k);
    }
    armProactive(true);
    setInterval(proactiveTick, 30000);

    /* 来自控制面板的指令 */
    const onCmd = (c) => {
      if (!c) return;
      if (c.type === 'play') P.play(c.name);
      else if (c.type === 'sleep') P.setSleep(!P.sleeping());
      else if (c.type === 'settings') {
        const prev = S; S = load(); P.set(S); armProactive(false);
        if (XH.assist) XH.assist.changed(prev);
        if (XH.scene) { XH.scene.set(S); updateScene(); applyHide(); }
        if (!S.chatOn) closeAll();
        paintThink(); toWin({ k: 'think', on: !!S.think }); paintLook();
      }
      else if (c.type === 'onboard') runOnboard(true);
      else if (c.type === 'chat') openChat();
      else if (c.type === 'say' && c.text) chatSend(c.text);
      /* 侧边聊天窗 → 这里 */
      else if (c.type === 'chatsync') sync();
      else if (c.type === 'stop') { XH.chat.stop(); updateStop(false); }
      else if (c.type === 'retry' && lastSent) chatSend(lastSent);
      else if (c.type === 'bar') openBar();
      else if (c.type === 'chatwin' && !c.open) closeSide(true);
      else if (c.type === 'confirm') answerAsk(c.id, !!c.ok);
      else if (c.type === 'think') setThink(!!c.on);
      else if (c.type === 'look' && !busyNow) lookSend(c.text);
      else if (c.type === 'time' && XH.assist) XH.assist.sayTime();
      else if (c.type === 'weather' && XH.assist) XH.assist.sayWeather(true);
      else if (c.type === 'chime' && XH.assist) XH.assist.testChime(c.h | 0);
      else if (c.type === 'sfx' && XH.sfx) { XH.sfx.unlock(); XH.sfx.play(c.name); } // 面板试听 / 调音量预听
    };
    if (T) T.event.listen('pet://cmd', (e) => onCmd(e.payload));
    window.addEventListener('storage', (e) => { if (e.key === 'xh-pet') onCmd({ type: 'settings' }); });
    window.addEventListener('message', (e) => onCmd(e.data));

    if (T) {
      T.event.listen('pet://cursor', (e) => { const d = window.devicePixelRatio || 1; onCursor(e.payload.x / d, e.payload.y / d, e.payload.inside); });
      /* payload：[dx, dy]（物理像素；兼容旧版只发 dx 的数字） */
      T.event.listen('pet://drag-move', (e) => {
        const d = window.devicePixelRatio || 1, p = e.payload;
        if (Array.isArray(p)) P.dragMove(p[0] / d, p[1] / d); else P.dragMove(p / d, 0);
      });
      T.event.listen('pet://drag-end', () => { st.dragging = false; st.press = null; st.dragEndAt = performance.now(); P.dragEnd(); });
    } else {
      window.addEventListener('pointermove', (e) => onCursor(e.clientX, e.clientY, true));
      document.addEventListener('pointerleave', () => { st.inside = false; });
    }

    /* 快捷按钮区：光标移进按钮时保持窗口可点，不然会瞬间穿透点不到 */
    let quickUntil = 0;
    const inBox = (el, pad = 3) => {
      if (!el) return false;
      const q = el.getBoundingClientRect();
      return st.x >= q.left - pad && st.x <= q.right + pad && st.y >= q.top - pad && st.y <= q.bottom + pad;
    };
    const inQuick = () => !!quick && quick.classList.contains('on') && inBox(quick, 2);

    /* 每帧（render 之后）：节流到 50ms 读一次像素 */
    P.onFrame = (dt) => {
      st.sinceProbe += dt;
      tickReact(dt);
      /* v0.6.0：输入栏开着时不再整窗拦截——她身上 + 输入栏区域可点，其余照样穿透 */
      if (!st.dragging && !st.press && st.sinceProbe >= 0.05) {
        st.sinceProbe = 0;
        st.alpha = st.inside ? P.alphaAt(st.x, st.y, PAD) : 0;
        st.hit = st.hit ? st.alpha > OFF : st.alpha > ON;
        if (st.hit && !st.barOpen) quickUntil = performance.now() + 900;
        const showQ = !st.barOpen && (st.hit || performance.now() < quickUntil || inQuick());
        const keep = showQ || st.hit || (st.barOpen && inBox(bar));
        if (quick) { quick.classList.toggle('on', showQ); quick.setAttribute('aria-hidden', String(!showQ)); quick.inert = !showQ; }
        setPass(!keep);
        gl.style.cursor = st.hit ? 'grab' : 'default';
      }
      if (st.dragging && quick) { quickUntil = 0; quick.classList.remove('on'); quick.setAttribute('aria-hidden', 'true'); quick.inert = true; }
      if (DEBUG) {
        dot.style.left = st.x + 'px'; dot.style.top = st.y + 'px';
        dot.style.background = st.dragging ? '#3b82f6' : st.hit ? '#22c55e' : '#ef4444';
        dbg.textContent = `alpha ${st.alpha.toFixed(2)} | ${st.dragging ? '拖动中' : st.hit ? '可点（不穿透）' : '穿透'} | ${Math.round(st.x)},${Math.round(st.y)}`;
      }
    };

    /* 点击 / 拖动（只有不穿透时网页才收得到这些事件） */
    gl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // 右键交给 contextmenu
      /* 拖动中 / 刚松手 0.5s 内：WebView 会补发拖动前积压的按下 / 抬起，不能当成点击 */
      if (st.dragging || performance.now() - (st.dragEndAt || 0) < 500) return;
      st.press = { x: e.clientX, y: e.clientY };
      try { gl.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件没有活动指针 */ }
    });
    gl.addEventListener('pointermove', (e) => {
      if (st.simDrag) { P.dragMove(e.clientX - st.simDrag.x, e.clientY - st.simDrag.y); st.simDrag.x = e.clientX; st.simDrag.y = e.clientY; return; }
      if (st.press && !(e.buttons & 1)) { st.press = null; return; } // 左键已松开（补发的旧事件）
      if (!st.press || Math.hypot(e.clientX - st.press.x, e.clientY - st.press.y) < 6) return;
      const grab = st.press;
      st.press = null;
      st.dragging = true;
      gl.style.cursor = 'grabbing';
      P.dragStart(grab.x, grab.y); // 抓取点 = 按下的位置（摇摆支点）
      if (invoke) {
        try { gl.releasePointerCapture(e.pointerId); } catch (_) { /* 已释放 */ }
        invoke('start_drag').catch(() => { st.dragging = false; P.dragCancel(); });
      } else st.simDrag = { x: e.clientX, y: e.clientY }; // 浏览器调试：窗口不动，只模拟摇摆和落地
    });
    const up = (e) => {
      if (st.press) { P.click(e.clientX, e.clientY); st.press = null; }
      if (st.simDrag) { st.simDrag = null; st.dragging = false; P.dragEnd(); }
    };
    gl.addEventListener('pointerup', up);
    gl.addEventListener('pointercancel', () => { st.press = null; });

    /* 首次启动：等开场招呼播完再开始气泡引导；开机自启不打扰 */
    setTimeout(() => {
      if (invoke) invoke('launched_autostart').then((v) => { if (!v) runOnboard(false); }).catch(() => runOnboard(false));
      else runOnboard(false);
    }, 1200);

    setTimeout(() => P.toast(T ? '小嬅来陪你啦' : '调试模式：棋盘格 = 透明区域'), 400);
  }
  boot();
})();

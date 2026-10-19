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
    const DEF = { idleFreq: 2, bubbles: true, follow: true, props: true, react: true, scale: 100, top: true, sfx: true, vol: 25, voice: true, swing: 2, outfit: 'classic', acc: {}, autoDress: true, festival: true, ...(XH.DEF_ASSIST || {}), ...(XH.DEF_SCENE || {}), ...((XH.chat && XH.chat.DEF_CHAT) || {}) };
    /* sv：设置版本。v0.1.3 起默认音量 40 → 25；v0.3.0 去掉 roam，加 outfit / acc / autoDress；v0.5.0 加场景感知 */
    const load = () => {
      let s; try { s = JSON.parse(localStorage.getItem('xh-pet') || '{}'); } catch (_) { s = {}; }
      if (!s.sv) { if (s.vol === 40) s.vol = 25; s.sv = 2; }
      if (s.sv < 3) { if (s.roam == null) s.roam = true; s.sv = 3; }
      if (s.sv < 4) { if (s.outfit == null) s.outfit = 'classic'; if (!s.acc) s.acc = {}; if (s.autoDress == null) s.autoDress = true; delete s.roam; s.sv = 4; }
      if (s.sv < 5) { if (s.festival == null) s.festival = true; s.sv = 5; }
      if (s.sv < 6) { if (s.sceneOn == null) s.sceneOn = true; if (s.sceneTitle == null) s.sceneTitle = false; if (s.quietFull == null) s.quietFull = true; if (s.hideFull == null) s.hideFull = false; if (s.sceneBlock == null) s.sceneBlock = ''; s.sv = 6; }
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

    /* ---------- 对话卡（v0.5.0）：双击她 / 托盘 / 面板打开；打开期间窗口不穿透 ---------- */
    const card = document.getElementById('cc'), list = document.getElementById('ccList'), input = document.getElementById('ccIn');
    const tip = document.getElementById('ccTip'), tipText = document.getElementById('ccTipText'), retry = document.getElementById('ccRetry');
    const stopBtn = document.getElementById('ccStop'), sendBtn = document.getElementById('ccSend'), sceneChip = document.getElementById('ccScene');
    const stage = document.getElementById('stage'), hdr = card && card.querySelector('.cc-h');
    const MOOD = { 开心: '😊', 害羞: '☺️', 生气: '😠', 困: '😴', 思考: '🤔', 惊讶: '😮', 疑惑: '🤨', 难过: '😢', 点头: '🙂', 打招呼: '👋', 挥手: '👋', 得意: '😌', 无聊: '😑', 星星眼: '🤩', 嘟嘴: '😗', 猫嘴: '🐱' };
    const CHIP = { coding: '写代码', video: '看视频', game: '玩游戏', meeting: '开会', office: '写文档', browser: '逛网页', private: '隐私 · 安静', other: '在忙', self: '' };
    st.chatOpen = false;
    let curA = null, lastSent = '', autoHidden = false;

    const hhmm = (t) => { const d = new Date(t || Date.now()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const scrollDown = () => { list.scrollTop = list.scrollHeight; };
    function addMsg(role, text, mood, t, typing) {
      const d = document.createElement('div');
      d.className = 'cc-m ' + (role === 'user' ? 'u' : 'a') + (typing ? ' typing' : '');
      const body = document.createElement('span'); body.className = 'body'; body.textContent = text || '';
      if (mood && role !== 'user') { const m = document.createElement('span'); m.className = 'mood'; m.textContent = MOOD[mood] || ''; d.appendChild(m); }
      d.appendChild(body);
      if (t && !typing) { const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = hhmm(t); d.appendChild(tm); }
      list.appendChild(d); scrollDown();
      return d;
    }
    function renderLog() {
      list.textContent = '';
      const log = XH.chat.loadLog().slice(-8);
      if (!log.length) { const e = document.createElement('div'); e.className = 'cc-empty'; e.textContent = '想聊什么都可以呀～我在这里。'; list.appendChild(e); return; }
      log.forEach((m) => addMsg(m.role === 'user' ? 'user' : 'assistant', m.content, m.mood, m.t));
      scrollDown();
    }
    function updateScene() {
      if (!sceneChip) return;
      const sc = XH.scene;
      if (!S.sceneOn || !sc || !sc.state.proc || sc.state.cls === 'self') { sceneChip.hidden = true; return; }
      sceneChip.hidden = false;
      sceneChip.textContent = (sc.quiet() ? '安静 · ' : '') + (CHIP[sc.state.cls] || '在忙');
    }
    function applyHide() {
      if (!invoke || !XH.scene) return;
      const sc = XH.scene.state;
      const want = !!S.sceneOn && !!S.hideFull && sc.full && !st.chatOpen;
      if (want && !autoHidden) { autoHidden = true; invoke('pet_show', { on: false }).catch(() => { autoHidden = false; }); }
      else if (!want && autoHidden) { autoHidden = false; invoke('pet_show', { on: true }).catch(() => {}); }
    }
    function updateStop(on) { if (stopBtn) { stopBtn.hidden = !on; sendBtn.disabled = !!on; } }
    function resetCardPos() {
      if (!card) return;
      card.style.width = ''; card.style.left = ''; card.style.top = ''; card.style.right = ''; card.style.bottom = '';
    }
    function clampCard() {
      if (!card || !card.style.width || !stage) return;
      const s = stage.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
      const x = Math.min(Math.max(4, parseFloat(card.style.left) || 0), Math.max(4, s.width - w - 4));
      const y = Math.min(Math.max(4, parseFloat(card.style.top) || 0), Math.max(4, s.height - h - 4));
      card.style.left = x + 'px'; card.style.top = y + 'px';
    }
    let cdrag = null;
    function cardDown(e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = card.getBoundingClientRect(), s = stage.getBoundingClientRect();
      cdrag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: r.left - s.left, y: r.top - s.top, w: r.width };
      card.style.width = r.width + 'px';
      card.style.left = cdrag.x + 'px'; card.style.top = cdrag.y + 'px';
      card.style.right = 'auto'; card.style.bottom = 'auto';
      hdr.classList.add('drag');
      try { hdr.setPointerCapture(e.pointerId); } catch (_) { /* 无活动指针 */ }
    }
    function cardMove(e) {
      if (!cdrag || e.pointerId !== cdrag.id) return;
      if (!(e.buttons & 1)) return cardUp(e);
      const s = stage.getBoundingClientRect();
      const x = Math.max(4, Math.min(cdrag.x + e.clientX - cdrag.sx, s.width - cdrag.w - 4));
      const y = Math.max(4, Math.min(cdrag.y + e.clientY - cdrag.sy, s.height - card.offsetHeight - 4));
      card.style.left = x + 'px'; card.style.top = y + 'px';
    }
    function cardUp(e) {
      if (!cdrag) return;
      cdrag = null; hdr.classList.remove('drag');
      try { hdr.releasePointerCapture(e.pointerId); } catch (_) { /* 已释放 */ }
    }
    function openChat() {
      if (!card) return;
      if (!S.chatOn) { P.say('想和我聊天的话…\n先在控制面板「对话」里打开吧', { type: 'say' }, 'tilt'); return; }
      if (!st.chatOpen) {
        st.chatOpen = true;
        renderLog();
        card.classList.add('on');
        if (XH.bubble) { XH.bubble.hold(true); XH.bubble.hide(true); }
      }
      setPass(false);
      if (invoke) invoke('pet_focus', { on: true }).catch(() => {});
      updateStop(!!XH.chat.busy());
      setTimeout(() => input.focus(), 30);
    }
    function closeChat() {
      if (!card || !st.chatOpen) return;
      st.chatOpen = false; card.classList.remove('on'); input.blur(); resetCardPos();
      if (XH.bubble) XH.bubble.hold(false);
      st.sinceProbe = 1;
      applyHide();
    }
    function autoGrow() {
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = Math.min(64, input.scrollHeight) + 'px';
    }
    const H = {
      card: true,
      user(text) { const e = list.querySelector('.cc-empty'); if (e) e.remove(); tip.hidden = true; addMsg('user', text, '', Date.now()); },
      start() { tip.hidden = true; updateStop(true); curA = addMsg('assistant', '', '', 0, true); },
      mood(tag) { if (curA) { let m = curA.querySelector('.mood'); if (!m) { m = document.createElement('span'); m.className = 'mood'; curA.insertBefore(m, curA.firstChild); } m.textContent = MOOD[tag] || ''; } },
      delta(s) {
        if (!curA) curA = addMsg('assistant', '', '', 0, true);
        curA.classList.remove('typing');
        const b = curA.querySelector('.body'); b.textContent += s;
        scrollDown();
      },
      end(k, t) {
        updateStop(false);
        if (curA) {
          curA.classList.remove('typing');
          const b = curA.querySelector('.body');
          if (!b.textContent && k !== 'done') { curA.remove(); curA = null; }
          else { const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = hhmm(); curA.appendChild(tm); }
        }
        if (k === 'done') { tip.hidden = true; }
        else if (k === 'error') {
          const us = list.querySelectorAll('.cc-m.u'); if (us.length) us[us.length - 1].remove();
          tip.hidden = false; tipText.textContent = t || '出错了…'; retry.hidden = false;
        }
        else if (k === 'cancel') { tip.hidden = false; tipText.textContent = '停在半路啦'; retry.hidden = false; }
        scrollDown();
      },
    };
    function chatSend(text) {
      if (!XH.chat) return;
      text = String(text || '').trim(); if (!text) return;
      if (!S.chatOn) return openChat();
      lastSent = text;
      input.value = ''; autoGrow();
      tip.hidden = true;
      XH.chat.send(text, S, P, H);
    }
    if (card) {
      document.getElementById('ccForm').addEventListener('submit', (e) => { e.preventDefault(); chatSend(input.value); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(input.value); }
        else if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
      });
      input.addEventListener('input', autoGrow);
      document.getElementById('ccClose').addEventListener('click', closeChat);
      stopBtn.addEventListener('click', () => { XH.chat.stop(); updateStop(false); });
      retry.addEventListener('click', () => { tip.hidden = true; chatSend(lastSent); });
      document.querySelectorAll('#ccQuick [data-say]').forEach((b) => b.addEventListener('click', () => chatSend(b.dataset.say)));
      window.addEventListener('blur', () => { if (st.chatOpen && !input.value) closeChat(); });
      if (hdr) {
        hdr.addEventListener('pointerdown', cardDown);
        hdr.addEventListener('pointermove', cardMove);
        hdr.addEventListener('pointerup', cardUp);
        hdr.addEventListener('pointercancel', cardUp);
        window.addEventListener('resize', () => { if (st.chatOpen) clampCard(); });
      }
    }
    gl.addEventListener('dblclick', (e) => { if (e.button === 0 && !st.dragging) openChat(); });
    window.PET_CHAT = { open: openChat, close: closeChat, send: chatSend, setScene: updateScene };

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
        S.chatOn ? '双击我就能打开对话卡啦，我会记住我们聊过的事。' : '想聊天的话，在「对话」里连上模型就好；我会记住聊过的事，也会偶尔主动找你。',
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
        if (!S.chatOn) closeChat();
      }
      else if (c.type === 'onboard') runOnboard(true);
      else if (c.type === 'chat') openChat();
      else if (c.type === 'say' && c.text) chatSend(c.text);
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
    const inQuick = () => {
      if (!quick || !quick.classList.contains('on')) return false;
      const q = quick.getBoundingClientRect();
      return st.x >= q.left - 2 && st.x <= q.right + 2 && st.y >= q.top - 2 && st.y <= q.bottom + 2;
    };

    /* 每帧（render 之后）：节流到 50ms 读一次像素 */
    P.onFrame = (dt) => {
      st.sinceProbe += dt;
      tickReact(dt);
      if (st.chatOpen) {
        quickUntil = 0;
        if (quick) { quick.classList.remove('on'); quick.setAttribute('aria-hidden', 'true'); quick.inert = true; }
        setPass(false); // 输入框开着：整窗可交互
      } else if (!st.dragging && !st.press && st.sinceProbe >= 0.05) {
        st.sinceProbe = 0;
        st.alpha = st.inside ? P.alphaAt(st.x, st.y, PAD) : 0;
        st.hit = st.hit ? st.alpha > OFF : st.alpha > ON;
        if (st.hit) quickUntil = performance.now() + 900;
        const keep = st.hit || performance.now() < quickUntil || inQuick();
        if (quick) { quick.classList.toggle('on', keep); quick.setAttribute('aria-hidden', String(!keep)); quick.inert = !keep; }
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

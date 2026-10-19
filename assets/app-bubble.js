/* 小嬅对话气泡（v0.2.0）
   奶油纸底 #FBF6EA + 暖棕描边 #8B6A4E，像她的毛呢斗篷；尾巴是 3 个由大到小的小云团，指向她的头（呼应身边的小云朵）。
   类型：say 普通台词（胶囊）/ time 报时（小时钟）/ weather 天气（图标 + 温度）/ chat 对话（多行、打字机、“…”思考）。
   位置由 app.js 每帧传入头顶锚点（已含转头 / 拖动摇摆），气泡跟着走，并随摇摆轻微倾斜。
   用法：XH.bubble.mount(容器) → say(text, {type, code, temp, ms}) / chatStart() / append(s) / chatEnd() / frame(dt, x, y, deg) */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const CSS = `
.xb { position: absolute; left: 0; top: 0; z-index: 5; pointer-events: none; display: none; width: max-content; will-change: transform; }
.xb.on { display: block; }
.xb-in { position: relative; transform-origin: var(--ox, 50%) 100%; animation: xbIn .34s cubic-bezier(.3, 1.55, .5, 1) both; }
.xb.out .xb-in { animation: xbOut .26s ease-in both; }
@keyframes xbIn { from { opacity: 0; transform: scale(.55) translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes xbOut { to { opacity: 0; transform: translateY(-9px) scale(.96); } }
.xb-body { position: relative; z-index: 1; display: flex; align-items: center; gap: 7px; box-sizing: border-box;
  background: #FBF6EA; border: 1.5px solid #8B6A4E; border-radius: 16px; padding: 5px 13px;
  color: #4A3A32; font: 13.5px/1.5 "YouYuan", "幼圆", "Microsoft YaHei UI", "PingFang SC", sans-serif; letter-spacing: .02em;
  box-shadow: 0 2px 0 rgba(139, 106, 78, .16), 0 5px 12px rgba(74, 58, 50, .16); }
.xb-body::before { content: ""; position: absolute; inset: 2px; border-radius: inherit; border: 1px dashed rgba(185, 152, 120, .45); pointer-events: none; }
.xb[data-type="chat"] .xb-body { border-radius: 14px; padding: 7px 13px; align-items: flex-start; }
.xb-text { white-space: pre-wrap; word-break: break-word; overflow: hidden; max-height: 6em; }
.xb[data-type="chat"] .xb-text { overflow-y: auto; scrollbar-width: none; min-width: 2em; }
.xb[data-type="chat"] .xb-text::-webkit-scrollbar { display: none; }
.xb-text small { display: block; font-size: 12px; color: #7A6152; }
.xb-ico { flex: none; width: 24px; height: 24px; display: none; }
.xb[data-type="time"] .xb-ico, .xb[data-type="weather"] .xb-ico { display: block; }
.xb-temp { flex: none; font: 700 16px/1 "Microsoft YaHei UI", sans-serif; color: #8B6A4E; display: none; }
.xb[data-type="weather"] .xb-temp { display: block; }
.xb-star { position: absolute; left: -7px; top: -8px; width: 15px; height: 15px; display: none; }
.xb[data-type="time"] .xb-star, .xb[data-type="weather"] .xb-star { display: block; }
.xb-tail { position: absolute; left: 0; top: 0; z-index: 0; box-sizing: border-box; background: #FBF6EA; border: 1.5px solid #8B6A4E; border-radius: 50%;
  box-shadow: 0 1px 0 rgba(139, 106, 78, .16); }
.xb-dots { display: none; padding: 4px 0; }
.xb-dots i { display: inline-block; width: 5px; height: 5px; margin: 0 2px; border-radius: 50%; background: #B99878; animation: xbDot 1.1s infinite ease-in-out; }
.xb-dots i:nth-child(2) { animation-delay: .15s; } .xb-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes xbDot { 0%, 70%, 100% { transform: translateY(0); opacity: .45; } 35% { transform: translateY(-4px); opacity: 1; } }
.xb.thinking .xb-dots { display: block; } .xb.thinking .xb-text { display: none; }
@media (prefers-reduced-motion: reduce) { .xb-in, .xb.out .xb-in { animation-duration: .01s; } .xb-dots i { animation: none; opacity: .8; } }
`;
  const STAR = '<svg class="xb-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .8C8.6 5.6 10.4 7.4 15.2 8 10.4 8.6 8.6 10.4 8 15.2 7.4 10.4 5.6 8.6.8 8 5.6 7.4 7.4 5.6 8 .8Z" fill="#F4CD72" stroke="#8B6A4E" stroke-width="1" stroke-linejoin="round"/></svg>';

  /* 小图标：线条暖棕、填色柔和 */
  const S = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="#8B6A4E" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const SUN = '<circle cx="12" cy="12" r="4.2" fill="#F8D57E"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/>';
  const CLOUD = (y = 0) => `<path d="M7 ${18 + y}h10a3.6 3.6 0 0 0 .4-7.2A5.2 5.2 0 0 0 7.3 9.6 4.3 4.3 0 0 0 7 ${18 + y}Z" fill="#FFFDF7"/>`;
  const ICONS = {
    sun: S(SUN),
    part: S('<g transform="translate(-3 -4) scale(.8)">' + SUN + '</g>' + CLOUD(1)),
    cloud: S(CLOUD(0)),
    fog: S(CLOUD(-3) + '<path d="M5 19h14M7 22h10"/>'),
    rain: S(CLOUD(-3) + '<path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5" stroke="#6E95B5"/>'),
    snow: S(CLOUD(-3) + '<path d="M8 19.5h.01M12 21h.01M16 19.5h.01" stroke="#6E95B5" stroke-width="2.6"/>'),
    storm: S(CLOUD(-3) + '<path d="M12.5 16l-2 3.4h3l-2 3.2" stroke="#D99A3A"/>'),
  };
  /* 小时钟：指针按当前时间 */
  function clock(h, m) {
    const ah = ((h % 12) + m / 60) * 30, am = m * 6;
    return S(`<circle cx="12" cy="12" r="8.6" fill="#FFFDF7"/><path d="M12 12 12 7.6" transform="rotate(${ah} 12 12)" stroke-width="2"/><path d="M12 12 12 5.4" transform="rotate(${am} 12 12)"/><circle cx="12" cy="12" r=".9" fill="#8B6A4E"/>`);
  }
  /* WMO 天气代码 → 图标 */
  XH.wmoIcon = (c) => (c === 0 ? 'sun' : c <= 2 ? 'part' : c === 3 ? 'cloud' : c <= 48 ? 'fog' : c <= 67 || (c >= 80 && c <= 82) ? 'rain' : c <= 77 || c === 85 || c === 86 ? 'snow' : 'storm');

  let root, inner, body, ico, txt, temp, tails = [];
  /* marks（v0.7.0）：[{at, fn}]，打字机显示到第 at 个字时调用 fn（一句话里换表情用）；shown = 已经打出来的字数 */
  const st = { on: false, type: 'say', until: 0, hold: false, queue: '', streaming: false, full: '', talk: null, hideT: 0, x: null, y: null, marks: [], shown: 0 };
  const len = (s) => [...s].length;
  function fireMarks() {
    while (st.marks.length && st.marks[0].at <= st.shown) {
      const m = st.marks.shift();
      try { m.fn(); } catch (_) { /* 表情出错不影响说话 */ }
    }
  }

  function mount(container) {
    if (root) return;
    if (!document.getElementById('xb-css')) { const s = document.createElement('style'); s.id = 'xb-css'; s.textContent = CSS; document.head.appendChild(s); }
    root = document.createElement('div');
    root.className = 'xb';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = `<div class="xb-in"><div class="xb-body">${STAR}<span class="xb-ico"></span><div class="xb-text"></div><span class="xb-dots" aria-label="思考中"><i></i><i></i><i></i></span><span class="xb-temp"></span></div><i class="xb-tail"></i><i class="xb-tail"></i><i class="xb-tail"></i></div>`;
    container.appendChild(root);
    inner = root.firstChild; body = inner.firstChild;
    ico = body.querySelector('.xb-ico'); txt = body.querySelector('.xb-text'); temp = body.querySelector('.xb-temp');
    tails = [...inner.querySelectorAll('.xb-tail')];
    [[10, 8], [7, 6], [5, 4]].forEach(([w, h], i) => { tails[i].style.width = w + 'px'; tails[i].style.height = h + 'px'; });
  }

  /* 显示时长：按字数 2–8 秒；对话再多停 3 秒 */
  const dur = (s, type) => clamp(1600 + [...s].length * 110, 2000, 8000) + (type === 'chat' ? 3000 : 0);

  function open(type) {
    clearTimeout(st.hideT);
    root.dataset.type = type;
    st.type = type;
    const was = st.on && !root.classList.contains('out');
    root.classList.remove('out', 'thinking');
    root.classList.add('on');
    if (!was) { inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = ''; }
    st.on = true;
  }
  function say(text, opt) {
    if (!root) return;
    opt = opt || {};
    const type = opt.type || 'say';
    /* 正在对话时，普通动作台词不抢气泡 */
    if (busy() && type === 'say' && !opt.force) return;
    st.streaming = false; st.queue = ''; st.marks = [];
    open(type);
    if (type === 'time') { const d = opt.date || new Date(); ico.innerHTML = clock(d.getHours(), d.getMinutes()); }
    else if (type === 'weather') { ico.innerHTML = ICONS[XH.wmoIcon(opt.code | 0)] || ICONS.cloud; temp.textContent = opt.temp != null ? Math.round(opt.temp) + '°' : ''; }
    txt.textContent = '';
    const [a, b] = String(text).split('\n');
    txt.appendChild(document.createTextNode(a));
    if (b) { const sm = document.createElement('small'); sm.textContent = b; txt.appendChild(sm); }
    txt.scrollTop = 0;
    st.full = String(text);
    st.until = performance.now() + (opt.ms || dur(st.full, type));
  }
  /* 对话：先显示“…”，收到文字后逐字打出来 */
  function chatStart() {
    if (!root) return;
    open('chat');
    root.classList.add('thinking');
    txt.textContent = ''; st.full = ''; st.queue = ''; st.marks = []; st.shown = 0;
    st.streaming = true; st.until = Infinity;
  }
  function append(s) {
    if (!root || !s) return;
    if (st.type !== 'chat') chatStart();
    root.classList.remove('thinking');
    st.queue += s; st.full += s;
  }
  /* 在当前已追加文字的末尾记一个点：打字机打到这里时调用 fn；已经打到了就立刻调用 */
  function mark(fn) {
    if (!root || st.type !== 'chat') { fn(); return; }
    const at = len(st.full);
    if (at <= st.shown) { fn(); return; }
    st.marks.push({ at, fn });
  }
  function chatEnd() { st.streaming = false; if (!st.queue) st.until = performance.now() + dur(st.full, 'chat'); }
  function hide(now) {
    if (!st.on) return;
    st.on = false; st.streaming = false; st.queue = ''; st.marks = [];
    root.classList.add('out');
    st.hideT = setTimeout(() => { root.classList.remove('on', 'out'); }, now ? 0 : 280);
    if (st.talk) st.talk(false);
  }
  const busy = () => st.on && st.type === 'chat';

  /* 每帧：打字机 + 计时 + 跟随锚点（容器坐标；deg = 摇摆角） */
  function frame(dt, ax, ay, deg) {
    if (!root || !st.on) return;
    const now = performance.now();
    if (st.queue) {
      /* 每秒 26 字，积压多时加快，不让人干等 */
      st.acc = (st.acc || 0) + dt * (26 + st.queue.length * 1.5);
      const n = Math.floor(st.acc);
      if (n > 0) {
        st.acc -= n;
        const cs = [...st.queue], take = cs.slice(0, n).join('');
        st.queue = cs.slice(n).join('');
        txt.appendChild(document.createTextNode(take));
        txt.scrollTop = txt.scrollHeight;
        if (st.talk) st.talk(true);
        st.shown += Math.min(n, cs.length);
        fireMarks();
      }
      if (!st.queue) { if (st.talk) st.talk(false); if (!st.streaming) st.until = now + dur(st.full, 'chat'); }
    }
    if (st.hold && st.until !== Infinity) st.until = Math.max(st.until, now + 1200);
    if (now > st.until) { hide(); return; }
    /* 定位：气泡底边在锚点上方 18px（中间是云团尾巴），左右夹在容器内 */
    const box = root.parentNode.getBoundingClientRect();
    const maxW = Math.min(240, box.width - 12);
    if (root._mw !== maxW) { root._mw = maxW; body.style.maxWidth = maxW + 'px'; }
    const w = body.offsetWidth, h = body.offsetHeight;
    let x = clamp(ax - w / 2, 6, box.width - w - 6), y = ay - h - 15;
    if (y < 4) y = 4;
    /* 平滑一点，转头 / 摇摆时不抖 */
    if (st.x == null || Math.abs(st.x - x) > 80) { st.x = x; st.y = y; }
    const k = 1 - Math.exp(-dt / 0.06);
    st.x += (x - st.x) * k; st.y += (y - st.y) * k;
    const tx = clamp(ax - st.x, 16, w - 16);
    root.style.transform = `translate(${st.x.toFixed(1)}px, ${st.y.toFixed(1)}px) rotate(${(deg * 0.25).toFixed(2)}deg)`;
    inner.style.setProperty('--ox', tx + 'px');
    /* 云团尾巴：紧贴气泡底边排成一串（第一个压在底边下面，像从气泡里冒出来），往她头的方向斜下去 */
    const dir = ax - st.x < w / 2 ? -1 : 1;
    tails[0].style.transform = `translate(${tx - 5}px, ${h - 3}px)`;
    tails[1].style.transform = `translate(${tx - 3 + dir * 3}px, ${h + 4}px)`;
    tails[2].style.transform = `translate(${tx - 2 + dir * 5}px, ${h + 9}px)`;
  }

  XH.bubble = { mount, say, chatStart, append, mark, chatEnd, hide, busy, frame, hold: (b) => { st.hold = !!b; }, onTalk: (fn) => { st.talk = fn; }, state: st };
})();

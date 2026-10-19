/* 小嬅桌宠 · DDL（v0.7.0）
   - 存 localStorage['xh-ddl']：[{id, title, due, course, note, level 1–3, remind:[分钟…], done, doneAt, created, fired:{分钟:true}, overTold}]
   - 桌宠窗口里每 30 秒检查：到「提前量」就提醒一次（同时越过几档只说最近那档）；过了截止时间且没打勾，说一次
   - 每天早上 8 点后第一次用电脑，汇总今天 / 明天的 DDL（ddlMorning）
   - 免打扰时段只提醒 1 小时以内的；她正在回话就等一会儿
   - 面板「校园」页编辑，聊天里也能用工具加（tools.js） */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});
  const KEY = 'xh-ddl', MORNING_KEY = 'xh-ddl-morning';
  const DEF_DDL = { ddlRemind: [4320, 1440, 180, 60], ddlMorning: true };
  const REMIND_NAME = { 4320: '3 天', 1440: '1 天', 180: '3 小时', 60: '1 小时' };

  const read = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter((x) => x && x.id && x.title && x.due) : []; } catch (_) { return []; } };
  const write = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (_) { /* 满了就算了 */ } };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const clip = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };

  /* 截止时间的口语说法：今天 22:00 / 明天 23:59 / 10月23日 周五 18:00 */
  function whenText(t) {
    const d = new Date(t), today = ymd(Date.now()), tm = ymd(Date.now() + 86400000);
    const k = ymd(t);
    const pre = k === today ? '今天' : k === tm ? '明天' : `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
    return `${pre} ${hm(t)}`;
  }
  /* 倒计时：还剩 2 天 3 小时 / 还剩 45 分钟 / 已过 1 天 */
  function leftText(t, now) {
    let ms = t - (now || Date.now());
    const over = ms < 0; ms = Math.abs(ms);
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    const s = d >= 1 ? `${d} 天${h % 24 ? ' ' + (h % 24) + ' 小时' : ''}` : h >= 1 ? `${h} 小时${m % 60 ? ' ' + (m % 60) + ' 分' : ''}` : `${Math.max(1, m)} 分钟`;
    return over ? '已过 ' + s : '还剩 ' + s;
  }
  /* 紧急程度：over 已过 / hot 24 小时内 / warm 3 天内 / calm */
  const urgency = (x, now) => { const ms = x.due - (now || Date.now()); return ms < 0 ? 'over' : ms < 86400000 ? 'hot' : ms < 3 * 86400000 ? 'warm' : 'calm'; };

  const sorted = (a) => a.slice().sort((x, y) => (x.done - y.done) || (x.due - y.due));
  function list(opt) { const a = sorted(read()); return opt && opt.all ? a : a.filter((x) => !x.done); }
  function add(o, S) {
    const title = clip(String(o.title || '').trim(), 60);
    const due = +o.due;
    if (!title || !Number.isFinite(due)) return null;
    const it = {
      id: uid(), title, due, course: clip(String(o.course || '').trim(), 20), note: clip(String(o.note || '').trim(), 300),
      level: Math.min(3, Math.max(1, +o.level || 1)),
      remind: Array.isArray(o.remind) ? o.remind.map(Number).filter((n) => n > 0) : ((S && S.ddlRemind) || DEF_DDL.ddlRemind).slice(),
      done: false, doneAt: 0, created: Date.now(), fired: {}, overTold: false,
    };
    /* 新建时已经越过的提前量算提醒过了（今晚截止的作业不会一建好就弹“还剩 3 天”） */
    it.remind.forEach((m) => { if (R.nowFn() >= due - m * 60000) it.fired[m] = true; });
    const a = read(); a.push(it); write(a);
    return it;
  }
  function update(id, patch) {
    const a = read(), it = a.find((x) => x.id === id);
    if (!it) return null;
    const dueChanged = patch.due != null && +patch.due !== it.due;
    Object.assign(it, patch);
    if (patch.title != null) it.title = clip(String(patch.title).trim(), 60) || it.title;
    if (dueChanged || patch.remind) { it.fired = {}; it.overTold = false; it.remind.forEach((m) => { if (R.nowFn() >= it.due - m * 60000) it.fired[m] = true; }); }
    write(a);
    return it;
  }
  const remove = (id) => write(read().filter((x) => x.id !== id));
  function setDone(id, done) { const a = read(), it = a.find((x) => x.id === id); if (!it) return null; it.done = !!done; it.doneAt = done ? Date.now() : 0; write(a); return it; }
  /* 按关键词找（聊天里“高数作业交了”）：标题或课程包含，没完成的优先、最近截止的优先 */
  function find(kw) {
    const k = String(kw || '').trim().toLowerCase();
    if (!k) return [];
    return sorted(read()).filter((x) => (x.title + ' ' + x.course).toLowerCase().includes(k));
  }
  /* 接下来 hours 小时内要截止的（没完成的） */
  const upcoming = (hours) => list().filter((x) => x.due > Date.now() && x.due - Date.now() < hours * 3600e3);

  /* 给模型的一句：用户最近的 DDL */
  function brief(n) {
    const a = list().filter((x) => x.due > Date.now() - 86400000).slice(0, n || 4);
    if (!a.length) return '';
    return '用户最近的 DDL：' + a.map((x) => `${x.course ? x.course + ' · ' : ''}${x.title}（${whenText(x.due)} 截止，${leftText(x.due)}${x.level >= 3 ? '，很急' : ''}）`).join('；') + '。';
  }

  /* ---------- 提醒（只在桌宠窗口里跑） ---------- */
  const R = { P: null, getS: null, timer: 0, lastInput: 0, nowFn: () => Date.now() };
  function speak(text, mood, motion) {
    const P = R.P; if (!P) return;
    /* 她正在回你话：等这句说完（最多 1 分钟） */
    let tries = 0;
    const go = () => {
      if (XH.chat && XH.chat.busy() && tries++ < 12) { setTimeout(go, 5000); return; }
      P.wake();
      if (motion) P.play(motion, false, true, 1, { quiet: true });
      const B = XH.bubble;
      if (B) { B.chatStart(); B.append(text); B.chatEnd(); } else P.say(text, { type: 'say', force: true }, null);
      if (XH.chat) { const l = XH.chat.loadLog(); l.push({ role: 'assistant', content: text, mood: mood || '思考', t: Date.now(), tools: [{ n: 'DDL 提醒', ok: true }] }); XH.chat.saveLog(l); }
    };
    go();
  }
  const quietNow = (S) => !!(XH.assist && XH.assist.inQuiet && XH.assist.inQuiet(new Date(R.nowFn()).getHours(), S));

  function tick() {
    const S = { ...DEF_DDL, ...((R.getS && R.getS()) || {}) }, now = R.nowFn();
    const a = read();
    let changed = false;
    const say = [];
    for (const x of a) {
      if (x.done) continue;
      if (now >= x.due) {
        if (!x.overTold && now - x.due < 3 * 86400000) {
          x.overTold = true; changed = true;
          (x.remind || []).forEach((m) => { x.fired[m] = true; });
          say.push({ text: `「${x.title}」已经过截止时间啦…交了吗？交了记得在面板「校园」里打个勾哦`, mood: '惊讶', motion: 'tilt' });
        }
        continue;
      }
      /* 已经越过、还没提醒的档：只说离截止最近的那一档，其余一起标记 */
      const due = (x.remind || []).filter((m) => now >= x.due - m * 60000 && !x.fired[m]).sort((p, q) => p - q);
      if (!due.length) continue;
      const left = x.due - now;
      if (quietNow(S) && left > 60 * 60000) continue; // 免打扰时段：只提醒 1 小时以内的，其余等天亮
      due.forEach((m) => { x.fired[m] = true; });
      changed = true;
      const urgent = left <= 3 * 3600e3;
      say.push({
        text: `${urgent ? '注意注意！' : '提醒一下～'}「${x.title}」${leftText(x.due, now).replace('还剩', '还有')}就截止啦（${whenText(x.due)}）${urgent ? '，抓紧哦！' : '。'}`,
        mood: urgent ? '惊讶' : '思考', motion: urgent ? 'wave' : 'nod',
      });
    }
    if (changed) write(a);
    say.forEach((s, i) => setTimeout(() => speak(s.text, s.mood, s.motion), i * 7000));
    morning(S, now);
  }
  /* 早上第一次用电脑：今天 / 明天的 DDL 汇总 */
  function morning(S, now) {
    if (!S.ddlMorning) return;
    const d = new Date(now);
    if (d.getHours() < 8 || now - R.lastInput > 2 * 60000) return;
    const today = ymd(now);
    let last = ''; try { last = localStorage.getItem(MORNING_KEY) || ''; } catch (_) { /* 无所谓 */ }
    if (last === today) return;
    try { localStorage.setItem(MORNING_KEY, today); } catch (_) { /* 无所谓 */ }
    const tm = ymd(now + 86400000), a = list();
    const t1 = a.filter((x) => ymd(x.due) === today && x.due > now), t2 = a.filter((x) => ymd(x.due) === tm);
    if (!t1.length && !t2.length) return;
    const fmt = (xs) => xs.map((x) => `${x.title}（${hm(x.due)}）`).join('、');
    const parts = [];
    if (t1.length) parts.push(`今天要交：${fmt(t1)}`);
    if (t2.length) parts.push(`明天：${fmt(t2)}`);
    speak(`早上好～${parts.join('；')}。加油哦！`, '打招呼', 'greet');
  }

  XH.DEF_DDL = DEF_DDL;
  XH.ddl = {
    KEY, DEF: DEF_DDL, REMIND_NAME, list, add, update, remove, setDone, find, upcoming, brief, whenText, leftText, urgency, ymd, hm,
    start(P, getS) {
      if (R.timer) return;
      R.P = P; R.getS = getS; R.lastInput = Date.now();
      R.timer = setInterval(tick, 30000);
      setTimeout(tick, 5000);
    },
    /* 有人在用电脑（pet.js 在全局光标移动时调用） */
    input() { R.lastInput = R.nowFn(); },
    /* 测试用：假时钟 + 立刻检查一次 */
    _test: { setNow(fn) { R.nowFn = fn || (() => Date.now()); }, tick },
  };
})();

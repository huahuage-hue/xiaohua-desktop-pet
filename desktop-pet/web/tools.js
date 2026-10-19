/* 小嬅桌宠 · 帮你做事（v0.6.0）
   - 给模型的工具定义（OpenAI tools 格式）+ 本地执行
   - 只做安全动作：报时 / 天气 / 提醒 / 便签 / 打开网页 / 浏览器搜索 / 打开开始菜单里的程序 / 读写剪贴板 / 看屏幕（vision.js）
   - 会动到电脑或把内容发出去的动作，执行前先问用户（ctx.confirm），不同意就不做
   - 提醒存 localStorage['xh-reminders']，便签存 localStorage['xh-notes']，重启不丢 */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});
  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : null;
  const REM_KEY = 'xh-reminders', NOTE_KEY = 'xh-notes';

  const read = (k) => { try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const write = (k, a) => { try { localStorage.setItem(k, JSON.stringify(a)); } catch (_) { /* 满了就算了 */ } };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clip = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const whenText = (t) => { const d = new Date(t), now = new Date(); return (d.toDateString() === now.toDateString() ? '今天' : (d.getMonth() + 1) + '月' + d.getDate() + '日') + ' ' + hm(t); };

  const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: properties || {}, required: required || [] } } });
  const DEFS = [
    fn('get_time', '查看现在的日期和时间'),
    fn('get_weather', '查看用户所在城市现在的天气（城市在控制面板里设置）'),
    fn('set_reminder', '设一个提醒，到点后小嬅会跳出来提醒用户。minutes 和 time 二选一', {
      minutes: { type: 'number', description: '多少分钟后提醒，1 到 1440' },
      time: { type: 'string', description: '几点提醒，24 小时制 HH:MM；已经过了就是明天' },
      text: { type: 'string', description: '提醒内容，简短' },
    }, ['text']),
    fn('list_reminders', '列出还没到点的提醒'),
    fn('cancel_reminder', '取消提醒', { keyword: { type: 'string', description: '提醒内容里的关键词；“全部”表示全部取消' } }, ['keyword']),
    fn('add_ddl', '记一个 DDL（作业、报告、考试、报名等截止时间），到时间前小嬅会提醒用户', {
      title: { type: 'string', description: '要交 / 要做的事，简短，例如“高数第三章作业”' },
      due: { type: 'string', description: '截止时间，YYYY-MM-DD HH:MM（按今天的日期把“周五晚上”等换算好；没说几点就用 23:59）' },
      course: { type: 'string', description: '课程或分类（可空）' },
      note: { type: 'string', description: '备注（可空）' },
      level: { type: 'number', description: '重要程度 1 普通 / 2 重要 / 3 很急（可空）' },
    }, ['title', 'due']),
    fn('list_ddl', '查看用户还没完成的 DDL'),
    fn('finish_ddl', '把某个 DDL 标记为已完成（用户说交了 / 做完了）', { keyword: { type: 'string', description: '标题或课程里的关键词' } }, ['keyword']),
    fn('take_note', '帮用户记一条便签（用户能在控制面板里看到）', { text: { type: 'string', description: '便签内容' } }, ['text']),
    fn('list_notes', '查看最近记下的便签'),
    fn('open_url', '在浏览器里打开一个网页（会先问用户）', { url: { type: 'string', description: '完整网址，http 或 https 开头' } }, ['url']),
    fn('web_search', '在浏览器里用必应搜索（会先问用户）。你看不到搜索结果，只是帮用户打开搜索页', { query: { type: 'string', description: '搜索词' } }, ['query']),
    fn('open_app', '打开电脑上的程序，比如记事本、计算器、微信、网易云音乐（会先问用户）', { name: { type: 'string', description: '程序名' } }, ['name']),
    fn('read_clipboard', '读取用户剪贴板里的文字（会先问用户）'),
    fn('write_clipboard', '把一段文字复制到用户的剪贴板（会先问用户）', { text: { type: 'string', description: '要复制的文字' } }, ['text']),
  ];
  /* 看屏幕：只在面板里打开了「让她能看屏幕」时才给模型 */
  const LOOK = fn('look_screen', '看一眼用户现在的电脑屏幕，返回屏幕内容的文字描述。只在用户让你看屏幕、帮忙看报错或问屏幕上的东西时用', {
    question: { type: 'string', description: '用户想从屏幕上知道什么（可空）' },
  });
  /* 侧边窗 / 气泡里显示用的动作名 */
  const NAME = { add_ddl: '记 DDL', list_ddl: '看 DDL', finish_ddl: '完成 DDL', get_time: '看时间', get_weather: '查天气', set_reminder: '设提醒', list_reminders: '看提醒', cancel_reminder: '取消提醒', take_note: '记便签', list_notes: '看便签', open_url: '打开网页', web_search: '搜索', open_app: '打开程序', read_clipboard: '看剪贴板', write_clipboard: '复制到剪贴板', look_screen: '看屏幕' };

  /* ---------- 提醒 ---------- */
  const R = { P: null, timer: 0 };
  function fire(r, late, tries = 0) {
    const P = R.P; if (!P) return;
    /* 她正在回你话：等这句说完再提醒（最多等 1 分钟） */
    if (XH.chat && XH.chat.busy() && tries < 12) { setTimeout(() => fire(r, late, tries + 1), 5000); return; }
    const text = (late ? '刚才说好要提醒你的：' : '到点啦～') + r.text;
    P.wake();
    P.play('wave', false, true, 1, { quiet: true });
    /* 走对话气泡：待机小动作的台词不会把它顶掉 */
    const B = XH.bubble;
    if (B) { B.chatStart(); B.append(text); B.chatEnd(); } else P.say(text, { type: 'say', force: true }, null);
    if (XH.chat) { const l = XH.chat.loadLog(); l.push({ role: 'assistant', content: text, mood: '挥手', t: Date.now() }); XH.chat.saveLog(l); }
  }
  function tick() {
    const now = Date.now(), all = read(REM_KEY);
    const due = all.filter((r) => r.at <= now), rest = all.filter((r) => r.at > now);
    if (!due.length) return;
    write(REM_KEY, rest);
    /* 桌宠没开着时错过的：12 小时内的补说一声，更早的就算了 */
    due.forEach((r, i) => { if (now - r.at < 12 * 3600e3) setTimeout(() => fire(r, now - r.at > 60e3), i * 6000); });
  }

  /* ---------- 执行 ---------- */
  const ok = (content, label) => ({ ok: true, content, label: label || content });
  const no = (content, label) => ({ ok: false, content, label: label || content });
  const refused = (what) => no('用户没有同意，' + what + '没有执行。', '你没同意，没' + what);

  async function exec(name, a, ctx) {
    const S = ctx.S || {};
    switch (name) {
      case 'get_time': {
        const d = new Date();
        return ok(`现在是${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]} ${hm(d)}`, '看了下时间');
      }
      case 'get_weather': {
        if (!S.city) return no('用户还没在控制面板「小助手」里选城市，查不到天气。', '还不知道你在哪个城市');
        const w = XH.fetchWeather ? await XH.fetchWeather(S.city) : null;
        if (!w) return no('天气没查到，可能是网络问题。', '天气没查到');
        const line = XH.assist && XH.assist.weatherLine ? XH.assist.weatherLine(w, S.city.name).replace(/\n/g, '，') : '';
        return ok(`${S.city.name}：现在 ${Math.round(w.temp)}°C，今天 ${Math.round(w.min)}~${Math.round(w.max)}°C${w.rainSoon ? '，三小时内可能下雨' : ''}。${line}`, `查了${S.city.name}的天气`);
      }
      case 'set_reminder': {
        const text = clip(String(a.text || '').trim(), 60);
        if (!text) return no('提醒内容是空的。');
        let at = 0;
        if (a.minutes != null && +a.minutes > 0) at = Date.now() + Math.min(1440, Math.max(1, +a.minutes)) * 60e3;
        else if (/^\d{1,2}:\d{2}$/.test(String(a.time || '').trim())) {
          const [h, m] = String(a.time).trim().split(':').map(Number);
          if (h > 23 || m > 59) return no('时间格式不对。');
          const d = new Date(); d.setHours(h, m, 0, 0);
          if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
          at = d.getTime();
        } else return no('没说什么时候提醒。');
        const list = read(REM_KEY); list.push({ id: uid(), at, text, created: Date.now() }); list.sort((x, y) => x.at - y.at);
        write(REM_KEY, list.slice(0, 50));
        return ok(`已设提醒：${whenText(at)}「${text}」`, `设了提醒 · ${whenText(at)} ${text}`);
      }
      case 'list_reminders': {
        const list = read(REM_KEY);
        return ok(list.length ? list.map((r) => `${whenText(r.at)}「${r.text}」`).join('；') : '现在没有提醒。', `看了提醒（${list.length} 个）`);
      }
      case 'cancel_reminder': {
        const k = String(a.keyword || '').trim(), list = read(REM_KEY);
        const all = /^(全部|所有|all)$/i.test(k);
        const hit = list.filter((r) => all || (k && r.text.includes(k)));
        if (!hit.length) return no(`没找到包含「${k}」的提醒。`, '没找到这个提醒');
        write(REM_KEY, list.filter((r) => !hit.includes(r)));
        return ok(`已取消 ${hit.length} 个提醒：${hit.map((r) => r.text).join('、')}`, `取消了 ${hit.length} 个提醒`);
      }
      case 'add_ddl': {
        if (!XH.ddl) return no('DDL 功能没加载。');
        const m = String(a.due || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
        if (!m) return no('截止时间格式不对，要 YYYY-MM-DD HH:MM。');
        const due = new Date(+m[1], +m[2] - 1, +m[3], m[4] != null ? +m[4] : 23, m[5] != null ? +m[5] : 59).getTime();
        const it = XH.ddl.add({ title: a.title, due, course: a.course, note: a.note, level: a.level }, S);
        if (!it) return no('DDL 标题是空的。');
        return ok(`已记下 DDL：「${it.title}」，${XH.ddl.whenText(it.due)} 截止（${XH.ddl.leftText(it.due)}）${due < Date.now() ? '——注意这个时间已经过了' : ''}；会提前提醒。`, `记了 DDL · ${it.title} · ${XH.ddl.whenText(it.due)}`);
      }
      case 'list_ddl': {
        if (!XH.ddl) return no('DDL 功能没加载。');
        const xs = XH.ddl.list();
        return ok(xs.length ? xs.map((x) => `${x.course ? x.course + ' · ' : ''}${x.title}：${XH.ddl.whenText(x.due)} 截止，${XH.ddl.leftText(x.due)}`).join('；') : '现在没有没完成的 DDL。', `看了 DDL（${xs.length} 个）`);
      }
      case 'finish_ddl': {
        if (!XH.ddl) return no('DDL 功能没加载。');
        const hit = XH.ddl.find(a.keyword).filter((x) => !x.done);
        if (!hit.length) return no(`没找到包含「${a.keyword}」的未完成 DDL。`, '没找到这个 DDL');
        XH.ddl.setDone(hit[0].id, true);
        return ok(`已把「${hit[0].title}」标记为完成。` + (hit.length > 1 ? `（还有 ${hit.length - 1} 个也匹配，没动）` : ''), '完成了 · ' + hit[0].title);
      }
      case 'take_note': {
        const text = clip(String(a.text || '').trim(), 500);
        if (!text) return no('便签内容是空的。');
        const list = read(NOTE_KEY); list.push({ id: uid(), t: Date.now(), text }); write(NOTE_KEY, list.slice(-100));
        return ok('已记下便签：' + text, '记了便签 · ' + clip(text, 16));
      }
      case 'list_notes': {
        const list = read(NOTE_KEY).slice(-10);
        return ok(list.length ? list.map((n) => `${whenText(n.t)}：${n.text}`).join('\n') : '还没有便签。', `看了便签（${list.length} 条）`);
      }
      case 'open_url': {
        const url = String(a.url || '').trim();
        if (!/^https?:\/\/[^\s"]+$/i.test(url)) return no('网址不对，只能打开 http / https 网址。', '网址不对');
        let host = url; try { host = new URL(url).host; } catch (_) { /* 用原文 */ }
        if (!(await ctx.confirm(`要我帮你打开这个网页吗？\n${host}`))) return refused('打开网页');
        if (invoke) await invoke('agent_open_url', { url }); else window.open(url, '_blank', 'noopener');
        return ok('已在浏览器打开 ' + url, '打开了 ' + host);
      }
      case 'web_search': {
        const q = clip(String(a.query || '').trim(), 80);
        if (!q) return no('搜索词是空的。');
        if (!(await ctx.confirm(`要我在浏览器里搜「${q}」吗？`))) return refused('搜索');
        const url = 'https://www.bing.com/search?q=' + encodeURIComponent(q);
        if (invoke) await invoke('agent_open_url', { url }); else window.open(url, '_blank', 'noopener');
        return ok(`已在浏览器打开必应搜索「${q}」（你看不到结果）`, '搜索了 ' + q);
      }
      case 'open_app': {
        if (!invoke) return no('调试模式不能打开程序。');
        const want = String(a.name || '').trim();
        const hit = await invoke('agent_find_app', { name: want });
        if (!(await ctx.confirm(`要我帮你打开「${hit.name}」吗？`))) return refused('打开程序');
        await invoke('agent_launch', { target: hit.target });
        return ok(`已打开「${hit.name}」`, '打开了 ' + hit.name);
      }
      case 'read_clipboard': {
        if (!(await ctx.confirm('要我看一下你剪贴板里的文字吗？\n（内容会发给模型服务商）'))) return refused('读剪贴板');
        const t = invoke ? await invoke('agent_clip_get') : await navigator.clipboard.readText();
        if (!t) return ok('剪贴板里没有文字。', '剪贴板是空的');
        return ok('剪贴板内容：\n' + clip(t, 3000), '看了剪贴板（' + [...t].length + ' 字）');
      }
      case 'write_clipboard': {
        const text = String(a.text || '');
        if (!text) return no('要复制的文字是空的。');
        if (!(await ctx.confirm(`要我把这段文字复制到剪贴板吗？\n${clip(text, 40)}`))) return refused('复制');
        if (invoke) await invoke('agent_clip_set', { text }); else await navigator.clipboard.writeText(text);
        return ok('已复制到剪贴板。', '复制好了 · ' + clip(text, 16));
      }
      case 'look_screen': {
        if (!XH.vision) return no('看屏幕功能没加载。');
        const r = await XH.vision.look(S, a.question, ctx.confirm);
        if (!r.ok) return no('没看成屏幕：' + r.why, r.why);
        return ok(`屏幕上（${r.proc || '前台程序'}）：${r.text}`, '看了一眼屏幕');
      }
      default:
        return no('没有这个工具：' + name);
    }
  }

  XH.tools = {
    DEFS, NAME,
    defs: (S) => (S && S.visionOn ? DEFS.concat(LOOK) : DEFS),
    /* call = {id, name, arguments(JSON 字符串)}；ctx = {S, confirm(text) → Promise<bool>}；返回 {ok, content(给模型), label(给人看)} */
    async run(call, ctx) {
      let a = {};
      try { a = call.arguments ? JSON.parse(call.arguments) : {}; } catch (_) { return no('参数不是合法的 JSON。', (NAME[call.name] || call.name) + '：参数不对'); }
      try { return await exec(call.name, a || {}, ctx); }
      catch (e) { const m = String((e && e.message) || e || '出错了'); return no('执行失败：' + m, (NAME[call.name] || call.name) + '没成功：' + clip(m, 20)); }
    },
    start(P) {
      if (R.timer) return;
      R.P = P;
      R.timer = setInterval(tick, 10000);
      setTimeout(tick, 3000);
    },
    reminders: { list: () => read(REM_KEY), remove: (id) => write(REM_KEY, read(REM_KEY).filter((r) => r.id !== id)), clear: () => write(REM_KEY, []) },
    notes: { list: () => read(NOTE_KEY), remove: (id) => write(NOTE_KEY, read(NOTE_KEY).filter((n) => n.id !== id)), clear: () => write(NOTE_KEY, []) },
    whenText,
  };
})();

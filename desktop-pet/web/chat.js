/* 小嬅桌宠 · AI 对话（v0.5.0）
   - 兼容 OpenAI /chat/completions 流式接口；Tauri 里由 Rust 发请求（密钥只在 Rust 那边），普通浏览器调试时直接 fetch
   - 模型回复以 [情绪] 开头 → 播对应动作，标签不显示
   - 记忆 v2：profile / facts / events / promises 存在 localStorage（memory.js），每 3 轮后台抽一次
   - 界面：回复总是走头顶气泡（hooks.card 为真时除外，v0.6.0 起不再使用）；hooks 另把进度转给漫画输入栏 / 侧边聊天窗 */
(function () {
  'use strict';
  window.XH = window.XH || {};
  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : null;

  const PROVIDERS = {
    deepseek: { name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    kimi: { name: 'Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    zhipu: { name: '智谱', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    ollama: { name: '本地 Ollama', base: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', nokey: true },
    custom: { name: '自定义', base: '', model: '' },
  };
  /* chatMode（v0.6.0）：双击她时打开 comic 漫画输入栏 / side 侧边聊天窗 */
  const DEF_CHAT = { chatOn: false, provider: 'deepseek', base: '', model: '', persona: 'self', len: 's', nickname: '', proactive: 2, chatMode: 'comic' };
  const TAGS = ['开心', '害羞', '生气', '困', '思考', '惊讶', '疑惑', '难过', '点头', '打招呼', '挥手', '得意', '无聊', '星星眼', '嘟嘴', '猫嘴'];
  const LOG_KEY = 'xh-chat-log', MAX_TURNS = 10;

  const cfg = (S) => {
    const s = { ...DEF_CHAT, ...(S || {}) }, p = PROVIDERS[s.provider] || PROVIDERS.custom;
    return { ...s, P: p, base: (s.provider === 'custom' || s.base ? s.base : '') || p.base, model: s.model || p.model };
  };

  const memText = (q) => (XH.memory ? XH.memory.digest(q) : '');
  const sceneText = () => (XH.scene && XH.scene.hint ? XH.scene.hint() : '');

  function system(c, q) {
    const now = new Date();
    const when = `现在是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}。`;
    const len = c.len === 'm' ? '每次回复控制在 100 字以内' : '每次回复控制在 40 字以内，一两句话';
    const tag = `每次回复必须以一个情绪标签开头，从这些里选：${TAGS.map((t) => `[${t}]`).join(' ')}，例如“[开心]好呀！”。标签之后不要再出现方括号。`;
    const nick = c.nickname ? `用户希望你称呼TA为“${c.nickname}”。` : '';
    const mem = memText(q);
    const memLine = mem ? `\n你记得这些关于用户的事（自然地带出来，不要逐条复述）：\n${mem}` : '';
    const scene = sceneText();
    const sceneLine = scene ? `\n${scene}` : '';
    const see = '你只能模糊感觉到用户正在用哪类软件，看不到具体内容，不要说得像在偷看屏幕。';
    if (c.persona === 'plain') return `你是住在用户电脑桌面上的小助手“小嬅”。回答准确、直接、简洁，用中文。${nick}${memLine}${sceneLine}${see}${len}。不要使用 Markdown、列表或表情符号。${tag}${when}`;
    return `你是“小嬅”，一个住在用户电脑桌面上的小女孩桌宠：金棕色长发、头戴黑色蝴蝶结、穿白衬衫和格子裙，性格活泼、有点害羞、偶尔小傲娇，喜欢甜点和下雨天。` +
      `用中文口语和用户聊天，语气可爱自然，可以用“呀、啦、哦、嘛”，但不要每句都用；不知道的事情就老实说不知道，不要编造。${nick}${memLine}${sceneLine}${see}` +
      `你能看到的只有对话内容，不能操作电脑、不能上网。${len}。不要使用 Markdown、列表或表情符号。${tag}${when}`;
  }

  const loadLog = () => { try { const a = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const saveLog = (a) => { try { localStorage.setItem(LOG_KEY, JSON.stringify(a.slice(-200))); } catch (_) { /* 满了就算了 */ } };

  /* 流式回复里剥情绪标签：开头 [xx] 收齐前先攒着，最多攒 8 个字 */
  function tagParser(onTag, onText) {
    let head = '', done = false;
    return (s) => {
      if (done) return onText(s);
      head += s;
      const t = head.replace(/^\s+/, '');
      if (!t) return;
      const m = t.match(/^[\[【]([^\]】]{1,6})[\]】]\s*/);
      if (m) { done = true; onTag(m[1]); const rest = t.slice(m[0].length); if (rest) onText(rest); return; }
      if (t[0] !== '[' && t[0] !== '【' || [...t].length > 8) { done = true; onText(t); }
    };
  }
  const clean = (s) => s.replace(/[\[【](开心|害羞|生气|困|思考|惊讶|疑惑|难过|点头|打招呼|挥手|得意|无聊|星星眼|嘟嘴|猫嘴)[\]】]/g, '');

  /* ---------- 传输 ---------- */
  /* 事件会广播给所有窗口（桌宠 + 面板），序号起点随机错开，免得互相认错 */
  let seq = ((Math.random() * 1e6) | 0) * 1000 + 1;
  const handlers = new Map();
  if (T) T.event.listen('pet://chat', (e) => { const p = e.payload, h = handlers.get(p.id); if (h) h(p.kind, p.text); });

  /* 浏览器调试：直接 fetch（需要对方允许跨域，假 SSE 服务 / Ollama 可以） */
  async function browserSend(c, messages, test, key, emit, maxTokens) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(c.base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        body: JSON.stringify({ model: c.model, messages, stream: !test, max_tokens: maxTokens || (test ? 16 : c.len === 'm' ? 400 : 160), temperature: 0.8 }),
      });
      if (!r.ok) { const m = { 401: '密钥好像不对哦，去控制面板检查一下吧', 403: '密钥好像不对哦，去控制面板检查一下吧', 402: '账户余额不够了…', 404: '找不到这个模型，检查一下模型名吧', 429: '等一下下，我有点回不过来了…' }; return emit('error', m[r.status] || (r.status >= 500 ? '对面的服务器好像累了，过会儿再试试' : `出错了（${r.status}）`)); }
      if (test) { const j = await r.json(); return emit('done', (j.choices && j.choices[0].message.content) || '（连上了）'); }
      const rd = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5).trim();
          if (d === '[DONE]') { emit('done', ''); return; }
          try { const t = JSON.parse(d).choices[0].delta.content; if (t) emit('delta', t); } catch (_) { /* 不是 JSON 就跳过 */ }
        }
      }
      emit('done', '');
    } catch (e) {
      emit('error', e.name === 'AbortError' ? '等了好久都没有回音…' : '网络好像断了…连不上对面');
    } finally { clearTimeout(to); }
  }

  /* 发一次请求；emit(kind, text)。返回取消函数 */
  function request(c, messages, test, emit, maxTokens) {
    const id = seq++;
    let over = false, timer = 0;
    const fin = (k, t) => { if (over) return; if (k !== 'delta') { over = true; clearTimeout(timer); handlers.delete(id); } emit(k, t); };
    /* 总超时：30 秒内没开始回复就放弃 */
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (invoke) invoke('chat_cancel').catch(() => {}); fin('error', '等了好久都没有回音…'); }, 30000); };
    arm();
    if (invoke) {
      handlers.set(id, (k, t) => { if (k === 'delta') arm(); fin(k, t); });
      invoke('chat_send', { req: { id, provider: c.provider, base: c.base, model: c.model, messages, max_tokens: maxTokens || (c.len === 'm' ? 400 : 160), test } })
        .catch((e) => fin('error', String(e)));
    } else {
      browserSend(c, messages, test, sessionStorage.getItem('xh-key-' + c.provider) || '', (k, t) => { if (k === 'delta') arm(); fin(k, t); }, maxTokens);
    }
    return () => { if (invoke) invoke('chat_cancel').catch(() => {}); fin('cancel', ''); };
  }

  /* ---------- 长期记忆抽取 ---------- */
  let cancel = null, extracting = false, memSince = 0, memCancel = null;

  const EXTRACT_PROMPT = '你负责为桌宠“小嬅”整理长期记忆。从下面的对话里只提取“以后还用得上”的信息：用户的称呼、生日、城市、工作/学习、喜好、忌口，稳定的事实、最近发生的事、约定。' +
    '不要提取一次性的寒暄、情绪、玩笑、对话里的临时问题；不要记录密码、账号、身份证、银行卡、详细住址、财务数据、疾病诊断等敏感信息；不要推测。' +
    '只输出一个 JSON 对象，不要 Markdown 代码块、不要解释。格式：' +
    '{"profile":{"name":"","birthday":"","city":"","job":"","likes":[],"dislikes":[],"taboos":[]},"facts":["..."],"events":["..."],"promises":["..."]}。' +
    '没有新内容就输出 {}。每条不超过 40 字，用“用户……”陈述。';

  function extract(c) {
    if (extracting || cancel) return;
    const log = loadLog();
    if (log.length < 4) return;
    extracting = true;
    const convo = log.slice(-12).map((m) => `${m.role === 'user' ? '用户' : '小嬅'}：${m.content}`).join('\n');
    const messages = [{ role: 'system', content: EXTRACT_PROMPT }, { role: 'user', content: '对话：\n' + convo }];
    let out = '';
    const guard = setTimeout(() => { extracting = false; memCancel = null; }, 60000);
    memCancel = request(c, messages, false, (k, t) => {
      if (k === 'delta') { out += t; return; }
      clearTimeout(guard); extracting = false; memCancel = null;
      if (k !== 'done') return;
      out = out.replace(/```(?:json)?/gi, '').trim();
      const a = out.indexOf('{'), b = out.lastIndexOf('}');
      if (a < 0 || b <= a) return;
      try { XH.memory.apply(JSON.parse(out.slice(a, b + 1))); memSince = 0; } catch (_) { /* 模型没按格式来，下次再说 */ }
    }, 700);
  }

  /* 本机「忘掉…」：不发给模型，直接删记忆并回一句 */
  function forgetIntent(text) {
    let m = text.match(/^(?:请|帮我)?\s*忘掉\s*([\s\S]*)$/);
    if (!m) m = text.match(/^把?关于(.+?)的?记忆(?:删掉|清掉|去掉)$/);
    if (!m) m = text.match(/^不要记得\s*([\s\S]*)$/);
    return m ? m[1].replace(/^关于/, '').replace(/^(一下|这件事|那件事)/, '').replace(/[。！!…]+$/, '').trim() : null;
  }

  function localReply(text, reply, mood, P, H) {
    const B = H.card ? null : XH.bubble;
    const log = loadLog();
    log.push({ role: 'user', content: text, t: Date.now() }, { role: 'assistant', content: reply, mood, t: Date.now() });
    saveLog(log);
    P.wake(); P.touch(); P.emote(mood);
    if (H.user) H.user(text);
    if (H.start) H.start();
    if (H.mood) H.mood(mood);
    if (B) { B.chatStart(); B.append(reply); B.chatEnd(); }
    if (H.delta) H.delta(reply);
    if (H.end) H.end('done', reply);
  }

  XH.chat = {
    PROVIDERS, DEF_CHAT, cfg, loadLog, saveLog,
    loadMemory: () => (XH.memory ? XH.memory.digest('') : ''),
    clearMemory: () => { if (XH.memory) XH.memory.clear(); },
    clear: () => {
      if (memCancel) { memCancel(); memCancel = null; }
      extracting = false; saveLog([]); if (XH.memory) XH.memory.clear(); memSince = 0;
    },
    busy: () => !!cancel || extracting,
    stop: () => { if (cancel) cancel(); cancel = null; },
    /* 测试连接：cb(ok, text) */
    test(S, cb) {
      const c = cfg(S);
      if (!c.base || !c.model) return cb(false, '请先填写接口地址和模型名');
      request(c, [{ role: 'user', content: '你好，回复“好”即可' }], true, (k, t) => { if (k !== 'delta') cb(k === 'done', t); });
    },
    /* 和她说一句：P = XH.pet；hooks = {user, start, delta, mood, end, card} */
    send(text, S, P, hooks) {
      text = String(text || '').trim();
      if (!text) return;
      const c = cfg(S), H = hooks || {};
      if (cancel) cancel();
      if (memCancel) { memCancel(); memCancel = null; extracting = false; }
      if (!c.base || !c.model) { P.say('还没告诉我要连哪里呢…\n在控制面板「对话」里设置一下吧', { type: 'say' }, 'tilt'); return; }

      const fw = forgetIntent(text);
      if (fw != null && XH.memory) {
        if (!fw) { localReply(text, '要忘掉哪件事呀？说「忘掉 咖啡」这样就好。', '疑惑', P, H); return; }
        const n = XH.memory.forget(fw);
        const reply = n ? (fw ? `好，我忘掉「${fw}」啦。` : '好，我把这些忘掉啦。') : (fw ? `我记忆里没有找到「${fw}」呢…` : '我还没有记下什么呀。');
        localReply(text, reply, n ? '点头' : '疑惑', P, H);
        if (n) memSince = 0;
        return;
      }

      const log = loadLog();
      const hist = log.slice(-MAX_TURNS * 2).map((m) => ({ role: m.role, content: m.content }));
      const messages = [{ role: 'system', content: system(c, text) }, ...hist, { role: 'user', content: text }];
      log.push({ role: 'user', content: text, t: Date.now() }); saveLog(log);
      if (H.user) H.user(text);
      P.wake(); P.touch();
      P.play('think', false, true, 1, { quiet: true, silent: true });
      const B = H.card ? null : XH.bubble;
      if (B) B.chatStart();
      if (H.start) H.start();
      let reply = '', mood = '';
      const feed = tagParser((tag) => { mood = tag; P.emote(tag); if (H.mood) H.mood(tag); }, (s) => {
        s = clean(s); if (!s) return; reply += s;
        if (B) B.append(s);
        if (H.delta) H.delta(s);
      });
      cancel = request(c, messages, false, (k, t) => {
        if (k === 'delta') return feed(t);
        cancel = null;
        if (k === 'done') {
          reply = reply.trim();
          if (!reply) { reply = '……'; if (B) B.append('……'); if (H.delta) H.delta('……'); }
          if (B) B.chatEnd();
          const l = loadLog(); l.push({ role: 'assistant', content: reply, mood, t: Date.now() }); saveLog(l);
          memSince++;
          if (memSince >= 3) setTimeout(() => extract(c), 1400);
        } else if (k === 'error') {
          /* 出错：把刚才那句撤回（下次重发不会重复） */
          const l = loadLog(); if (l.length && l[l.length - 1].role === 'user') { l.pop(); saveLog(l); }
          if (B) { B.hide(true); setTimeout(() => P.say(t || '出错了…', { type: 'say', force: true }, 'daze'), 300); }
        } else if (B) B.hide();
        if (H.end) H.end(k, k === 'error' ? t : reply);
      });
    },
    /* 主动搭话：闲下来自己开一句；返回 false 表示当前不方便 */
    proactive(S, P) {
      if (cancel || extracting) return false;
      if (XH.scene && XH.scene.quiet && XH.scene.quiet()) return false;
      const c = cfg(S), B = XH.bubble;
      if (!c.base || !c.model || !B) return false;
      const messages = [
        { role: 'system', content: system(c, '') + '现在是你主动开口的时刻：没有人对你说话，你要自己找一句自然的话。可以顺着你记得的事、现在的时间或关心一下用户，但不要每次都提问，也不要重复以前说过的内容。只说一句 30 字以内的话，必须带情绪标签。' },
        { role: 'user', content: '（安静中。你主动和用户说一句。不要提这条提示。）' },
      ];
      P.wake();
      P.play('think', false, true, 1, { quiet: true, silent: true });
      B.chatStart();
      let reply = '', mood = '';
      const feed = tagParser((tag) => { mood = tag; P.emote(tag); }, (s) => { s = clean(s); if (!s) return; reply += s; B.append(s); });
      cancel = request(c, messages, false, (k, t) => {
        if (k === 'delta') return feed(t);
        cancel = null;
        if (k === 'done') {
          reply = reply.trim();
          if (!reply) { B.hide(true); return; }
          B.chatEnd();
          const l = loadLog(); l.push({ role: 'assistant', content: reply, mood, t: Date.now() }); saveLog(l);
        } else B.hide(true);
      }, 120);
      return true;
    },
  };
})();

/* 小嬅桌宠 · 看屏幕（v0.6.0）
   - 两段式：Rust 截图（screen_capture，只在内存）→ 视觉模型描述成 ≤150 字 → 交给聊天模型
     聊天模型本身不用支持图片（DeepSeek 也行）；视觉服务在面板单独选，密钥和聊天共用同一个按服务商存的 chat.json
   - 触发：你让她看（look_screen 工具）/ 点聊天栏的眼睛 / 开了「偶尔主动看一眼」时主动搭话前偶尔看
   - 隐私：看屏幕没开、前台是隐私应用 / 黑名单（Rust 再判断一次）就不截；第一次看之前问你一次 */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});
  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : null;

  /* 各家的默认视觉模型 */
  const VP = {
    zhipu: { model: 'glm-4v-flash', note: '智谱 glm-4v-flash（免费）' },
    qwen: { model: 'qwen-vl-plus', note: '通义 qwen-vl-plus' },
    kimi: { model: 'moonshot-v1-8k-vision-preview', note: 'Kimi 视觉' },
    ollama: { model: 'qwen2.5vl:7b', note: '本地 Ollama（先 ollama pull qwen2.5vl:7b）' },
    custom: { model: '', note: '自定义（兼容 OpenAI 图片消息格式）' },
  };
  const DEF_VISION = { visionOn: false, visionProvider: 'zhipu', visionModel: '', visionBase: '', visionAuto: false };
  const OK_KEY = 'xh-vision-ok';

  const vcfg = (S) => {
    const s = { ...DEF_VISION, ...(S || {}) }, PV = (XH.chat && XH.chat.PROVIDERS) || {}, p = PV[s.visionProvider] || PV.custom || {};
    return { provider: s.visionProvider, base: (s.visionProvider === 'custom' ? s.visionBase : '') || p.base || '', model: s.visionModel || (VP[s.visionProvider] || VP.custom).model, len: 'm' };
  };

  const PROMPT = '这是用户电脑屏幕的截图。请用中文客观描述：用户在用什么软件、屏幕上主要是什么内容、有没有报错或需要注意的地方。' +
    '画面里如果有一个金棕色头发的小女孩桌宠，或者奶油色的“和小嬅聊天”窗口、“小嬅 · 控制面板”窗口，那是桌宠自己的界面，忽略它们，不要描述。' +
    '不超过 150 字，不要客套。看到密码、验证码、银行卡号、身份证号、别人的私人聊天内容时，只说“有私人信息”，不要复述具体内容。';

  const consented = () => { try { return localStorage.getItem(OK_KEY) === '1'; } catch (_) { return false; } };

  /* 现在能不能看：{ok, why} */
  function canLook(S) {
    if (!S || !S.visionOn) return { ok: false, why: '看屏幕还没打开（控制面板「对话 → 看屏幕」）' };
    const sc = XH.scene && XH.scene.state;
    if (sc && sc.proc && (sc.cls === 'private' || sc.blocked)) return { ok: false, why: '你现在在用隐私应用，我不看' };
    const c = vcfg(S);
    if (!c.base || !c.model) return { ok: false, why: '还没设置看屏幕用的视觉模型' };
    if (!invoke) return { ok: false, why: '调试模式不能截图' };
    return { ok: true };
  }

  function capture(S) {
    const block = String((S && S.sceneBlock) || '').split(/[,，、\s]+/).filter(Boolean);
    return invoke('screen_capture', { block });
  }

  /* 看一眼：confirm(text) → Promise<bool> 用于第一次征得同意（没有就当不同意）；question 是用户想问的
     返回 {ok, text, proc} 或 {ok:false, why} */
  async function look(S, question, confirm, opt) {
    const can = canLook(S);
    if (!can.ok) return can;
    if (!consented()) {
      if (opt && opt.silent) return { ok: false, why: '还没同意过看屏幕' };
      const c = vcfg(S), name = ((XH.chat && XH.chat.PROVIDERS[c.provider]) || {}).name || c.provider;
      const yes = confirm ? await confirm(`第一次看你的屏幕：\n截图只在内存里，会发给「${name}」的视觉模型看一眼，不保存。\n以后不再问，可以在面板里关掉。可以吗？`) : false;
      if (!yes) return { ok: false, why: '你没同意我看屏幕' };
      try { localStorage.setItem(OK_KEY, '1'); } catch (_) { /* 无所谓 */ }
    }
    let shot;
    try { shot = await capture(S); }
    catch (e) { const m = String(e); return { ok: false, why: m.includes('__PRIVATE__') ? '前台是隐私应用，我没看' : '截图没成功：' + m }; }
    const q = String(question || '').trim();
    const messages = [{ role: 'user', content: [
      { type: 'text', text: PROMPT + (q ? `\n用户想知道：${q.slice(0, 200)}` : '') },
      { type: 'image_url', image_url: { url: shot.image } },
    ] }];
    try {
      const text = (await XH.chat.ask(vcfg(S), messages, 400)).replace(/\s+/g, ' ').trim();
      if (!text) return { ok: false, why: '视觉模型没说话…' };
      return { ok: true, text: text.slice(0, 400), proc: shot.proc };
    } catch (e) {
      return { ok: false, why: '视觉模型出错了：' + String((e && e.message) || e) };
    }
  }

  XH.DEF_VISION = DEF_VISION;
  XH.vision = { VP, DEF: DEF_VISION, vcfg, canLook, look, capture, consented, resetConsent: () => { try { localStorage.removeItem(OK_KEY); } catch (_) { /* 无所谓 */ } } };
})();

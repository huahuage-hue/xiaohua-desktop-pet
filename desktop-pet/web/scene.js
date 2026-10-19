/* 小嬅桌宠 · 桌面场景感知（v0.5.0，方案 B）
   - Rust 每 2 秒读一次前台窗口的进程名 / 标题 / 是否全屏，变化时发 pet://scene
   - 本文件把窗口归类成 coding / video / game / meeting / office / browser / private
   - 标题只在本地参与分类；默认不写盘、不发模型。开启「把窗口标题也告诉她」才会带进提示词
   - quiet()：会议 / 游戏 / 隐私应用 / 全屏时不要主动搭话；hint() 给对话一句场景说明 */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});
  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : null;

  const DEF_SCENE = { sceneOn: true, sceneTitle: false, quietFull: true, hideFull: false, sceneBlock: '' };

  const PROC = {
    coding: ['code.exe', 'code - insiders.exe', 'cursor.exe', 'devenv.exe', 'idea64.exe', 'pycharm64.exe', 'webstorm64.exe', 'goland64.exe', 'clion64.exe', 'rider64.exe', 'sublime_text.exe', 'notepad++.exe', 'windowsterminal.exe', 'wt.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'vim.exe', 'nvim.exe', 'android studio.exe'],
    meeting: ['zoom.exe', 'teams.exe', 'ms-teams.exe', 'wemeetapp.exe', 'wemeet.exe', 'dingtalk.exe', 'feishu.exe', 'lark.exe', 'discord.exe', 'skype.exe', 'voov.exe'],
    video: ['potplayer.exe', 'potplayermini64.exe', 'vlc.exe', 'mpv.exe', 'mpc-hc64.exe', 'bilibili.exe', 'iqiyi.exe', 'youku.exe', 'netflix.exe'],
    game: ['steam.exe', 'epicgameslauncher.exe', 'battle.net.exe', 'wegame.exe', 'genshinimpact.exe', 'yuanshen.exe', 'leagueclient.exe', 'starrail.exe'],
    office: ['winword.exe', 'excel.exe', 'powerpnt.exe', 'wps.exe', 'et.exe', 'wpp.exe', 'acrobat.exe', 'acrord32.exe', 'notion.exe', 'obsidian.exe'],
    browser: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', '360se.exe', '360chrome.exe', 'qqbrowser.exe', 'sogouexplorer.exe'],
    private: ['1password.exe', 'keepass.exe', 'keepassxc.exe', 'bitwarden.exe', 'lastpass.exe', 'dashlane.exe', 'enpass.exe', 'authenticator.exe', 'wechat.exe', 'weixin.exe', 'qq.exe', 'telegram.exe'],
  };
  const TITLE = {
    video: ['youtube', 'bilibili', '哔哩哔哩', 'netflix', '爱奇艺', '腾讯视频', '优酷', '播放器', '视频'],
    meeting: ['腾讯会议', '视频会议', 'meeting', 'zoom', 'teams', '飞书会议', '钉钉会议'],
    game: ['原神', '崩坏', '英雄联盟', 'steam', '游戏'],
    private: ['银行', '网银', '密码', '支付', '账单', '无痕', '隐私', 'incognito', 'private browsing'],
  };
  const NAME = { coding: '写代码', video: '看视频', game: '玩游戏', meeting: '开会', office: '处理文档', browser: '浏览网页', private: '用隐私应用', other: '忙别的事', self: '和小嬅玩' };

  const st = { proc: '', title: '', cls: 'other', full: false, blocked: false, at: 0 };
  let S = { ...DEF_SCENE }, getS = null, started = false, onCh = null;

  const low = (s) => String(s || '').toLowerCase();
  const inList = (p, list) => (list || []).some((x) => p === x || p.includes(x));
  const has = (t, list) => (list || []).some((x) => t.includes(x));
  const blocked = (proc) => {
    const list = String((S && S.sceneBlock) || '').split(/[,，、\s]+/).map(low).filter(Boolean);
    return list.some((x) => low(proc).includes(x));
  };

  function classify(proc, title) {
    const p = low(proc), t = low(title);
    if (!p) return 'other';
    if (p.includes('xiaohua-pet')) return 'self';
    if (inList(p, PROC.private) || has(t, TITLE.private)) return 'private';
    let cls = null;
    for (const k of ['coding', 'meeting', 'video', 'game', 'office', 'browser']) {
      if (inList(p, PROC[k])) { cls = k; break; }
    }
    if (cls === 'browser') {
      if (has(t, TITLE.video)) return 'video';
      if (has(t, TITLE.meeting)) return 'meeting';
      if (has(t, TITLE.game)) return 'game';
    }
    if (!cls) {
      if (has(t, TITLE.meeting)) return 'meeting';
      if (has(t, TITLE.video)) return 'video';
      if (has(t, TITLE.game)) return 'game';
      return 'other';
    }
    return cls;
  }

  function apply(p) {
    if (!p || typeof p !== 'object') return;
    st.proc = String(p.proc || '');
    st.title = String(p.title || '').slice(0, 160);
    st.full = !!p.full;
    st.cls = classify(st.proc, st.title);
    st.blocked = blocked(st.proc);
    st.at = Date.now();
    if (onCh) { try { onCh(api); } catch (_) { /* 界面出错不影响感知 */ } }
  }

  /* 标题脱敏：去掉网址、邮箱、长数字，只留一小段 */
  function safeTitle(t) {
    return String(t || '').replace(/https?:\/\/\S+/gi, ' ').replace(/[\w.+-]+@[\w.-]+/g, ' ').replace(/\d{6,}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
  }

  const label = () => NAME[st.cls] || NAME.other;
  const enabled = () => !!(S && S.sceneOn);
  const quiet = () => {
    if (!enabled() || !st.proc || st.cls === 'self') return false;
    if (st.blocked || st.cls === 'private' || st.cls === 'meeting' || st.cls === 'game') return true;
    return !!(st.full && S.quietFull !== false);
  };
  function hint() {
    if (!enabled() || !st.proc || st.cls === 'self') return '';
    if (st.blocked || st.cls === 'private') return '用户现在在忙，不要主动打扰。';
    let s = `用户现在似乎在${label()}`;
    if (S.sceneTitle && st.title) { const t = safeTitle(st.title); if (t) s += `（前台窗口标题：“${t}”）`; }
    s += '。';
    if (quiet()) s += '如果用户没有主动说话，不要打扰。';
    return s;
  }
  function explain(evt, cfg) {
    const s = cfg || S;
    if (!s || !s.sceneOn) return '已关闭';
    if (!evt || !evt.proc) return '还没读到前台窗口';
    const p = low(evt.proc), t = low(evt.title || '');
    const cls = classify(evt.proc, evt.title);
    const isBlocked = (String(s.sceneBlock || '').split(/[,，、\s]+/).map(low).filter(Boolean)).some((x) => p.includes(x));
    if (cls === 'self') return '正在和小嬅互动';
    if (isBlocked || cls === 'private') return `隐私应用，保持安静（${evt.proc}）`;
    let out = `正在${NAME[cls] || NAME.other}`;
    if (evt.proc) out += ` · ${evt.proc}`;
    if (evt.full && s.quietFull !== false) out += ' · 全屏安静中';
    return out;
  }

  const api = { DEF: DEF_SCENE, state: st, classify, label, quiet, hint, explain, safeTitle };
  XH.DEF_SCENE = DEF_SCENE;
  XH.scene = {
    ...api,
    get settings() { return S; },
    start(get) {
      if (started) return;
      started = true;
      getS = get;
      if (getS) { const v = getS(); if (v) S = v; }
      if (T) T.event.listen('pet://scene', (e) => apply(e.payload));
      if (invoke) invoke('scene_watch', { on: enabled() }).catch(() => {});
    },
    set(cfg) {
      if (!cfg) return;
      const was = enabled();
      S = cfg;
      if (invoke && was !== enabled()) invoke('scene_watch', { on: enabled() }).catch(() => {});
      if (!enabled()) { st.proc = ''; st.title = ''; st.cls = 'other'; st.full = false; st.blocked = false; if (onCh) onCh(api); }
      else if (getS && !was) { /* 重新开启时等下一帧事件 */ }
    },
    onChange(fn) { onCh = fn; },
    /* 面板调试：主动读一次（会读到面板自己，仅供测试） */
    now: () => (invoke ? invoke('scene_now').then((r) => { apply(r); return r; }).catch(() => null) : Promise.resolve(null)),
  };
})();

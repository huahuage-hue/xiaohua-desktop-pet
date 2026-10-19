/* 小嬅桌宠 · 记忆 v2（v0.5.0）
   - 结构：profile（称呼 / 生日 / 城市 / 工作 / 喜欢 / 不喜欢 / 忌口）+ facts / events / promises
   - 只存在本机 localStorage；旧的单段摘要（xh-memory）第一次读取时自动迁移
   - 去重合并、置顶权重、按话题取相关条目；敏感信息由抽取提示词和用户「忘掉…」共同约束
   - v0.7.0：diary 每日小结 [{date, text}]（最多 60 天）；事件可带 when（事情发生的日子），到日子后回访一次（askedAt） */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});
  const KEY = 'xh-memory-v2', OLD = 'xh-memory';
  const LIM = { facts: 50, events: 30, promises: 20 };
  const PROFILE = ['name', 'birthday', 'city', 'job', 'likes', 'dislikes', 'taboos'];

  const now = () => Date.now();
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const day = (t) => { const d = t ? new Date(t) : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  function blank() {
    return { v: 2, profile: { name: '', birthday: '', city: '', job: '', likes: [], dislikes: [], taboos: [] }, facts: [], events: [], promises: [], diary: [], forgotten: [], updatedAt: 0 };
  }
  function norm(m) {
    const b = blank();
    if (!m || typeof m !== 'object') return b;
    const out = { ...b, ...m, profile: { ...b.profile, ...(m.profile || {}) }, v: 2 };
    const arr = (v) => Array.isArray(v) ? v : [];
    out.facts = arr(m.facts); out.events = arr(m.events); out.promises = arr(m.promises);
    out.diary = arr(m.diary).filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date)).map((x) => ({ date: x.date, text: clean(x.text).slice(0, 120) }));
    out.forgotten = arr(m.forgotten).map(clean).filter(Boolean).slice(-30);
    for (const k of ['likes', 'dislikes', 'taboos']) if (!Array.isArray(out.profile[k])) out.profile[k] = clean(out.profile[k]) ? clean(out.profile[k]).split(/[、,，]/).map(clean).filter(Boolean) : [];
    for (const k of ['name', 'birthday', 'city', 'job']) out.profile[k] = clean(out.profile[k]);
    return out;
  }

  /* 旧版一段式摘要 → 事实条目（按句号 / 分号切开，最多 12 条） */
  function migrate() {
    const m = blank();
    let text = '';
    try { const o = JSON.parse(localStorage.getItem(OLD) || '{}'); text = clean(o && o.text); } catch (_) { /* 旧数据坏了就当没有 */ }
    if (text) {
      text.split(/[。；;]/).map(clean).filter((s) => s.length > 1).slice(0, 12).forEach((s) => {
        m.facts.push({ id: uid(), text: s.slice(0, 120), tags: [], w: 1, created: now(), lastUsed: now() });
      });
      m.updatedAt = now();
      save(m);
      try { localStorage.removeItem(OLD); } catch (_) { /* 无所谓 */ }
    }
    return m;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return norm(JSON.parse(raw));
    } catch (_) { /* 坏了就重建 */ }
    return migrate();
  }
  function save(m) {
    m = norm(m);
    for (const k of Object.keys(LIM)) {
      m[k] = m[k].filter((x) => x && clean(x.text)).sort((a, b) => (b.w || 1) - (a.w || 1) || (b.created || 0) - (a.created || 0)).slice(0, LIM[k]);
    }
    /* 小结按日期排、同一天只留一条、最多 60 天 */
    const byDay = new Map();
    m.diary.forEach((x) => byDay.set(x.date, x));
    m.diary = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-60);
    m.updatedAt = now();
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (_) { /* 满了就算了 */ }
    return m;
  }
  function clear() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(OLD); } catch (_) { /* 无所谓 */ }
  }

  /* 轻量相似：完全相同，或一方包含另一方且较长（避免“喜欢咖啡”和“喜欢咖啡和雨”并存） */
  function same(a, b) {
    a = clean(a).toLowerCase(); b = clean(b).toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    return (a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 6;
  }
  function blockedByForgotten(m, text) {
    const t = clean(text).toLowerCase();
    return (m.forgotten || []).some((f) => f && t.includes(f));
  }
  function addItem(list, text, opt) {
    text = clean(text).replace(/^[-*·]\s*/, '').slice(0, 140);
    if (!text) return false;
    const hit = list.find((x) => same(x.text, text));
    if (hit) {
      hit.w = Math.min(20, (hit.w || 1) + 1);
      hit.lastUsed = now();
      if (opt && opt.when && hit.when !== opt.when) { hit.when = opt.when; delete hit.askedAt; } // 改期了就重新等着回访
      if (opt && opt.tags) hit.tags = [...new Set([...(hit.tags || []), ...opt.tags])].slice(0, 6);
      return false;
    }
    const it = { id: uid(), text, tags: (opt && opt.tags || []).slice(0, 6), w: 1, created: now(), lastUsed: now() };
    if (opt && opt.date) it.date = opt.date;
    if (opt && opt.when) it.when = opt.when;
    if (opt && opt.kind === 'promises') it.done = false;
    list.push(it);
    return true;
  }

  function apply(out) {
    if (!out || typeof out !== 'object') return 0;
    const m = load();
    let n = 0;
    if (out.profile && typeof out.profile === 'object') {
      for (const k of PROFILE) {
        const v = out.profile[k];
        if (v == null) continue;
        if (k === 'likes' || k === 'dislikes' || k === 'taboos') {
          const a = Array.isArray(v) ? v : clean(v).split(/[、,，]/);
          const merged = [...new Set([...(m.profile[k] || []), ...a.map(clean).filter((x) => x && !blockedByForgotten(m, x))])].slice(0, 12);
          if (merged.length !== (m.profile[k] || []).length) n++;
          m.profile[k] = merged;
        } else {
          const s = clean(v).slice(0, 60);
          if (s && !blockedByForgotten(m, s) && s !== m.profile[k]) { m.profile[k] = s; n++; }
        }
      }
    }
    (Array.isArray(out.facts) ? out.facts : []).forEach((t) => { if (blockedByForgotten(m, t)) return; if (addItem(m.facts, t)) n++; });
    /* 事件：字符串，或 {text, when:"YYYY-MM-DD"}（v0.7.0） */
    (Array.isArray(out.events) ? out.events : []).forEach((e) => {
      const t = e && typeof e === 'object' ? e.text : e;
      const when = e && typeof e === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(e.when || '')) ? e.when : '';
      if (!clean(t) || blockedByForgotten(m, t)) return;
      if (addItem(m.events, t, { date: day(), when })) n++;
    });
    (Array.isArray(out.promises) ? out.promises : []).forEach((t) => { if (blockedByForgotten(m, t)) return; if (addItem(m.promises, t, { kind: 'promises' })) n++; });
    if (n) save(m);
    return n;
  }

  /* 话题相关度：中文按双字切，英文按词；再加权重与新鲜度 */
  function grams(s) {
    s = clean(s).toLowerCase();
    const out = new Set();
    const cn = s.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i < cn.length - 1; i++) out.add(cn.slice(i, i + 2));
    (s.match(/[a-z0-9]{2,}/g) || []).forEach((w) => out.add(w));
    return out;
  }
  function score(it, q) {
    const t = clean(it.text).toLowerCase();
    let s = (it.w || 1) * 0.6;
    if (q) {
      const g = grams(q);
      let hit = 0;
      g.forEach((x) => { if (t.includes(x)) hit++; });
      s += hit * 2.5;
    }
    const age = (now() - (it.lastUsed || it.created || now())) / 86400000;
    s += Math.max(0, 3 - age * 0.08);
    return s;
  }
  function top(list, q, n) {
    return [...list].sort((a, b) => score(b, q) - score(a, q)).slice(0, n);
  }

  function digest(q) {
    const m = load(), p = m.profile, parts = [];
    const prof = [];
    if (p.name) prof.push('称呼：' + p.name);
    if (p.birthday) prof.push('生日：' + p.birthday);
    if (p.city) prof.push('城市：' + p.city);
    if (p.job) prof.push('工作/学习：' + p.job);
    if (p.likes && p.likes.length) prof.push('喜欢：' + p.likes.join('、'));
    if (p.dislikes && p.dislikes.length) prof.push('不喜欢：' + p.dislikes.join('、'));
    if (p.taboos && p.taboos.length) prof.push('忌口/忌讳：' + p.taboos.join('、'));
    if (prof.length) parts.push('用户档案：' + prof.join('；'));
    const facts = top(m.facts, q, 8);
    if (facts.length) parts.push('记得的事：' + facts.map((x) => x.text).join('；'));
    const ev = m.events.filter((x) => !x.date || now() - new Date(x.date + 'T12:00:00').getTime() < 90 * 86400000).slice(-3);
    if (ev.length) parts.push('最近发生 / 将要发生的事：' + ev.map((x) => x.text + (x.when ? `（${x.when.slice(5)}）` : '')).join('；'));
    const pr = m.promises.filter((x) => !x.done).slice(-3);
    if (pr.length) parts.push('还没兑现的约定：' + pr.map((x) => x.text).join('；'));
    /* 聊天日记：最近 3 天 + 更早里和当前话题最相关的 1 天 */
    const dia = m.diary.filter((x) => x.text);
    const recent = dia.slice(-3);
    const older = q ? dia.slice(0, -3).map((x) => ({ x, s: score({ text: x.text, w: 0, lastUsed: 0, created: 0 }, q) })).filter((o) => o.s >= 5).sort((a, b) => b.s - a.s).slice(0, 1).map((o) => o.x) : [];
    const ds = [...older, ...recent];
    if (ds.length) parts.push('前几天聊过：' + ds.map((x) => `${+x.date.slice(5, 7)}月${+x.date.slice(8)}日 ${x.text}`).join('；'));
    let s = parts.join('\n');
    if (s.length > 1100) s = s.slice(0, 1100);
    return s;
  }

  function forget(kw) {
    const m = load(), k = clean(kw).toLowerCase();
    if (!k || /^(所有|全部|一切|都)/.test(k)) {
      const n = m.facts.length + m.events.length + m.promises.length;
      m.facts = []; m.events = []; m.promises = []; m.diary = []; m.forgotten = [];
      for (const key of PROFILE) m.profile[key] = Array.isArray(m.profile[key]) ? [] : '';
      save(m);
      return n;
    }
    let n = 0;
    m.forgotten = [...new Set([...(m.forgotten || []), k])].slice(-30);
    for (const key of ['facts', 'events', 'promises']) {
      const keep = [];
      for (const it of m[key]) {
        if (clean(it.text).toLowerCase().includes(k)) n++; else keep.push(it);
      }
      m[key] = keep;
    }
    const dk = m.diary.filter((x) => !clean(x.text).toLowerCase().includes(k));
    n += m.diary.length - dk.length; m.diary = dk;
    for (const key of ['likes', 'dislikes', 'taboos']) {
      const keep = (m.profile[key] || []).filter((x) => !clean(x).toLowerCase().includes(k));
      if (keep.length !== (m.profile[key] || []).length) n++;
      m.profile[key] = keep;
    }
    for (const key of ['name', 'birthday', 'city', 'job']) {
      if (m.profile[key] && clean(m.profile[key]).toLowerCase().includes(k)) { m.profile[key] = ''; n++; }
    }
    save(m);
    return n;
  }

  function remove(kind, id) {
    const m = load();
    if (!Array.isArray(m[kind])) return;
    m[kind] = m[kind].filter((x) => x.id !== id);
    save(m);
  }
  function update(kind, id, text) {
    const m = load(), it = (m[kind] || []).find((x) => x.id === id);
    if (!it) return;
    it.text = clean(text).slice(0, 140) || it.text;
    it.lastUsed = now();
    save(m);
  }
  function pin(kind, id) {
    const m = load(), it = (m[kind] || []).find((x) => x.id === id);
    if (!it) return;
    it.w = Math.min(30, (it.w || 1) + 6);
    it.lastUsed = now();
    save(m);
  }
  function toggle(kind, id) {
    const m = load(), it = (m[kind] || []).find((x) => x.id === id);
    if (!it) return;
    it.done = !it.done;
    save(m);
  }

  function importData(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const m = norm(obj.memory && typeof obj.memory === 'object' ? obj.memory : obj);
    save(m);
    return true;
  }
  function exportData() { return { v: 2, exportedAt: now(), memory: load() }; }

  XH.memory = {
    KEY, load, save, clear, digest, apply, forget, remove, update, pin, toggle, importData, exportData,
    add: (kind, text) => { const m = load(); const ok = addItem(m[kind], text, { kind }); save(m); return ok; },
    stats: () => { const m = load(); return { facts: m.facts.length, events: m.events.length, promises: m.promises.length, diary: m.diary.filter((x) => x.text).length, profile: PROFILE.filter((k) => (Array.isArray(m.profile[k]) ? m.profile[k].length : m.profile[k])).length }; },
    profile: () => load().profile,
    /* ---------- v0.7.0 ---------- */
    diaryDates: () => load().diary.map((x) => x.date),
    addDiary(date, text) { const m = load(); m.diary = m.diary.filter((x) => x.date !== date); m.diary.push({ date, text: clean(text).slice(0, 120) }); save(m); },
    removeDiary(date) { const m = load(); m.diary = m.diary.filter((x) => x.date !== date); m.diary.push({ date, text: '' }); save(m); }, // 留空占位：不再自动重写这一天
    recentDiary: (n) => load().diary.filter((x) => x.text).slice(-(n || 3)),
    /* 该回访的事件：日子到了（含当天晚些时候）、7 天内、还没问过；越近越先 */
    followups() {
      const today = day(), m = load();
      return m.events.filter((x) => x.when && x.when <= today && !x.askedAt && now() - new Date(x.when + 'T23:59:59').getTime() < 7 * 86400000)
        .sort((a, b) => (a.when < b.when ? 1 : -1));
    },
    markAsked(id) { const m = load(), it = m.events.find((x) => x.id === id); if (it) { it.askedAt = now(); save(m); } },
  };
})();

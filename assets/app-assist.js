/* 小嬅小助手（v0.2.0）：整点报时 / 天气播报 / 点头问时间天气 / 喝水休息提醒 / 深夜劝睡。每项可单独开关。
   天气：Open-Meteo（免费、无需密钥）。断网静默跳过，不报错、不出声。
   用法：XH.assist.start(P, getSettings, saveSettings)；P = XH.pet。设置字段见 DEF_ASSIST。 */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});

  XH.DEF_ASSIST = {
    chime: true, quietFrom: 23, quietTo: 7,           // 整点报时 + 免打扰（小时，跨午夜）
    weather: false, city: null,                        // city: {name, lat, lon, admin}
    askTap: true,                                      // 点头时偶尔顺口报时间 / 天气
    remind: false, remindMin: 45,                      // 喝水 / 休息提醒
    bedtime: true,                                     // 深夜劝睡
  };

  const pick = (a) => a[(Math.random() * a.length) | 0];
  const pad = (n) => String(n).padStart(2, '0');
  const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const h12 = (h) => CN[h % 12 === 0 ? 12 : h % 12];
  const period = (h) => (h < 5 ? '凌晨' : h < 8 ? '早上' : h < 11 ? '上午' : h < 13 ? '中午' : h < 18 ? '下午' : h < 20 ? '傍晚' : '晚上');
  const inQuiet = (h, S) => { const a = S.quietFrom, b = S.quietTo; if (a == null || b == null || a === b) return false; return a < b ? h >= a && h < b : h >= a || h < b; };

  /* ---------- 台词 ---------- */
  function chimeLine(d) {
    const h = d.getHours(), t = `${period(h)}${h12(h)}点啦`;
    if (h === 7 || h === 8) return pick([`${t}～早上好呀`, `${t}，今天也要元气满满哦`]);
    if (h === 12) return pick([`${t}，该吃午饭啦`, `${t}～午饭吃什么呢`]);
    if (h === 15) return pick([`${t}，起来伸个懒腰吧`, `${t}～下午茶时间！`]);
    if (h === 18) return pick([`${t}，辛苦啦`, `${t}～天快黑了呢`]);
    if (h >= 22 || h < 5) return pick([`${t}…要早点休息哦`, `${t}，星星都出来了`]);
    return pick([`${t}～`, `${t}，喝口水吧`, `叮——${t}`]);
  }
  const DESC = (c) => (c === 0 ? '晴' : c <= 2 ? '晴转多云' : c === 3 ? '阴' : c <= 48 ? '有雾' : c <= 57 ? '毛毛雨' : c <= 67 ? '下雨' : c <= 77 ? '下雪' : c <= 82 ? '阵雨' : c <= 86 ? '阵雪' : '雷雨');
  const isRain = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
  function weatherLine(w, city) {
    const c = w.code, tip = w.rainSoon ? '，等会儿要下雨，记得带伞哦' : w.max >= 33 ? '，好热呀，多喝水' : w.min <= 3 ? '，好冷，要穿厚一点' : w.drop >= 5 ? '，明天要降温，记得加衣服' : '';
    return `${city}现在${DESC(c)}${tip}\n今天 ${Math.round(w.min)}° ~ ${Math.round(w.max)}°`;
  }

  /* ---------- 天气 ---------- */
  const W = { data: null, at: 0, loading: null };
  async function fetchWeather(city) {
    if (!city) return null;
    if (W.data && W.key === city.lat + ',' + city.lon && Date.now() - W.at < 30 * 60e3) return W.data;
    if (W.loading) return W.loading;
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code&hourly=weather_code,precipitation_probability&daily=temperature_2m_max,temperature_2m_min&forecast_days=2&timezone=auto`;
    W.loading = (async () => {
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(u, { signal: ctl.signal }); clearTimeout(to);
        if (!r.ok) return null;
        const j = await r.json();
        const now = Date.now(), hs = j.hourly.time.map((t) => new Date(t).getTime());
        let i0 = hs.findIndex((t) => t > now - 3600e3); if (i0 < 0) i0 = 0;
        /* 未来 3 小时内降水概率 ≥ 60% 或天气码是雨 → 提醒带伞 */
        let rainSoon = false;
        for (let i = i0; i < Math.min(i0 + 4, hs.length); i++) if (j.hourly.precipitation_probability[i] >= 60 || isRain(j.hourly.weather_code[i])) rainSoon = true;
        if (isRain(j.current.weather_code)) rainSoon = false; // 已经在下了，就不说“等会儿”
        /* drop：今天最高 − 明天最高，≥ 5° 提醒降温 */
        const d = { temp: j.current.temperature_2m, code: j.current.weather_code, max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0], drop: j.daily.temperature_2m_max[0] - j.daily.temperature_2m_max[1], rainSoon };
        W.data = d; W.at = Date.now(); W.key = city.lat + ',' + city.lon;
        return d;
      } catch (_) { return null; } finally { W.loading = null; }
    })();
    return W.loading;
  }
  /* 城市搜索（面板用）：Open-Meteo geocoding，中文 */
  XH.searchCity = async function (q) {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`);
      const j = await r.json();
      return (j.results || []).map((c) => ({ name: c.name, lat: +c.latitude.toFixed(3), lon: +c.longitude.toFixed(3), admin: [c.admin1, c.country].filter(Boolean).join(' · ') }));
    } catch (_) { return null; }
  };
  XH.fetchWeather = fetchWeather;

  /* ---------- 调度 ---------- */
  const A = { P: null, get: null, save: null, lastHour: -1, lastWeather: 0, remindAt: 0, idleSince: 0, lastInput: 0, bedDay: '', timer: 0, started: false };

  function canSpeak() {
    const P = A.P;
    if (!P || P.sleeping() || P.busy()) return false;
    const B = XH.bubble; if (B && B.busy && B.busy()) return false; // 正在聊天
    return true;
  }
  /* 说话：排队等她空下来（最多等 20 秒） */
  function speak(text, opt, motion, tries = 0) {
    if (!canSpeak()) { if (tries < 20) setTimeout(() => speak(text, opt, motion, tries + 1), 1000); return; }
    A.P.say(text, opt, motion);
  }

  async function sayWeather(manual) {
    const S = A.get();
    if (!S.city) { if (manual) speak('还不知道你在哪个城市呢…\n在控制面板「小助手」里选一下吧', { type: 'say' }, 'tilt'); return; }
    const w = await fetchWeather(S.city);
    if (!w) { if (manual) speak('天气没查到…网络好像不太好', { type: 'say' }, 'think'); return; }
    speak(weatherLine(w, S.city.name), { type: 'weather', code: w.code, temp: w.temp }, w.rainSoon || w.min <= 3 ? 'tilt' : 'nod');
    A.lastWeather = Date.now();
  }
  function sayTime() {
    const d = new Date();
    speak(`现在是${period(d.getHours())}${h12(d.getHours())}点${d.getMinutes() ? (d.getMinutes() < 10 ? '零' : '') + d.getMinutes() + '分' : '整'}\n${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`, { type: 'time', date: d }, 'nod');
  }

  function tick() {
    const S = A.get(), now = new Date(), h = now.getHours(), m = now.getMinutes();
    /* 整点报时：每小时第 0 分钟一次 */
    if (S.chime && m === 0 && A.lastHour !== h) {
      A.lastHour = h;
      if (!inQuiet(h, S)) speak(chimeLine(now), { type: 'time', date: now }, h >= 22 || h < 5 ? 'yawn' : 'nod');
    }
    if (m !== 0) A.lastHour = -1;
    /* 天气：启动后第一次、之后每 3 小时 */
    if (S.weather && S.city && Date.now() - A.lastWeather > 3 * 3600e3 && !inQuiet(h, S)) { A.lastWeather = Date.now(); sayWeather(false); }
    /* 喝水 / 休息：只在有人用电脑时计时（闲置 5 分钟重置） */
    const idle = Date.now() - A.lastInput;
    if (idle > 5 * 60e3) A.remindAt = 0;
    else if (S.remind) {
      if (!A.remindAt) A.remindAt = Date.now() + S.remindMin * 60e3;
      else if (Date.now() > A.remindAt) {
        A.remindAt = Date.now() + S.remindMin * 60e3;
        speak(pick([`已经${S.remindMin}分钟啦，喝口水吧～`, '起来活动一下吧，眼睛也休息一下', `坐了${S.remindMin}分钟了哦，伸个懒腰！`, '喝水时间到～我也要喝']), { type: 'say' }, 'wave');
      }
    } else A.remindAt = 0;
  }
  /* 深夜劝睡：0–5 点第一次有操作时，每晚一次 */
  function onInput() {
    A.lastInput = Date.now();
    if (!A.started) return;
    const S = A.get(), d = new Date(), h = d.getHours();
    if (!S.bedtime || h >= 5) return;
    const day = d.toDateString();
    if (A.bedDay === day) return;
    A.bedDay = day;
    setTimeout(() => speak(pick(['这么晚了还不睡吗…\n该睡觉啦', '哈啊…好困。你也早点睡吧', '已经过零点了哦，快去睡觉！']), { type: 'say' }, 'yawn'), 1500);
  }

  let lastIn = 0;
  const throttled = () => { const t = Date.now(); if (t - lastIn < 1000) return; lastIn = t; onInput(); };

  XH.assist = {
    start(P, get, save) {
      if (A.started) return;
      A.started = true; A.P = P; A.get = () => ({ ...XH.DEF_ASSIST, ...(get() || {}) }); A.save = save;
      A.lastWeather = 0; A.lastInput = Date.now();
      A.timer = setInterval(tick, 15000);
      setTimeout(tick, 4000);
      let last = 0;
      const prevHit = P.onHit;
      /* 点头：25% 概率顺口报时间或天气（不影响原来的摸头反应：先播摸头，过一会儿再说） */
      P.onHit = (hit) => {
        if (prevHit && prevHit(hit)) return true;
        const S = A.get();
        if (hit === 'tapHead' && S.askTap && Date.now() - last > 20000 && Math.random() < 0.25) {
          last = Date.now();
          setTimeout(() => (S.city && Math.random() < 0.5 ? sayWeather(true) : sayTime()), 1700);
        }
        return false;
      };
      ['pointerdown', 'pointermove', 'keydown'].forEach((e) => window.addEventListener(e, throttled, { capture: true, passive: true }));
    },
    /* 桌宠：窗口多数时间点击穿透收不到事件，由 pet.js 在全局光标移动时调用 */
    input: () => throttled(),
    /* 设置变化：提醒间隔改了就重新计时；新选城市马上播一次 */
    changed(prev) {
      const S = A.get();
      if (!prev || prev.remindMin !== S.remindMin || prev.remind !== S.remind) A.remindAt = 0;
      if (S.weather && S.city && (!prev || !prev.weather || !prev.city || prev.city.name !== S.city.name)) { A.lastWeather = Date.now(); sayWeather(true); }
    },
    sayTime, sayWeather, chimeLine, weatherLine, inQuiet,
    /* 调试：模拟某个时刻的报时 */
    testChime(h) { const d = new Date(); d.setHours(h, 0, 0, 0); A.P.say(chimeLine(d), { type: 'time', date: d }, 'nod'); },
    state: A,
  };
})();

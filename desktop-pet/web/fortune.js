/* 小嬅桌宠 · 每日运势（v0.7.0，纯娱乐）
   - 本地按「日期 + 称呼」做种子生成，同一天查几次结果都一样，不联网
   - 总运势（大吉 / 中吉 / 吉 / 末吉 / 小凶，偏向好的）+ 学业 / 人际 / 财运 / 健康星级、幸运色、幸运数字、幸运物、宜 / 忌、今日小语
   - 开了对话时由她用自己的语气讲（chat.narrate），没开就念模板 */
(function () {
  'use strict';
  const XH = (window.XH = window.XH || {});

  const LEVELS = [ // [名字, 总星级, 权重]
    ['大吉', 5, 15], ['中吉', 4, 30], ['吉', 4, 28], ['末吉', 3, 19], ['小凶', 2, 8],
  ];
  const COLORS = [['奶油白', '#F3EBD8'], ['焦糖棕', '#B98A5E'], ['樱花粉', '#F4B6C2'], ['薄荷绿', '#9ED9C2'], ['天空蓝', '#9CC9EE'], ['柠檬黄', '#F2D86A'],
    ['薰衣草紫', '#C3B1E1'], ['珊瑚橙', '#F59E7D'], ['墨黑', '#3B342D'], ['云朵灰', '#C9CED6'], ['桦叶绿', '#8DB580'], ['莓果红', '#C4505E']];
  const ITEMS = ['蝴蝶结发夹', '一支好写的笔', '热可可', '小云朵贴纸', '耳机', '新笔记本', '折叠伞', '保温杯', '校园卡', '一颗糖', '便利贴', '帆布包'];
  const YI = ['去图书馆自习', '早点交作业', '整理笔记', '去操场跑两圈', '和朋友约饭', '早睡早起', '复习错题', '给家里打个电话', '去食堂吃顿好的', '背单词',
    '下课问老师问题', '出门晒太阳', '收拾书桌', '提前规划这周', '奖励自己一杯奶茶', '去听一场讲座', '把 DDL 拆成小块', '出门走走吹吹风'];
  const JI = ['熬夜', '拖 DDL', '翘课', '空腹喝咖啡', '一直刷手机', '临时抱佛脚', '和人抬杠', '冲动消费', '忘带校园卡', '久坐不动', '点太多外卖', '把作业留到最后一晚',
    '上课睡觉', '在宿舍躺一整天'];
  const LINES = {
    大吉: ['今天做什么都很顺，想做的事就去做吧！', '好运满格，记得把好心情分我一点～', '今天的你闪闪发光哦。'],
    中吉: ['稳稳的一天，按计划来就会有好结果。', '小小的努力今天都会被看见～', '适合把拖了很久的事做掉！'],
    吉: ['平平淡淡也很好，照顾好自己就是最大的好运。', '慢慢来，比较快。', '今天适合踏实做一件小事。'],
    末吉: ['运气在后半天才会上来，别急～', '有点小波折也没关系，我陪着你。', '先把最重要的一件事做完，其他的放一放。'],
    小凶: ['今天低调一点、细心一点就好，没什么大不了的。', '运势只是参考啦，你本人比运势厉害多了！', '多喝水、早点睡，明天会更好。'],
  };

  /* 小而稳定的伪随机：字符串 → 32 位种子 → mulberry32 */
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const pickN = (r, a, n, ban) => { const pool = a.filter((x) => !(ban || []).includes(x)), out = []; while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]); return out; };
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  /* 今天（或指定日期）的运势：who = 称呼，用来让不同人结果不同 */
  function today(S, date) {
    const d = date || new Date();
    const who = (S && S.nickname) || (XH.memory && XH.memory.profile && XH.memory.profile().name) || '你';
    const r = rng(hash(ymd(d) + '|' + who + '|xiaohua'));
    let roll = r() * LEVELS.reduce((s, l) => s + l[2], 0), lv = LEVELS[0];
    for (const l of LEVELS) { if ((roll -= l[2]) < 0) { lv = l; break; } }
    const sub = () => Math.max(1, Math.min(5, lv[1] + Math.round(r() * 2 - 1)));
    const yi = pickN(r, YI, 2), ji = pickN(r, JI, 2);
    const color = pick(r, COLORS);
    return {
      date: ymd(d), who, level: lv[0], total: lv[1],
      study: sub(), social: sub(), money: sub(), health: sub(),
      color: { name: color[0], hex: color[1] }, number: 1 + Math.floor(r() * 99), item: pick(r, ITEMS),
      yi, ji, line: pick(r, LINES[lv[0]]),
    };
  }

  /* 模板文字（没开对话时她就这么念；气泡里换行显示） */
  function text(f) {
    return `今日运势：${f.level} ${stars(f.total)}\n学业${stars(f.study)} 人际${stars(f.social)}\n幸运色 ${f.color.name} · 幸运数字 ${f.number} · 幸运物 ${f.item}\n宜：${f.yi.join('、')}　忌：${f.ji.join('、')}\n${f.line}（仅供娱乐哦）`;
  }
  /* 给模型的数据（工具结果 / 让她讲的时候用） */
  function data(f) {
    return `今日运势（${f.date}，${f.who}）：总运势 ${f.level}（${f.total}/5），学业 ${f.study}/5，人际 ${f.social}/5，财运 ${f.money}/5，健康 ${f.health}/5；` +
      `幸运色 ${f.color.name}，幸运数字 ${f.number}，幸运物 ${f.item}；宜：${f.yi.join('、')}；忌：${f.ji.join('、')}；小语：${f.line}`;
  }
  /* 让她用自己的语气讲的提示 */
  function prompt(f) {
    return `你刚帮用户抽了今天的运势，结果如下（不能改结果，也不要编别的数字）：\n${data(f)}\n` +
      '用小嬅的语气把它讲给用户听：先说总运势，再挑两三项最有意思的说（比如学业、幸运色、宜忌），最后一句鼓励。可以俏皮一点，不超过 80 字，可以按情绪转折插标签。最后自然地带一句“仅供娱乐”之类的话。';
  }

  XH.fortune = { today, text, data, prompt, stars };
})();

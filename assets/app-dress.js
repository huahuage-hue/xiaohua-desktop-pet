/* 小嬅换装：套装 + 配饰 + 按时间自动切换
   数据来自 assets/xiaohua_wardrobe.js（Seedream 5.0 以原图为底"穿在身上"生成 → tools/extract_worn.js 差分拆层 → tools/build_wardrobe.js 打包）
   · 套装 = 原衣服图层的同位替换层（replace），沿用原层的绑定、斗篷下摆物理和兜帽变形
   · 配饰 = 叠加层，插在指定原层之前；被手 / 辫子 / 脸遮住的部分已在拆层时抠掉，前景原层照常盖在上面
   · 穿戴规则：围巾 / 毛领占同一个领口槽；戴颈饰时隐藏原领口阴影；云朵胸针取代原桦叶别针 */
(function () {
  'use strict';
  const WB = window.XH_WARDROBE || null;
  const SLOTS = ['head', 'hair', 'neck', 'bag', 'charm', 'chest', 'face'];
  const NONE = { head: '', hair: '', neck: '', bag: '', charm: '', chest: '', face: '' };
  /* 头顶（兔耳 / 巫师帽 / 鹿角）和大蝴蝶结都压在兜帽顶上，互斥 */
  const CLASH = { head: { hair: ['ribbon'] }, hair: { ribbon: 'head' } };
  const PRESETS = {
    morning: { outfit: 'cream', acc: { hair: 'flower' } },
    day:     { outfit: 'classic', acc: { hair: 'flower', bag: 'bag' } },
    evening: { outfit: 'plaid', acc: { neck: 'scarf' } },
    night:   { outfit: 'moon', acc: { hair: 'ribbon', charm: 'charm' } },
    weekend: { outfit: 'star', acc: { neck: 'fur', charm: 'charm' } },
    /* 节日（优先级：节日 > 周末夜 > 日常） */
    spring:    { outfit: 'spring', acc: { hair: 'lantern', charm: 'knot' } },
    valentine: { outfit: 'valentine', acc: { hair: 'heart' } },
    dragon:    { outfit: 'dragon', acc: { charm: 'sachet' } },
    midautumn: { outfit: 'midautumn', acc: { head: 'bunny' } },
    halloween: { outfit: 'halloween', acc: { head: 'witch' } },
    xmas:      { outfit: 'xmas', acc: { head: 'antler', charm: 'bell' } },
  };
  /* 农历节日公历日期（2026–2030，已核对）：春节正月初一、端午五月初五、七夕七月初七、中秋八月十五 */
  const LUNAR = {
    spring:    { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03' },
    dragon:    { 2026: '06-19', 2027: '06-09', 2028: '05-28', 2029: '06-16', 2030: '06-05' },
    qixi:      { 2026: '08-19', 2027: '08-08', 2028: '08-26', 2029: '08-16', 2030: '08-05' },
    midautumn: { 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12' },
  };
  const DAY = 86400000;
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const at = (y, md) => { const [m, d] = md.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  /* 节日窗口：[起, 止]（含），相对锚点日期的天数 */
  const FEST = [
    { id: 'spring', name: '春节', lunar: 'spring', from: -1, to: 14 },            // 除夕 → 元宵
    { id: 'valentine', name: '情人节', fixed: '02-14', from: -1, to: 1 },
    { id: 'valentine', name: '七夕', lunar: 'qixi', from: -1, to: 1 },
    { id: 'dragon', name: '端午', lunar: 'dragon', from: -2, to: 2 },
    { id: 'midautumn', name: '中秋', lunar: 'midautumn', from: -3, to: 3 },
    { id: 'halloween', name: '万圣节', fixed: '10-31', from: -6, to: 1 },          // 10/25 – 11/1
    { id: 'xmas', name: '圣诞', fixed: '12-25', from: -7, to: 1 },                 // 12/18 – 12/26
  ];
  function festOf(date) {
    const t = day0(date || new Date()), y = new Date(t).getFullYear();
    for (const f of FEST) {
      for (const yy of [y - 1, y, y + 1]) { // 春节窗口可能跨年
        const md = f.fixed || (LUNAR[f.lunar] && LUNAR[f.lunar][yy]);
        if (!md) continue;
        const a = at(yy, md);
        if (t >= a + f.from * DAY && t <= a + f.to * DAY) return f;
      }
    }
    return null;
  }
  const D = { outfit: 'classic', acc: { ...NONE }, auto: true, fest: true, slot: '', hour: null, date: null, onChange: null };

  const ACC = (WB && WB.acc) || {};
  const OUTFITS = (WB && WB.outfits) || { classic: { name: '原版桦叶斗篷' } };

  /* 只接受数据里存在、且槽位匹配的配饰 id；头顶配饰与大蝴蝶结互斥（头顶优先） */
  const normAcc = (a) => {
    const o = { ...NONE };
    for (const s of SLOTS) {
      const id = a && typeof a[s] === 'string' ? a[s] : '';
      o[s] = id && ACC[id] && ACC[id].slot === s ? id : '';
    }
    if (o.head && CLASH.head.hair.includes(o.hair)) o.hair = '';
    return o;
  };
  const normOutfit = (id) => (OUTFITS[id] ? id : 'classic');

  function slotOf(date) {
    const d = date || D.date || new Date();
    if (D.fest) { const f = festOf(d); if (f && PRESETS[f.id] && OUTFITS[PRESETS[f.id].outfit]) return f.id; }
    const h = D.hour == null ? d.getHours() : D.hour;
    const wd = d.getDay();
    if (h >= 6 && h < 11) return 'morning';
    if (h >= 11 && h < 17) return 'day';
    if (h >= 17 && h < 21) return (wd === 5 || wd === 6) ? 'weekend' : 'evening';
    return 'night';
  }
  function preset(slot) {
    const p = PRESETS[slot] || PRESETS.day;
    return { outfit: normOutfit(p.outfit), acc: normAcc(p.acc) };
  }
  function applyPreset(slot) {
    const p = preset(slot);
    D.slot = slot;
    D.outfit = p.outfit;
    D.acc = p.acc;
  }

  /* 当前要隐藏的图层：未穿的配饰、非当前套装的替换层、被当前套装替换掉的原层、配饰声明要隐藏的原层 */
  /* ready = false：当前套装图集还在加载，先按原版画 */
  function hideMap(ready) {
    const out = {};
    if (!WB) return out;
    const of = ready === false ? 'classic' : D.outfit;
    for (const l of WB.layers) {
      if (l.replace) {
        if (l.outfit !== of) out[l.id] = 1;
        else out[l.replace] = 1;
      } else if (D.acc[l.slot] !== l.id.slice(2)) out[l.id] = 1;
    }
    for (const s of SLOTS) {
      const a = D.acc[s] && ACC[D.acc[s]];
      if (a && a.hide) for (const id of a.hide) out[id] = 1;
    }
    return out;
  }
  /* 换装不再做着色器染色：面料就在替换层的像素里 */
  function surface() { return null; }

  /* before:<id> 插在该层之前；after:<id> 紧跟该层（同位替换） */
  function merge(base, extra) {
    const out = base.slice();
    for (const l of extra) {
      const m = /^(before|after):(.+)$/.exec(l.z || '');
      const i = m ? out.findIndex((x) => x.id === m[2]) : -1;
      if (i < 0) out.push(l);
      else if (m[1] === 'before') out.splice(i, 0, l);
      else out.splice(i + 1, 0, l);
    }
    return out;
  }
  function changed(prevOutfit, prevAcc) {
    return !(prevOutfit === D.outfit && JSON.stringify(prevAcc) === JSON.stringify(D.acc));
  }
  function apply(o) {
    if (!o) return;
    const prevOutfit = D.outfit, prevAcc = D.acc, wasAuto = D.auto, wasFest = D.fest;
    if ('autoDress' in o) D.auto = !!o.autoDress;
    if ('festival' in o) D.fest = o.festival !== false;
    if (D.auto) {
      const slot = slotOf();
      if (slot !== D.slot || !wasAuto || wasFest !== D.fest) {
        applyPreset(slot);
        if (D.onChange && changed(prevOutfit, prevAcc)) D.onChange(D.outfit, D.acc, true);
      }
      return;
    }
    if (o.outfit && o.outfit !== 'auto') D.outfit = normOutfit(o.outfit);
    if (o.acc) D.acc = normAcc(o.acc);
  }
  function next() {
    const ids = Object.keys(OUTFITS);
    const i = Math.max(0, ids.indexOf(D.outfit));
    D.outfit = ids[(i + 1) % ids.length];
    D.auto = false;
    return D.outfit;
  }
  function tick() {
    if (!D.auto) return;
    const slot = slotOf();
    if (slot === D.slot) return;
    const prevOutfit = D.outfit, prevAcc = D.acc;
    applyPreset(slot);
    if (D.onChange && changed(prevOutfit, prevAcc)) D.onChange(D.outfit, D.acc, true);
  }
  if (WB) {
    D.slot = slotOf();
    applyPreset(D.slot);
    setInterval(tick, 20000);
  }
  window.XH.dress = {
    apply, hideMap, surface, merge, next, tick, slotOf, preset, festOf, FEST, LUNAR,
    outfit: () => D.outfit,
    state: () => ({ outfit: D.outfit, acc: normAcc(D.acc), auto: D.auto, festival: D.fest, slot: D.slot }),
    setOnChange: (fn) => { D.onChange = fn; },
    /* 调试：固定小时 / 日期（'2026-12-25'）；传 null 恢复真实时间 */
    debugAt: (h) => { D.hour = h; D.slot = ''; tick(); },
    debugDate: (s) => { D.date = s ? new Date(s + 'T12:00:00') : null; D.slot = ''; tick(); },
  };
})();

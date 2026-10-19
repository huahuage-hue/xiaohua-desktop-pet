/* 无头 Chrome 小工具：解码任意图片（JPG/WebP）为 PNG。用法：node tools/chrome.js decode in.jpg out.png [in2 out2 ...] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CH = process.env.BR || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const port = 9400 + Math.floor(Math.random() * 300);
  const prof = path.join(process.env.TEMP, 'opencode', 'chprof_tool');
  const p = spawn(CH, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + prof, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank']);
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = l.find((x) => x.type === 'page'); if (pg) ws = pg.webSocketDebuggerUrl; } catch (e) {}
    if (!ws) await sleep(250);
  }
  const S = new WebSocket(ws); await new Promise((r) => (S.onopen = r));
  let id = 0; const pend = {};
  S.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; S.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  return { evaluate, send, close: () => { S.close(); p.kill(); } };
}

async function decode(pairs) {
  const B = await open();
  try {
    for (const [inp, out] of pairs) {
      const b64 = fs.readFileSync(inp).toString('base64');
      const mime = /\.png$/i.test(inp) ? 'image/png' : /\.webp$/i.test(inp) ? 'image/webp' : 'image/jpeg';
      const url = await B.evaluate(`new Promise((ok,bad)=>{const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);ok(c.toDataURL('image/png'))};im.onerror=()=>bad('decode fail');im.src='data:${mime};base64,${b64}'})`);
      fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
      console.log('decoded', inp, '->', out);
    }
  } finally { B.close(); }
}

module.exports = { open, decode };
if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === 'decode') { const pairs = []; for (let i = 1; i + 1 < a.length; i += 2) pairs.push([a[i], a[i + 1]]); decode(pairs).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); }); }
}

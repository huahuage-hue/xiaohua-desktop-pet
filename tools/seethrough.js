// 调用 See-through 在线 Demo：node tools/seethrough.js <输入图> <输出.psd> [分辨率=1280] [seed=42]
'use strict';
const fs = require('fs'), path = require('path');
const B = 'https://24yearsold-see-through-demo.hf.space/gradio_api';
const [, , inp, outp, res = '1280', seed = '42'] = process.argv;
(async () => {
  const fd = new FormData();
  const mime = /\.png$/i.test(inp) ? 'image/png' : 'image/jpeg';
  fd.append('files', new Blob([fs.readFileSync(inp)], { type: mime }), path.basename(inp));
  let r = await fetch(B + '/upload', { method: 'POST', body: fd });
  const up = await r.json();
  const file = { path: up[0], orig_name: path.basename(inp), mime_type: mime, meta: { _type: 'gradio.FileData' } };
  r = await fetch(B + '/call/inference', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: [file, +res, +seed, true] }) });
  const { event_id } = await r.json();
  const t0 = Date.now();
  r = await fetch(B + '/call/inference/' + event_id);
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '', ev = '', result = null;
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      if (l.startsWith('event:')) ev = l.slice(6).trim();
      else if (l.startsWith('data:') && ev === 'complete') result = JSON.parse(l.slice(5));
      else if (l.startsWith('data:') && ev === 'error') { console.log('ERROR', l.slice(5, 400), ((Date.now() - t0) / 1000) | 0, 's'); process.exit(2); }
    }
  }
  if (!result) { console.log('no result'); process.exit(3); }
  const f = await fetch(result[0].url);
  const b = Buffer.from(await f.arrayBuffer());
  fs.writeFileSync(outp, b);
  console.log('OK', outp, b.length, ((Date.now() - t0) / 1000) | 0, 's');
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });

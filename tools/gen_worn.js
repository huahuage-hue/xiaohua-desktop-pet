/* 并行生成"穿在身上"的换装图：node tools/gen_worn.js id1 id2 ...
   提示词 psd/raw/wardrobe/prompts/worn_<id>.txt，参考图 assets/xiaohua_ref.png，输出 psd/raw/gen/worn_<id>.jpg */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ids = process.argv.slice(2);
Promise.all(ids.map((id) => new Promise((ok) => {
  const p = spawn(process.execPath, [path.join(__dirname, 'gen.js'), 'worn_' + id, 'assets/xiaohua_ref.png', '9:16', `psd/raw/wardrobe/prompts/worn_${id}.txt`], { cwd: ROOT, env: process.env });
  let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (c) => { console.log(`[${id}] exit ${c} ${out.trim().split('\n').slice(-1)[0]}`); ok(); });
}))).then(() => process.exit(0));
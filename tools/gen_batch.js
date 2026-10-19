/* 并行跑多个 Seedream 任务：node tools/gen_batch.js name,src,aspect [name,src,aspect ...]
   提示词取 psd/raw/gen/p_<name>.txt，参考图取 psd/raw/gen/<src>.png */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const jobs = process.argv.slice(2).map((s) => s.split(','));
Promise.all(jobs.map(([name, src, aspect]) => new Promise((ok) => {
  const p = spawn(process.execPath, [path.join(__dirname, 'gen.js'), name, `psd/raw/gen/${src}.png`, aspect, `psd/raw/gen/p_${name.replace(/_v\d+$/, '')}.txt`], { cwd: ROOT, env: process.env });
  let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (c) => { console.log(`[${name}] exit ${c} ${out.trim().split('\n').slice(-2).join(' | ')}`); ok(); });
}))).then(() => process.exit(0));

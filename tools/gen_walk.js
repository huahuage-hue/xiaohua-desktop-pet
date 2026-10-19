/* 并行生成侧身走路帧：node tools/gen_walk.js [start] [count] [concurrency]
   参考图固定为 psd/raw/gen/walk_side_base.jpg，提示词 psd/raw/gen/p_walk_side_<n>.txt */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const start = +(process.argv[2] || 0);
const count = +(process.argv[3] || 8);
const conc = +(process.argv[4] || 4);
const names = Array.from({ length: count }, (_, i) => start + i);
const run = (n) => new Promise((ok) => {
  const args = [path.join(__dirname, 'gen.js'), `walk_side_${n}`, 'psd/raw/gen/walk_side_base.jpg', '9:16', `psd/raw/gen/p_walk_side_${n}.txt`];
  const p = spawn(process.execPath, args, { cwd: ROOT, env: process.env });
  let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (c) => { console.log(`[${n}] exit ${c} ${out.trim().split('\n').slice(-1)[0]}`); ok(c === 0); });
});
(async () => {
  const queue = names.slice();
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      if (!(await run(n))) { console.log(`[${n}] retry`); await run(n); }
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  process.exit(0);
})();

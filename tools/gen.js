/* 调用 OpenDesign Cloud 的 Seedream 5.0 Pro（即梦同源模型）做以图改图，并等待结果。
   用法：node tools/gen.js <名字> <参考图(项目相对)> <宽高比> <提示词文件>
   本地参考图会先复制到 OpenDesign 项目的 .media-input/ 下，再以项目相对路径传给 CLI。
   结果：psd/raw/gen/<名字>.jpg */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PROJ = process.env.OD_PROJECT_DIR ? path.resolve(process.env.OD_PROJECT_DIR) : null;
const INPUT_DIR = PROJ ? path.join(PROJ, '.media-input') : null;
const [name, image, aspect, promptFile] = process.argv.slice(2);
const MODEL = process.env.GEN_MODEL || 'vela/seedream-5.0-pro';
const inside = (p, dir) => {
  const rel = path.relative(dir, p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};
const stageInput = (p) => {
  if (!p || !PROJ) return p;
  const abs = path.resolve(ROOT, p);
  if (!fs.existsSync(abs) || inside(abs, PROJ)) return p;
  fs.mkdirSync(INPUT_DIR, { recursive: true });
  const dst = path.join(INPUT_DIR, path.basename(abs));
  fs.copyFileSync(abs, dst);
  return path.relative(PROJ, dst).split(path.sep).join('/');
};
const od = (args) => {
  const r = spawnSync(process.env.OD_NODE_BIN, [process.env.OD_BIN, ...args], { cwd: PROJ || ROOT, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, maxBuffer: 1 << 26 });
  const lines = (r.stdout || '').trim().split(/\r?\n/);
  let j = null; try { j = JSON.parse(lines[lines.length - 1]); } catch (e) {}
  return { code: r.status, json: j, err: r.stderr };
};
const imageArg = stageInput(image), promptArg = stageInput(promptFile);
const genArgs = ['media', 'generate', '--surface', 'image'];
if (process.env.OD_PROJECT_ID) genArgs.push('--project', process.env.OD_PROJECT_ID);
genArgs.push('--model', MODEL, '--image', imageArg, '--prompt-file', promptArg, '--aspect', aspect, '--output', `gen_${name}.jpg`);
let r = od(genArgs);
while (r.json && r.json.taskId && !r.json.file) {
  r = od(['media', 'wait', r.json.taskId, '--since', String(r.json.nextSince || 0)]);
  if (r.code !== 0 && r.code !== 2) break;
}
if (!r.json || !r.json.file) { console.error('FAIL', name, r.code, r.err && r.err.slice(-800), JSON.stringify(r.json)); process.exit(1); }
const relName = r.json.file.name;
const candidates = [path.join(ROOT, relName), PROJ && path.join(PROJ, relName), PROJ && path.join(PROJ, 'files', relName)].filter(Boolean);
const src = candidates.find((p) => fs.existsSync(p));
if (!src) { console.error('FAIL', name, 'output missing:', relName, candidates); process.exit(1); }
const dst = path.join(ROOT, 'psd/raw/gen', name + path.extname(relName));
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log('OK', name, dst, r.json.file.providerNote);

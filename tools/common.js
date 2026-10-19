// Shared helpers for the PSD pipeline (web-image coordinate space 1200 x 2133)
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./psdlib.js');

const ROOT = path.resolve(__dirname, '..');
const IW = 1200, IH = 2133;
const ST = 1024, SC = IH / ST, OX = 466.5; // See-through square canvas -> web image

function loadWeb() {
  /* 优先用仓库里的 1200×2133 网页图（由 assets/xiaohua_web.jpg 解码），不再依赖临时目录 */
  const local = path.join(ROOT, 'psd/raw/web.png');
  const png = fs.existsSync(local) ? local : path.join(process.env.TEMP, 'opencode', 'web.png');
  return P.decodePNG(fs.readFileSync(png)).rgba;
}

// bilinear sample of a See-through layer (rgba straight) at web coords -> [r,g,b,a]
function stSampler(L) {
  return function (x, y) {
    const sx = (x + 0.5 + OX) / SC - 0.5 - L.left, sy = (y + 0.5) / SC - 0.5 - L.top;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const X = x0 + i, Y = y0 + j;
      if (X < 0 || Y < 0 || X >= L.width || Y >= L.height) continue;
      const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      const q = (Y * L.width + X) * 4, aa = L.rgba[q + 3] / 255 * w;
      r += L.rgba[q] * aa; g += L.rgba[q + 1] * aa; b += L.rgba[q + 2] * aa; a += aa;
    }
    return a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0];
  };
}
function stBox(L) {
  return {
    x0: Math.max(0, Math.floor(L.left * SC - OX) - 2), y0: Math.max(0, Math.floor(L.top * SC) - 2),
    x1: Math.min(IW, Math.ceil((L.left + L.width) * SC - OX) + 2), y1: Math.min(IH, Math.ceil((L.top + L.height) * SC) + 2),
  };
}

module.exports = { fs, path, P, ROOT, IW, IH, SC, OX, loadWeb, stSampler, stBox };

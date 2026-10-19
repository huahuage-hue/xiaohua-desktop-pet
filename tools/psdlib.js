// Minimal dependency-free PSD (8-bit RGB) reader/writer + PNG encoder/decoder.
'use strict';
const zlib = require('zlib');

/* ---------------- PSD READ ---------------- */
function readPSD(buf) {
  let o = 0;
  const u8 = () => buf[o++];
  const u16 = () => { const v = buf.readUInt16BE(o); o += 2; return v; };
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const u32 = () => { const v = buf.readUInt32BE(o); o += 4; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const sig = buf.toString('ascii', 0, 4); o = 4;
  if (sig !== '8BPS') throw new Error('not psd');
  const ver = u16(); o += 6;
  const channels = u16(), height = u32(), width = u32(), depth = u16(), mode = u16();
  if (depth !== 8) throw new Error('depth ' + depth);
  { const n = u32(); o += n; } // color mode data
  { const n = u32(); o += n; } // image resources
  const lmLen = ver === 2 ? (o += 8, 0) : u32();
  const lmEnd = o + lmLen;
  const liLen = u32();
  const liEnd = o + liLen;
  let count = i16(); count = Math.abs(count);
  const layers = [];
  for (let i = 0; i < count; i++) {
    const L = { top: i32(), left: i32(), bottom: i32(), right: i32() };
    const nc = u16(); L.chans = [];
    for (let c = 0; c < nc; c++) L.chans.push({ id: i16(), len: u32() });
    o += 4; L.blend = buf.toString('ascii', o, o + 4); o += 4;
    L.opacity = u8(); L.clipping = u8(); L.flags = u8(); o++;
    const exLen = u32(); const exEnd = o + exLen;
    { const n = u32(); o += n; } // mask
    { const n = u32(); o += n; } // blending ranges
    const nlen = u8(); L.name = buf.toString('latin1', o, o + nlen); o += ((nlen + 4) & ~3) - 1;
    L.sectionType = 0;
    while (o + 12 <= exEnd) {
      const s = buf.toString('ascii', o, o + 4); o += 4;
      const key = buf.toString('ascii', o, o + 4); o += 4;
      const len = u32(); const st = o;
      if (key === 'luni') {
        const n = buf.readUInt32BE(o); let s2 = '';
        for (let k = 0; k < n; k++) s2 += String.fromCharCode(buf.readUInt16BE(o + 4 + k * 2));
        L.name = s2;
      } else if (key === 'lsct' || key === 'lsdk') {
        L.sectionType = buf.readUInt32BE(o);
      }
      o = st + len + (len & 1 && s === '8BIM' ? 0 : 0);
      o = st + len;
    }
    o = exEnd;
    layers.push(L);
  }
  // channel image data
  for (const L of layers) {
    const w = L.right - L.left, h = L.bottom - L.top;
    L.width = w; L.height = h;
    L.rgba = w > 0 && h > 0 ? Buffer.alloc(w * h * 4, 255) : null;
    for (const ch of L.chans) {
      const start = o; const comp = u16();
      const cw = w, chh = h;
      let data = null;
      if (cw > 0 && chh > 0 && ch.id >= -1) {
        if (comp === 0) { data = buf.subarray(o, o + cw * chh); }
        else if (comp === 1) {
          const counts = []; for (let r = 0; r < chh; r++) counts.push(u16());
          data = Buffer.alloc(cw * chh); let p = 0;
          for (let r = 0; r < chh; r++) {
            const end = o + counts[r];
            while (o < end) {
              let n = buf.readInt8(o++);
              if (n >= 0) { buf.copy(data, p, o, o + n + 1); p += n + 1; o += n + 1; }
              else if (n !== -128) { const v = buf[o++]; data.fill(v, p, p + 1 - n); p += 1 - n; }
            }
          }
        } else if (comp === 2 || comp === 3) {
          data = zlib.inflateSync(buf.subarray(o, start + ch.len));
        }
      }
      if (data && L.rgba) {
        const idx = ch.id === -1 ? 3 : ch.id;
        if (idx >= 0 && idx <= 3) for (let k = 0; k < cw * chh; k++) L.rgba[k * 4 + idx] = data[k];
      }
      o = start + ch.len;
    }
    if (L.rgba && !L.chans.some(c => c.id === -1)) for (let k = 0; k < w * h; k++) L.rgba[k * 4 + 3] = 255;
    delete L.chans;
  }
  return { width, height, channels, mode, layers };
}

/* layers bottom->top with section markers -> tree */
function toTree(layers) {
  const root = { name: 'root', children: [] }; const stack = [root];
  for (const L of layers) {
    if (L.sectionType === 3) { const g = { name: '', group: true, children: [] }; stack[stack.length - 1].children.push(g); stack.push(g); }
    else if (L.sectionType === 1 || L.sectionType === 2) { const g = stack.pop(); g.name = L.name; g.opacity = L.opacity; g.hidden = !!(L.flags & 2); }
    else stack[stack.length - 1].children.push(L);
  }
  return root;
}

/* ---------------- PSD WRITE ---------------- */
// tree: { children:[ {name, group:true, children:[...]} | {name, left, top, width, height, rgba, opacity, hidden} ] }, children ordered bottom->top
function writePSD(W, H, tree, composite) {
  const recs = []; // bottom->top flat list
  (function walk(node) {
    for (const c of node.children) {
      if (c.group) {
        recs.push({ name: '</Layer group>', section: 3, left: 0, top: 0, width: 0, height: 0 });
        walk(c);
        recs.push({ name: c.name, section: c.open === false ? 2 : 1, left: 0, top: 0, width: 0, height: 0, hidden: c.hidden, opacity: c.opacity });
      } else recs.push(c);
    }
  })(tree);

  const parts = [];
  const B = (n) => Buffer.alloc(n);
  const be16 = (v) => { const b = B(2); b.writeInt16BE(v); return b; };
  const be32 = (v) => { const b = B(4); b.writeInt32BE(v); return b; };
  const ube32 = (v) => { const b = B(4); b.writeUInt32BE(v); return b; };

  function rleRows(plane, w, h) {
    const r = rleData(plane, w, h);
    return Buffer.concat([be16(1), r.counts, r.data]);
  }
  function rleData(plane, w, h) {
    const counts = [], rows = [];
    for (let y = 0; y < h; y++) {
      const row = plane.subarray(y * w, y * w + w); const out = [];
      let i = 0;
      while (i < w) {
        let j = i; while (j < w && j - i < 128 && row[j] === row[i]) j++;
        if (j - i >= 3) { out.push(257 - (j - i) & 255, row[i]); i = j; continue; }
        let k = i; const lit = [];
        while (k < w && lit.length < 128) {
          if (k + 2 < w && row[k] === row[k + 1] && row[k] === row[k + 2]) break;
          lit.push(row[k]); k++;
        }
        out.push(lit.length - 1, ...lit); i = k;
      }
      const b = Buffer.from(out); counts.push(b.length); rows.push(b);
    }
    const head = B(h * 2); counts.forEach((c, i) => head.writeUInt16BE(c, i * 2));
    return { counts: head, data: Buffer.concat(rows) };
  }

  const recBufs = [], chanBufs = [];
  for (const L of recs) {
    const w = L.width | 0, h = L.height | 0;
    const chData = [];
    for (const id of [-1, 0, 1, 2]) {
      let d;
      if (w > 0 && h > 0) {
        const plane = B(w * h); const ci = id === -1 ? 3 : id;
        for (let k = 0; k < w * h; k++) plane[k] = L.rgba[k * 4 + ci];
        d = rleRows(plane, w, h);
      } else d = be16(0);
      chData.push({ id, d });
    }
    // name
    const nameAscii = Buffer.from(L.name.replace(/[^\x20-\x7e]/g, '_').slice(0, 255), 'latin1');
    let pn = Buffer.concat([Buffer.from([nameAscii.length]), nameAscii]);
    pn = Buffer.concat([pn, B((4 - pn.length % 4) % 4)]);
    const extras = [];
    // luni
    const nm = L.name; const lu = B(4 + nm.length * 2); lu.writeUInt32BE(nm.length);
    for (let k = 0; k < nm.length; k++) lu.writeUInt16BE(nm.charCodeAt(k), 4 + k * 2);
    const luPad = Buffer.concat([lu, B((4 - lu.length % 4) % 4)]);
    extras.push(Buffer.from('8BIMluni', 'ascii'), ube32(luPad.length), luPad);
    if (L.section) extras.push(Buffer.from('8BIMlsct', 'ascii'), ube32(4), ube32(L.section));
    const extra = Buffer.concat([ube32(0), ube32(0), pn, ...extras]);
    let flags = 0; if (L.hidden) flags |= 2; if (L.section === 3) flags |= 0; 
    const rec = Buffer.concat([
      be32(L.top | 0), be32(L.left | 0), be32((L.top | 0) + h), be32((L.left | 0) + w),
      be16(4), ...chData.map(c => Buffer.concat([be16(c.id), ube32(c.d.length)])),
      Buffer.from('8BIMnorm', 'ascii'), Buffer.from([L.opacity == null ? 255 : L.opacity, 0, flags, 0]),
      ube32(extra.length), extra,
    ]);
    recBufs.push(rec); chanBufs.push(...chData.map(c => c.d));
  }
  let layerInfo = Buffer.concat([be16(-recs.length), ...recBufs, ...chanBufs]);
  if (layerInfo.length % 2) layerInfo = Buffer.concat([layerInfo, B(1)]);
  const lmi = Buffer.concat([ube32(layerInfo.length), layerInfo, ube32(0)]);

  const header = Buffer.concat([Buffer.from('8BPS'), Buffer.from([0, 1]), B(6), Buffer.from([0, 4]), ube32(H), ube32(W), Buffer.from([0, 8, 0, 3])]);
  // composite（RLE，4 通道平面）
  const cs = [], ds = [], plane = B(W * H);
  for (let c = 0; c < 4; c++) {
    for (let k = 0; k < W * H; k++) plane[k] = composite[k * 4 + c];
    const r = rleData(plane, W, H); cs.push(r.counts); ds.push(r.data);
  }
  const comp = Buffer.concat([be16(1), ...cs, ...ds]);
  return Buffer.concat([header, ube32(0), ube32(0), ube32(lmi.length), lmi, comp]);
}

/* ---------------- PNG ---------------- */
const crcT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc(b) { let c = -1; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }
function encodePNG(w, h, rgba, level = 9) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePNG(buf) {
  let o = 8, w, h, ct, bd, idat = [], pal;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'PLTE') pal = d;
    o += 12 + len;
  }
  if (bd !== 8) throw new Error('bitdepth');
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4, 3: 1 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4, s = x * bpp;
      if (ct === 6) { line.copy(out, k, s, s + 4); }
      else if (ct === 2) { out[k] = line[s]; out[k + 1] = line[s + 1]; out[k + 2] = line[s + 2]; out[k + 3] = 255; }
      else if (ct === 0) { out[k] = out[k + 1] = out[k + 2] = line[s]; out[k + 3] = 255; }
      else if (ct === 4) { out[k] = out[k + 1] = out[k + 2] = line[s]; out[k + 3] = line[s + 1]; }
      else if (ct === 3) { out[k] = pal[line[s] * 3]; out[k + 1] = pal[line[s] * 3 + 1]; out[k + 2] = pal[line[s] * 3 + 2]; out[k + 3] = 255; }
    }
    prev = line;
  }
  return { width: w, height: h, rgba: out };
}

module.exports = { readPSD, toTree, writePSD, encodePNG, decodePNG };


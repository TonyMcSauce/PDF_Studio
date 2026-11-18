'use strict';
/* PDF Studio · Image toolkit
   Shared by the photo tools, PDF to Images and Images to PDF.
   Everything here runs on this device:
   - decode any photo the browser can read, plus HEIC/HEIF through libheif
     in a worker (fetched only the first time a HEIC file is opened)
   - encode to JPG, PNG or WebP, optionally squeezing under a target size
   - read and losslessly strip location, camera and other hidden details
   - bundle several results into a ZIP */

const IK = (() => {

  /* ── File type sniffing (by content, not by name) ── */
  const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
  const ascii = (b, s, n) => String.fromCharCode(...b.subarray(s, s + n));

  async function sniff(file) {
    const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
    if (ascii(b, 0, 3) === 'GIF') return 'gif';
    if (ascii(b, 0, 2) === 'BM') return 'bmp';
    if (ascii(b, 4, 4) === 'ftyp') {
      const size = Math.min(new DataView(b.buffer).getUint32(0), b.length);
      const brands = [ascii(b, 8, 4)];
      for (let p = 16; p + 4 <= size; p += 4) brands.push(ascii(b, p, 4));
      if (brands[0] === 'avif' || brands[0] === 'avis') return 'avif';
      if (brands.some(x => HEIF_BRANDS.includes(x))) return brands.includes('avif') && !brands.some(x => x.startsWith('he')) ? 'avif' : 'heic';
    }
    return null;
  }

  const LABEL = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', heic: 'HEIC', avif: 'AVIF', gif: 'GIF', bmp: 'BMP' };
  const MIME  = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const EXT   = { jpeg: 'jpg', png: 'png', webp: 'webp' };

  /* iOS and iPadOS cap a canvas at about 16.7 million pixels; elsewhere allow more */
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const MAX_PX = IOS ? 16777216 : 100000000;

  /* ── HEIC worker (created on first use, then reused) ── */
  let worker = null, seq = 0;
  const pending = new Map();
  function heicWorker() {
    if (worker) return worker;
    worker = new Worker('js/heic-worker.js');
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id); if (!p) return;
      pending.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data);
    };
    worker.onerror = e => {
      e.preventDefault();
      pending.forEach(p => p.reject(new Error('The HEIC decoder could not start')));
      pending.clear(); worker = null;
    };
    return worker;
  }
  async function decodeHeicInWorker(file) {
    const buffer = await file.arrayBuffer();
    const id = ++seq;
    const res = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      heicWorker().postMessage({ id, buffer }, [buffer]);
    });
    const cv = document.createElement('canvas');
    cv.width = res.width; cv.height = res.height;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(res.pixels), res.width, res.height), 0, 0);
    return cv;
  }

  /* Native first (Safari reads HEIC itself), then the browser's <img>, then libheif */
  async function nativeBitmap(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) {}
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  // Returns { src: drawable, width, height, kind }
  async function decode(file, kind) {
    kind = kind || await sniff(file);
    let src = null;
    try { src = await nativeBitmap(file); } catch (_) {}
    if (!src && kind === 'heic') src = await decodeHeicInWorker(file);
    if (!src) throw new Error(`This ${LABEL[kind] || 'file'} could not be opened`);
    const width = src.naturalWidth || src.width, height = src.naturalHeight || src.height;
    if (!width || !height) throw new Error('This image is empty');
    return { src, width, height, kind };
  }
  function release(d) { if (d && d.src && typeof d.src.close === 'function') d.src.close(); }

  /* ── Sizing ── */
  // resize: { mode: 'none' | 'long' | 'pct', value }
  function fitSize(w, h, resize) {
    let s = 1;
    if (resize && resize.mode === 'long' && resize.value > 0) s = Math.min(1, resize.value / Math.max(w, h));
    if (resize && resize.mode === 'pct'  && resize.value > 0) s = Math.min(1, resize.value / 100);
    if (w * h * s * s > MAX_PX) s = Math.sqrt(MAX_PX / (w * h));
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
  }

  // Draw with stepwise halving so big reductions stay sharp instead of aliased
  function toCanvas(d, width, height, background) {
    let src = d.src, sw = d.width, sh = d.height;
    while (sw / 2 >= width * 1.5 && sh / 2 >= height * 1.5) {
      const step = document.createElement('canvas');
      step.width = Math.round(sw / 2); step.height = Math.round(sh / 2);
      const c = step.getContext('2d'); c.imageSmoothingQuality = 'high';
      c.drawImage(src, 0, 0, step.width, step.height);
      src = step; sw = step.width; sh = step.height;
    }
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const ctx = cv.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, width, height);
    return cv;
  }

  /* ── Encoding ── */
  function encode(canvas, mime, quality) {
    return new Promise((res, rej) => canvas.toBlob(b => {
      if (!b) return rej(new Error('The browser could not save this image'));
      if (b.type !== mime) return rej(new Error(`This browser cannot save ${LABEL[mime.split('/')[1]] || mime} files`));
      res(b);
    }, mime, quality));
  }

  let _webp = null;
  function canEncodeWebp() {
    if (_webp === null) {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      _webp = c.toDataURL('image/webp').startsWith('data:image/webp');
    }
    return _webp;
  }

  // Finds the best quality that fits under targetBytes, shrinking the image if it has to
  async function encodeToTarget(d, size, mime, targetBytes, background) {
    let { width, height } = size, scaled = false;
    for (let round = 0; round < 6; round++) {
      const cv = toCanvas(d, width, height, background);
      let lo = 0.4, hi = 0.95, best = null;
      const top = await encode(cv, mime, hi);
      if (top.size <= targetBytes) return { blob: top, width, height, quality: hi, scaled };
      for (let i = 0; i < 6; i++) {
        const q = (lo + hi) / 2, b = await encode(cv, mime, q);
        if (b.size <= targetBytes) { best = { blob: b, quality: q }; lo = q; } else hi = q;
      }
      if (best) return { ...best, width, height, scaled };
      const floor = await encode(cv, mime, 0.4);
      const f = Math.max(0.5, Math.min(0.92, Math.sqrt(targetBytes / floor.size) * 0.95));
      width = Math.max(1, Math.round(width * f)); height = Math.max(1, Math.round(height * f));
      scaled = true;
    }
    const cv = toCanvas(d, width, height, background);
    return { blob: await encode(cv, mime, 0.4), width, height, quality: 0.4, scaled: true, missed: true };
  }

  /* ── EXIF (TIFF) reading ── */
  const u16 = (v, p, le) => v.getUint16(p, le);
  const u32 = (v, p, le) => v.getUint32(p, le);

  function readTiff(t) {
    if (!t || t.length < 8) return null;
    const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const le = t[0] === 0x49;
    if (!le && t[0] !== 0x4D) return null;
    const ifd = off => {
      const out = new Map();
      if (!off || off + 2 > t.length) return out;
      const n = u16(v, off, le);
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12; if (e + 12 > t.length) break;
        out.set(u16(v, e, le), { type: u16(v, e + 2, le), count: u32(v, e + 4, le), at: e + 8 });
      }
      return out;
    };
    const str = ent => {
      if (!ent || ent.type !== 2) return null;
      const p = ent.count > 4 ? u32(v, ent.at, le) : ent.at;
      if (p + ent.count > t.length) return null;
      return ascii(t, p, ent.count).replace(/\0[\s\S]*$/, '').trim() || null;
    };
    const ptr = ent => ent ? u32(v, ent.at, le) : 0;
    const ifd0 = ifd(u32(v, 4, le));
    const exif = ifd(ptr(ifd0.get(0x8769)));
    const gps  = ifd(ptr(ifd0.get(0x8825)));
    const ori  = ifd0.get(0x0112);
    return {
      le, view: v, orientationAt: ori ? ori.at : -1,
      orientation: ori ? u16(v, ori.at, le) : 1,
      make: str(ifd0.get(0x010F)), model: str(ifd0.get(0x0110)),
      software: str(ifd0.get(0x0131)),
      date: str(exif.get(0x9003)) || str(ifd0.get(0x0132)),
      gps: gps.has(2) || gps.has(4),
    };
  }

  /* ── Container walkers ── */
  function jpegLayout(b) {
    if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('Not a valid JPG');
    const segs = []; let p = 2, sos = -1;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xFF) throw new Error('This JPG is damaged');
      const m = b[p + 1];
      if (m === 0xFF) { p++; continue; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
      if (m === 0xDA) { sos = p; break; }
      const len = (b[p + 2] << 8) | b[p + 3];
      segs.push({ m, start: p, end: p + 2 + len });
      p += 2 + len;
    }
    if (sos < 0) throw new Error('This JPG has no image data');
    // Walk the scans to the real end-of-image marker; anything after it
    // (extra pictures, depth maps) is dropped.
    let i = sos, eoi = b.length;
    while (i + 1 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0x00 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD9) { eoi = i + 2; break; }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return { segs, sos, eoi };
  }
  const isExifApp1 = (b, s) => b[s.start + 1] === 0xE1 && ascii(b, s.start + 4, 6) === 'Exif\0\0';
  const isIcc      = (b, s) => b[s.start + 1] === 0xE2 && ascii(b, s.start + 4, 12) === 'ICC_PROFILE\0';

  function pngChunks(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
    for (let p = 8; p + 12 <= b.length;) {
      const len = v.getUint32(p), type = ascii(b, p + 4, 4);
      out.push({ type, start: p, end: p + 12 + len, data: p + 8, len });
      p += 12 + len;
      if (type === 'IEND') break;
    }
    return out;
  }

  function webpChunks(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
    for (let p = 12; p + 8 <= b.length;) {
      const type = ascii(b, p, 4), len = v.getUint32(p + 4, true);
      const end = Math.min(b.length, p + 8 + len + (len & 1));
      out.push({ type, start: p, end, data: p + 8, len });
      p = end;
    }
    return out;
  }

  // HEIC keeps EXIF as an item inside the 'meta' box
  function heicExif(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const boxes = (from, to, cb) => {
      for (let p = from; p + 8 <= to;) {
        let size = v.getUint32(p), hdr = 8;
        if (size === 1) { size = Number(v.getBigUint64(p + 8)); hdr = 16; }
        else if (size === 0) size = to - p;
        if (size < hdr) return;
        if (cb(ascii(b, p + 4, 4), p + hdr, Math.min(p + size, to)) === false) return;
        p += size;
      }
    };
    let meta = null;
    boxes(0, b.length, (t, s, e) => { if (t === 'meta') { meta = [s + 4, e]; return false; } });
    if (!meta) return null;
    let exifId = null, iloc = null;
    boxes(meta[0], meta[1], (t, s, e) => {
      if (t === 'iinf') {
        const ver = b[s]; let r = s + 4;
        r += ver === 0 ? 2 : 4;
        boxes(r, e, (it, is) => {
          if (it !== 'infe') return;
          const iv = b[is]; if (iv < 2) return;
          let q = is + 4;
          const id = iv === 2 ? v.getUint16(q) : v.getUint32(q);
          q += (iv === 2 ? 2 : 4) + 2;
          if (ascii(b, q, 4) === 'Exif') exifId = id;
        });
      } else if (t === 'iloc') iloc = [s, e];
    });
    if (exifId === null || !iloc) return null;
    const ver = b[iloc[0]]; let r = iloc[0] + 4;
    const os = b[r] >> 4, ls = b[r] & 15, bs = b[r + 1] >> 4, xs = ver >= 1 ? b[r + 1] & 15 : 0; r += 2;
    const num = n => { const x = n === 4 ? v.getUint32(r) : n === 8 ? Number(v.getBigUint64(r)) : 0; r += n; return x; };
    const count = ver < 2 ? v.getUint16(r) : v.getUint32(r); r += ver < 2 ? 2 : 4;
    for (let i = 0; i < count && r < iloc[1]; i++) {
      const id = ver < 2 ? v.getUint16(r) : v.getUint32(r); r += ver < 2 ? 2 : 4;
      let method = 0;
      if (ver >= 1) { method = v.getUint16(r) & 15; r += 2; }
      r += 2;                                  // data reference index
      const base = num(bs), extents = v.getUint16(r); r += 2;
      let first = null;
      for (let x = 0; x < extents; x++) { if (xs) num(xs); const off = num(os), len = num(ls); if (!first) first = [off, len]; }
      if (id === exifId && method === 0 && first) {
        const start = base + first[0], end = start + first[1];
        if (end > b.length || first[1] < 8) return null;
        const skip = v.getUint32(start);
        return b.subarray(start + 4 + skip, end);
      }
    }
    return null;
  }

  // Returns the raw TIFF block holding EXIF, if the file has one
  function exifTiff(b, kind) {
    try {
      if (kind === 'jpeg') {
        const s = jpegLayout(b).segs.find(x => isExifApp1(b, x));
        return s ? b.subarray(s.start + 10, s.end) : null;
      }
      if (kind === 'png') {
        const c = pngChunks(b).find(x => x.type === 'eXIf');
        return c ? b.subarray(c.data, c.data + c.len) : null;
      }
      if (kind === 'webp') {
        const c = webpChunks(b).find(x => x.type === 'EXIF');
        if (!c) return null;
        const t = b.subarray(c.data, c.data + c.len);
        return ascii(t, 0, 6) === 'Exif\0\0' ? t.subarray(6) : t;
      }
      if (kind === 'heic') return heicExif(b);
    } catch (_) {}
    return null;
  }

  /* What hidden details does this photo carry? */
  function readMeta(b, kind) {
    const t = readTiff(exifTiff(b, kind)) || {};
    const extras = [];
    try {
      if (kind === 'jpeg') {
        const { segs, eoi } = jpegLayout(b);
        if (segs.some(s => s.m === 0xE1 && ascii(b, s.start + 4, 4) === 'http')) extras.push('XMP');
        if (segs.some(s => s.m === 0xED)) extras.push('IPTC');
        if (segs.some(s => s.m === 0xFE)) extras.push('comment');
        if (eoi < b.length - 16) extras.push('extra images');
      } else if (kind === 'png') {
        if (pngChunks(b).some(c => /^(tEXt|zTXt|iTXt)$/.test(c.type))) extras.push('text notes');
      } else if (kind === 'webp') {
        if (webpChunks(b).some(c => c.type === 'XMP ')) extras.push('XMP');
      }
    } catch (_) {}
    const camera = [t.make, t.model].filter(Boolean)
      .reduce((a, x) => (a && x.toLowerCase().startsWith(a.toLowerCase()) ? x : a ? `${a} ${x}` : x), '');
    return {
      gps: !!t.gps, camera: camera || null, date: t.date || null, software: t.software || null,
      orientation: t.orientation || 1, extras,
      any: !!(t.gps || camera || t.date || t.software || extras.length),
    };
  }

  /* ── Lossless stripping ── */
  const concat = parts => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  };

  // A tiny EXIF block holding only the orientation, so the photo still shows upright
  function orientationApp1(o) {
    const t = [0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
    const body = [...'Exif\0\0'].map(c => c.charCodeAt(0)).concat(t);
    const len = body.length + 2;
    return new Uint8Array([0xFF, 0xE1, len >> 8, len & 255, ...body]);
  }

  function stripJpeg(b, orientation) {
    const { segs, sos, eoi } = jpegLayout(b);
    const keep = s => s.m < 0xE0 || s.m > 0xEF ? s.m !== 0xFE
      : s.m === 0xE0 || s.m === 0xEE || isIcc(b, s);
    const kept = segs.filter(keep).map(s => b.subarray(s.start, s.end));
    const at = segs.length && segs[0].m === 0xE0 ? 1 : 0;   // after JFIF if present
    if (orientation > 1 && orientation <= 8) kept.splice(at, 0, orientationApp1(orientation));
    return concat([b.subarray(0, 2), ...kept, b.subarray(sos, eoi)]);
  }

  function stripPng(b) {
    const drop = /^(tEXt|zTXt|iTXt|eXIf|tIME)$/;
    return concat([b.subarray(0, 8), ...pngChunks(b).filter(c => !drop.test(c.type)).map(c => b.subarray(c.start, c.end))]);
  }

  function stripWebp(b) {
    const chunks = webpChunks(b).filter(c => c.type !== 'EXIF' && c.type !== 'XMP ');
    const body = concat([b.subarray(8, 12), ...chunks.map(c => b.subarray(c.start, c.end))]);
    const out = concat([b.subarray(0, 4), new Uint8Array(4), body]);
    const v = new DataView(out.buffer);
    v.setUint32(4, out.length - 8, true);
    const x = webpChunks(out).find(c => c.type === 'VP8X');
    if (x) out[x.data] &= ~0x0C;                                    // clear EXIF and XMP flags
    return out;
  }

  function strip(b, kind, orientation) {
    if (kind === 'jpeg') return stripJpeg(b, orientation);
    if (kind === 'png')  return stripPng(b);
    if (kind === 'webp') return stripWebp(b);
    return null;
  }

  // Copy a photo's EXIF into a freshly encoded JPG, with orientation reset
  // (the pixels are already upright). Returns null if it will not fit.
  function withExif(jpg, tiff) {
    if (!tiff || tiff.length + 8 > 65535) return null;
    const t = tiff.slice();
    const info = readTiff(t);
    if (!info) return null;
    if (info.orientationAt >= 0) info.view.setUint16(info.orientationAt, 1, info.le);
    const len = t.length + 8;
    const head = new Uint8Array([0xFF, 0xE1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    const { segs } = jpegLayout(jpg);
    const cut = segs.length && segs[0].m === 0xE0 ? segs[0].end : 2;
    return concat([jpg.subarray(0, cut), head, t, jpg.subarray(cut)]);
  }

  /* ── ZIP (stored; photos are already compressed) ── */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  async function zip(files) {
    const enc = new TextEncoder(), now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4],
       [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]
        .forEach(([o, x, n]) => n === 4 ? lh.setUint32(o, x, true) : lh.setUint16(o, x, true));
      const ch = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4],
       [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2],
       [38, 0, 4], [42, offset, 4]]
        .forEach(([o, x, n]) => n === 4 ? ch.setUint32(o, x, true) : ch.setUint16(o, x, true));
      parts.push(new Uint8Array(lh.buffer), name, data);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, offset, 4], [20, 0, 2]]
      .forEach(([o, x, n]) => n === 4 ? end.setUint32(o, x, true) : end.setUint16(o, x, true));
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  /* ── Names and downloads ── */
  const baseName = n => String(n || 'image').replace(/\.[^./\\]+$/, '') || 'image';
  function uniqueNames(names) {
    const seen = new Map();
    return names.map(n => {
      const key = n.toLowerCase(), k = seen.get(key) || 0;
      seen.set(key, k + 1);
      return k ? n.replace(/(\.[^.]+)?$/, ` (${k + 1})$1`) : n;
    });
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return {
    sniff, decode, release, fitSize, toCanvas, encode, encodeToTarget, canEncodeWebp,
    readMeta, exifTiff, strip, withExif, zip, baseName, uniqueNames, download,
    LABEL, MIME, EXT, MAX_PX,
  };
})();

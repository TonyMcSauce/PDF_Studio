'use strict';
/* PDF Studio · Photo tools
   HEIC to JPG, Convert Image, Resize & Compress and Remove Photo Details.
   One engine drives all four; each tool only changes which options it shows
   and their defaults. The preview area becomes a gallery while one is open.
   Shares globals (S, $, show, hide, toast, loading, okSize, escHtml, fmtSize)
   from core.js and the IK toolkit from imagekit.js. */

const PHOTO_ANY = 'image/*,.heic,.heif,.avif';

const PHOTO_TOOLS = {
  heic: {
    title: 'HEIC to JPG', icon: 'fa-mobile-screen-button',
    desc: 'Turn iPhone photos into JPGs that open on any device or website.',
    accept: '.heic,.heif,image/heic,image/heif,' + PHOTO_ANY, drop: 'Drop HEIC photos here', pick: 'Add Photos',
    controls: ['quality'], format: 'jpeg', quality: 90,
    verb: 'Converting', done: 'Converted', action: 'Convert to JPG &amp; Download', zip: 'heic-to-jpg',
  },
  convertimg: {
    title: 'Convert Image', icon: 'fa-arrow-right-arrow-left',
    desc: 'Switch photos between JPG, PNG and WebP. HEIC and AVIF photos open too.',
    accept: PHOTO_ANY, drop: 'Drop photos here (HEIC, JPG, PNG, WebP)', pick: 'Add Photos',
    controls: ['format', 'quality', 'resize', 'strip'], format: 'jpeg', quality: 85, resize: 'none',
    verb: 'Converting', done: 'Converted', action: 'Convert &amp; Download', zip: 'converted-images',
  },
  resizeimg: {
    title: 'Resize &amp; Compress', icon: 'fa-down-left-and-up-right-to-center',
    desc: 'Make photos smaller for email, forms and uploads. Pick a size, a target file size, or both.',
    accept: PHOTO_ANY, drop: 'Drop photos here', pick: 'Add Photos',
    controls: ['formatSame', 'resize', 'target', 'quality'], format: 'same', quality: 80, resize: 'long', resizeVal: 1920,
    verb: 'Resizing', done: 'Resized', action: 'Resize &amp; Download', zip: 'resized-images',
  },
  cleanimg: {
    title: 'Remove Photo Details', icon: 'fa-user-shield',
    desc: 'Strip GPS location, camera model, dates and other hidden details before you share. JPG, PNG and WebP photos are cleaned without re-compressing, so quality is untouched.',
    accept: PHOTO_ANY, drop: 'Drop photos here', pick: 'Add Photos',
    controls: [], format: 'same',
    verb: 'Cleaning', done: 'Cleaned', action: 'Remove Details &amp; Download', zip: 'cleaned-images',
  },
};

const PH = {};               // per-tool state: { items, chain }
let phSeq = 0;

/* ── Panel markup ── */
function phControls(m, cfg) {
  const id = s => `${m}${s}`;
  const webp = IK.canEncodeWebp() ? '' : ' disabled';
  const webpNote = IK.canEncodeWebp() ? '' : ' (not in this browser)';
  const parts = [];
  const fmt = [];
  if (cfg.controls.includes('formatSame')) fmt.push(`<option value="same" selected>Keep original format</option>`);
  if (cfg.controls.includes('format') || cfg.controls.includes('formatSame')) {
    fmt.push(`<option value="jpeg"${cfg.format === 'jpeg' ? ' selected' : ''}>JPG</option>`,
             `<option value="png">PNG</option>`,
             `<option value="webp"${webp}>WebP${webpNote}</option>`);
    parts.push(`<div class="form-group"><label for="${id('Format')}">Save as</label>
      <select id="${id('Format')}" class="input">${fmt.join('')}</select></div>`);
  }
  if (cfg.controls.includes('resize')) {
    const r = cfg.resize || 'none';
    parts.push(`<div class="form-row">
      <div class="form-group"><label for="${id('Resize')}">Size</label>
        <select id="${id('Resize')}" class="input">
          <option value="none"${r === 'none' ? ' selected' : ''}>Original size</option>
          <option value="long"${r === 'long' ? ' selected' : ''}>Longest side</option>
          <option value="pct">Percentage</option>
        </select></div>
      <div class="form-group" id="${id('ResizeValWrap')}"><label for="${id('ResizeVal')}" id="${id('ResizeValLabel')}">Pixels</label>
        <input type="number" id="${id('ResizeVal')}" class="input" min="1" value="${cfg.resizeVal || 1920}"/></div>
    </div>`);
  }
  if (cfg.controls.includes('target')) {
    parts.push(`<div class="form-group"><label for="${id('Target')}">Target file size</label>
      <select id="${id('Target')}" class="input">
        <option value="0" selected>No target</option>
        <option value="204800">Under 200 KB</option>
        <option value="512000">Under 500 KB</option>
        <option value="1048576">Under 1 MB</option>
        <option value="2097152">Under 2 MB</option>
        <option value="5242880">Under 5 MB</option>
      </select></div>`);
  }
  if (cfg.controls.includes('quality')) {
    parts.push(`<div class="form-group" id="${id('QualityWrap')}">
      <label for="${id('Quality')}">Quality: <span id="${id('QualityVal')}">${cfg.quality}%</span></label>
      <input type="range" id="${id('Quality')}" min="40" max="100" value="${cfg.quality}" class="range-input full"/></div>`);
  }
  if (cfg.controls.includes('strip')) {
    parts.push(`<label class="check-row"><input type="checkbox" id="${id('Strip')}" checked/> Remove location and camera details</label>`);
  }
  parts.push(`<p class="hint" id="${id('Hint')}"></p>`);
  return parts.join('\n');
}

function phBuildPanel(m) {
  const cfg = PHOTO_TOOLS[m], el = $(`panel-${m}`);
  el.innerHTML = `
    <h2 class="panel-title"><i class="fa-solid ${cfg.icon}"></i> ${cfg.title}</h2>
    <p class="panel-desc">${cfg.desc}</p>
    <div class="tool-upload-zone" id="${m}Zone">
      <i class="fa-solid fa-images"></i>
      <p>${cfg.drop}</p>
      <input type="file" id="${m}Input" accept="${cfg.accept}" multiple hidden/>
      <button class="btn-primary" type="button" data-pick><i class="fa-solid fa-plus"></i> ${cfg.pick}</button>
    </div>
    <div class="photo-summary hidden" id="${m}Summary">
      <span id="${m}SummaryText"></span>
      <button class="fi-change" type="button" data-clear>Clear all</button>
    </div>
    ${phControls(m, cfg)}
    <button id="${m}Btn" class="btn-action" disabled><i class="fa-solid fa-download"></i> ${cfg.action}</button>
    <p class="hint photo-local"><i class="fa-solid fa-laptop" aria-hidden="true"></i> Photos are processed on this device and never uploaded.</p>`;

  PH[m] = { items: [], chain: Promise.resolve() };
  const input = $(`${m}Input`), zone = $(`${m}Zone`);
  el.querySelector('[data-pick]').addEventListener('click', () => input.click());
  el.querySelector('[data-clear]').addEventListener('click', () => phClear(m));
  input.addEventListener('change', e => { phAdd(m, e.target.files); e.target.value = ''; });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); phAdd(m, e.dataTransfer.files); });
  $(`${m}Btn`).addEventListener('click', () => phRun(m));

  // Any option change makes earlier results stale
  el.querySelectorAll('select, input[type=range], input[type=number], input[type=checkbox]').forEach(c =>
    c.addEventListener(c.type === 'range' ? 'input' : 'change', () => phOptionsChanged(m)));
  phOptionsChanged(m, true);
}

function phOpts(m) {
  const cfg = PHOTO_TOOLS[m], v = id => $(`${m}${id}`);
  const resizeMode = v('Resize') ? v('Resize').value : 'none';
  return {
    format:  v('Format') ? v('Format').value : cfg.format,
    quality: v('Quality') ? +v('Quality').value / 100 : 0.92,
    resize:  { mode: resizeMode, value: v('ResizeVal') ? Math.max(1, +v('ResizeVal').value || 0) : 0 },
    target:  v('Target') ? +v('Target').value : 0,
    strip:   v('Strip') ? v('Strip').checked : true,
  };
}

function phOptionsChanged(m, initial) {
  const v = id => $(`${m}${id}`), o = phOpts(m);
  if (v('QualityVal')) v('QualityVal').textContent = Math.round(o.quality * 100) + '%';
  if (v('ResizeValWrap')) {
    v('ResizeValWrap').classList.toggle('hidden', o.resize.mode === 'none');
    const pct = o.resize.mode === 'pct';
    v('ResizeValLabel').textContent = pct ? 'Percent' : 'Pixels';
    v('ResizeVal').max = pct ? 100 : 20000;
    if (!initial && pct && +v('ResizeVal').value > 100) v('ResizeVal').value = 50;
    if (!initial && !pct && +v('ResizeVal').value <= 100) v('ResizeVal').value = 1920;
  }
  const png = o.format === 'png';
  if (v('QualityWrap')) v('QualityWrap').classList.toggle('hidden', png || o.target > 0);

  const hint = [];
  if (m === 'heic') hint.push('Other photo types work too and also come out as JPG. Location and camera details are left behind.');
  if (m === 'cleanimg') hint.push('HEIC and AVIF photos have to be re-saved, so they come out as high quality JPGs. Photos keep their correct rotation.');
  if (png && (v('Quality') || v('Target'))) hint.push('PNG is lossless, so quality and file size targets do not apply.');
  if (o.format === 'same' && o.target) hint.push('HEIC photos are saved as JPG. Target sizes apply to JPG and WebP.');
  if (v('Strip') && !o.strip && o.format !== 'jpeg') hint.push('Details can only be kept when saving as JPG.');
  if (v('Hint')) v('Hint').textContent = hint.join(' ');

  if (!initial) {
    PH[m].items.forEach(it => { if (it.result) { it.result = null; it.status = it.w ? 'ready' : it.status; } });
    if (S.activeTool === m) phRenderGallery(m);
  }
}

/* ── Adding photos ── */
async function phAdd(m, files) {
  const st = PH[m];
  for (const f of Array.from(files || [])) {
    if (!okSize(f)) continue;
    const kind = await IK.sniff(f);
    if (!kind) { toast(`"${f.name}" is not a photo this tool can read.`, 'error'); continue; }
    const item = { id: ++phSeq, file: f, kind, name: f.name, size: f.size, status: 'loading' };
    st.items.push(item);
    st.chain = st.chain.then(() => phPrepare(m, item));
  }
  phRenderAll(m);
}

async function phPrepare(m, item) {
  if (!PH[m].items.includes(item)) return;
  try {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    item.meta = IK.readMeta(bytes, item.kind);
    const d = await IK.decode(item.file, item.kind);
    item.w = d.width; item.h = d.height;
    const t = IK.fitSize(d.width, d.height, { mode: 'long', value: 360 });
    const cv = IK.toCanvas(d, t.width, t.height);
    IK.release(d);
    item.thumb = URL.createObjectURL(await IK.encode(cv, 'image/png'));
    item.status = 'ready';
  } catch (e) {
    console.warn(e);
    item.status = 'error'; item.error = e.message || 'Could not open this photo';
  }
  phRenderCard(m, item);
  phRenderSummary(m);
}

function phRemove(m, id) {
  const st = PH[m], it = st.items.find(i => i.id === id);
  if (!it) return;
  if (it.thumb) URL.revokeObjectURL(it.thumb);
  st.items = st.items.filter(i => i !== it);
  phRenderAll(m);
}
function phClear(m) {
  PH[m].items.forEach(i => i.thumb && URL.revokeObjectURL(i.thumb));
  PH[m].items = [];
  phRenderAll(m);
}

/* ── Processing ── */
async function phProcess(m, item, o) {
  const bytes = new Uint8Array(await item.file.arrayBuffer());
  const base = IK.baseName(item.name);
  const ext = (item.name.match(/\.([^.]+)$/) || [])[1];

  if (m === 'cleanimg' && IK.MIME[item.kind]) {
    const out = IK.strip(bytes, item.kind, item.meta.orientation);
    return { blob: new Blob([out], { type: IK.MIME[item.kind] }), name: `${base}.${ext || IK.EXT[item.kind]}`,
             width: item.w, height: item.h, format: item.kind, lossless: true };
  }

  const fmt = o.format === 'same' ? (IK.MIME[item.kind] ? item.kind : 'jpeg') : o.format;
  const mime = IK.MIME[fmt];
  const bg = fmt === 'jpeg' ? '#ffffff' : null;
  const d = await IK.decode(item.file, item.kind);
  const size = IK.fitSize(d.width, d.height, m === 'cleanimg' ? null : o.resize);
  let res;
  try {
    if (o.target && fmt !== 'png') {
      res = await IK.encodeToTarget(d, size, mime, o.target, bg);
    } else {
      const q = m === 'cleanimg' ? 0.92 : o.quality;
      res = { blob: await IK.encode(IK.toCanvas(d, size.width, size.height, bg), mime, fmt === 'png' ? undefined : q), ...size };
    }
  } finally { IK.release(d); }

  // Re-encoding a photo in its own format at its own size should never make it bigger
  if (m === 'resizeimg' && fmt === item.kind && res.width === item.w && res.height === item.h && res.blob.size >= item.size) {
    const out = IK.strip(bytes, item.kind, item.meta.orientation);
    return { blob: new Blob([out], { type: mime }), name: `${base}.${ext || IK.EXT[fmt]}`,
             width: item.w, height: item.h, format: fmt, note: 'Already compact, original quality kept' };
  }

  let kept = false;
  if (!o.strip && fmt === 'jpeg') {
    const merged = IK.withExif(new Uint8Array(await res.blob.arrayBuffer()), IK.exifTiff(bytes, item.kind));
    if (merged) { res.blob = new Blob([merged], { type: mime }); kept = true; }
  }
  return {
    blob: res.blob, name: `${base}.${IK.EXT[fmt]}`, width: res.width, height: res.height, format: fmt, kept,
    note: res.missed ? 'Could not reach the target size' : res.scaled ? 'Made smaller to reach the target size' : '',
  };
}

async function phRun(m) {
  const st = PH[m], cfg = PHOTO_TOOLS[m], o = phOpts(m);
  if (o.resize.mode !== 'none' && !(o.resize.value > 0)) { toast('Enter a size first.', 'error'); return; }
  loading(true, 'Reading photos…');
  await st.chain;
  const todo = st.items.filter(i => i.status !== 'error');
  if (!todo.length) { loading(false); toast('Add a photo first.', 'error'); return; }
  const done = [];
  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    loading(true, `${cfg.verb} ${i + 1} / ${todo.length}…`);
    try {
      it.result = await phProcess(m, it, o);
      it.status = 'done';
      done.push(it);
    } catch (e) {
      console.warn(e);
      it.result = null; it.status = 'error'; it.error = e.message || 'Could not convert this photo';
    }
    phRenderCard(m, it);
  }
  loading(false);
  phRenderSummary(m);
  if (!done.length) { toast('None of these photos could be processed.', 'error'); return; }

  const names = IK.uniqueNames(done.map(i => i.result.name));
  done.forEach((it, k) => { it.result.name = names[k]; });
  try {
    if (done.length === 1) IK.download(done[0].result.blob, done[0].result.name);
    else {
      loading(true, 'Packing ZIP…');
      IK.download(await IK.zip(done.map(i => ({ name: i.result.name, data: i.result.blob }))), `${cfg.zip}.zip`);
    }
  } finally { loading(false); }

  const before = done.reduce((n, i) => n + i.size, 0), after = done.reduce((n, i) => n + i.result.blob.size, 0);
  const failed = todo.length - done.length;
  const what = `${done.length} photo${done.length === 1 ? '' : 's'}`;
  toast(`${cfg.done} ${what} · ${fmtSize(before)} → ${fmtSize(after)}${failed ? ` · ${failed} could not be read` : ''}`,
        failed ? 'info' : 'success', 6000);
}

/* ── Rendering ── */
function phChips(it, removed) {
  const md = it.meta;
  if (!md) return '';
  if (!md.any) return `<span class="photo-chip is-clean"><i class="fa-solid fa-check" aria-hidden="true"></i> No hidden details found</span>`;
  const chips = [];
  if (md.gps)      chips.push(['fa-location-dot', 'Location', true]);
  if (md.camera)   chips.push(['fa-camera', md.camera]);
  if (md.date)     chips.push(['fa-calendar', 'Date taken']);
  if (md.software) chips.push(['fa-wand-magic-sparkles', md.software]);
  if (md.extras.length) chips.push(['fa-tags', md.extras.join(', ')]);
  return chips.map(([ic, label, warn]) =>
    `<span class="photo-chip${warn ? ' is-warn' : ''}${removed ? ' is-removed' : ''}" title="${removed ? 'Removed' : 'Found in this photo'}">` +
    `<i class="fa-solid ${ic}" aria-hidden="true"></i> ${escHtml(label)}</span>`).join('');
}

function phCardHtml(m, it) {
  const r = it.result;
  const thumb = it.status === 'loading' ? `<span class="photo-spin" aria-label="Reading photo"></span>`
    : it.thumb ? `<img src="${it.thumb}" alt=""/>`
    : `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>`;
  const dims = it.w ? `${it.w} × ${it.h} · ` : '';
  let line = '';
  if (it.status === 'error') line = `<div class="photo-result is-error">${escHtml(it.error || 'Could not open this photo')}</div>`;
  else if (r) {
    const pct = Math.round((1 - r.blob.size / it.size) * 100);
    const delta = pct > 0 ? ` · <b>−${pct}%</b>` : pct < 0 ? ` · +${-pct}%` : '';
    const dim = r.width !== it.w || r.height !== it.h ? ` · ${r.width} × ${r.height}` : '';
    line = `<div class="photo-result"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>
      ${IK.LABEL[r.format]} · ${fmtSize(r.blob.size)}${delta}${dim}</div>`;
    const note = r.lossless ? 'Cleaned with no quality loss' : r.kept ? 'Camera details kept' : r.note;
    if (note) line += `<div class="photo-note">${escHtml(note)}</div>`;
  }
  const stripping = m !== 'convertimg' || phOpts(m).strip;
  const showChips = m === 'cleanimg' || (it.meta && it.meta.any);
  const chips = showChips ? `<div class="photo-chips">${phChips(it, !!r && stripping && !r.kept)}</div>` : '';
  return `
    <div class="photo-thumb">${thumb}<span class="photo-badge">${IK.LABEL[it.kind] || ''}</span></div>
    <div class="photo-body">
      <div class="photo-name" title="${escHtml(it.name)}">${escHtml(it.name)}</div>
      <div class="photo-sub">${dims}${fmtSize(it.size)}</div>
      ${line}${chips}
    </div>
    <div class="photo-actions">
      ${r ? `<button class="icon-btn" data-dl="${it.id}" aria-label="Download ${escHtml(r.name)}" title="Download"><i class="fa-solid fa-download" aria-hidden="true"></i></button>` : ''}
      <button class="icon-btn danger" data-rm="${it.id}" aria-label="Remove ${escHtml(it.name)}" title="Remove"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>`;
}

function phRenderCard(m, it) {
  if (S.activeTool !== m) return;
  const li = $('photoGallery').querySelector(`[data-id="${it.id}"]`);
  if (li) { li.className = `photo-card is-${it.status}`; li.innerHTML = phCardHtml(m, it); }
}

function phRenderGallery(m) {
  const g = $('photoGallery'), items = PH[m].items;
  $('photoEmpty').classList.toggle('hidden', items.length > 0);
  g.innerHTML = items.map(it => `<li class="photo-card is-${it.status}" data-id="${it.id}">${phCardHtml(m, it)}</li>`).join('');
}

function phRenderSummary(m) {
  const items = PH[m].items, ok = items.filter(i => i.status !== 'error');
  const sum = $(`${m}Summary`);
  sum.classList.toggle('hidden', !items.length);
  $(`${m}SummaryText`).textContent = items.length
    ? `${items.length} photo${items.length === 1 ? '' : 's'} · ${fmtSize(items.reduce((n, i) => n + i.size, 0))}` : '';
  const btn = $(`${m}Btn`);
  btn.disabled = !ok.length;
  const cfg = PHOTO_TOOLS[m];
  btn.innerHTML = `<i class="fa-solid fa-download"></i> ${cfg.action}${ok.length > 1 ? ` <span class="btn-count">${ok.length}</span>` : ''}`;
  if (S.activeTool === m) $('photoCount').textContent = items.length ? `Photos · ${items.length}` : 'Photos';
}

function phRenderAll(m) {
  phRenderSummary(m);
  if (S.activeTool === m) phRenderGallery(m);
}

$('photoGallery').addEventListener('click', e => {
  const m = S.activeTool; if (!PH[m]) return;
  const rm = e.target.closest('[data-rm]'), dl = e.target.closest('[data-dl]');
  if (rm) phRemove(m, +rm.dataset.rm);
  if (dl) {
    const it = PH[m].items.find(i => i.id === +dl.dataset.dl);
    if (it && it.result) IK.download(it.result.blob, it.result.name);
  }
});

/* Called by activatePanel in core.js */
function photoActivate(name) {
  const on = name in PHOTO_TOOLS;
  document.querySelector('.preview-area').classList.toggle('photo-mode', on);
  if (on) { phRenderGallery(name); phRenderSummary(name); }
  else $('photoGallery').innerHTML = '';
}

Object.keys(PHOTO_TOOLS).forEach(phBuildPanel);

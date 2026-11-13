'use strict';
/**
 * PDF Studio v7
 * Key changes from v6:
 *  - Each tool panel has its own independent upload drop zone
 *  - Home button always visible in header when in editor
 *  - Shared "active PDF" per-tool, switching tools doesn't lose your file
 *  - Merge has its own multi-file upload (no shared PDF needed)
 *  - Images→PDF has its own image upload (no PDF needed)
 */

/* ── CONFIG ── */
const CFG = {
  SERVER_URL: 'https://pdf-studio-server-1.onrender.com',
  MAX_MB: 100,
  WORKER: 'vendor/pdfjs/pdf.worker.min.js',
  RENDER_SCALE: 2.0,
  OVERLAY_SCALE: 3.0,
  PREVIEW_SCALE: 1.4,
  THUMB_SCALE: 0.9,
  ZOOM_STEP: 0.25, ZOOM_MIN: 0.25, ZOOM_MAX: 3.0,
};
pdfjsLib.GlobalWorkerOptions.workerSrc = CFG.WORKER;

/* ── STATE ── */
const S = {
  // Each tool stores its own pages array independently
  toolPages: {},      // { toolName: [pageDesc, ...] }
  activeTool: null,

  // Convenience getters for current tool's pages
  get pages() { return S.toolPages[S.activeTool] || []; },
  set pages(v) { S.toolPages[S.activeTool] = v; },
  get totalPages() { return S.pages.length; },

  curPage: 1, zoom: 1.0, isDark: true,
  selectedPgs: new Set(),

  mergeSources: [], _mergeViewIdx: 0,
  imgToPdfFiles: [],

  sigDrawing: false, placeMode: null,
  annoteTool: 'freehand',
  annoteStrokes: [], annoteDrawing: false,
  annoteStart: null, annoteCurStroke: null,
  redactBoxes: [], redactDrawing: false, redactStart: null,
  compressQuality: 0.92,
};

/* ── HELPERS ── */
const $ = id => document.getElementById(id);
const show = el => el && el.classList.remove('hidden');
const hide = el => el && el.classList.add('hidden');

function toast(msg, type = 'info', ms = 4500) {
  const t = $('toast');
  t.textContent = msg; t.className = `toast ${type}`;
  show(t); clearTimeout(t._t);
  t._t = setTimeout(() => hide(t), ms);
}
function loading(on, txt = 'Processing…') {
  $('loadingText').textContent = txt;
  on ? show($('loadingOverlay')) : hide($('loadingOverlay'));
}
function mkTimeout(ms) {
  // AbortSignal.timeout is not available in all browsers; use controller fallback
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/* Render's free tier sleeps when idle. Nudge it awake as soon as a
   server-backed tool is opened so the real request doesn't stall. */
const SERVER_TOOLS = new Set(['security', 'pdftoword', 'pdftoexcel', 'pdftopptx']);
let _lastWake = 0;
function wakeServer() {
  if (Date.now() - _lastWake < 5 * 60 * 1000) return;
  _lastWake = Date.now();
  fetch(`${CFG.SERVER_URL}/ping`, { mode: 'cors', signal: mkTimeout(60000) }).catch(() => {});
}

function escHtml(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function okSize(f) {
  if (f.size / 1048576 > CFG.MAX_MB) { toast(`Too large (max ${CFG.MAX_MB} MB).`, 'error'); return false; }
  return true;
}
function okPage(n) {
  if (!Number.isFinite(n) || n < 1 || n > S.totalPages) {
    toast(`Page must be 1–${S.totalPages}.`, 'error'); return false;
  }
  return true;
}
window.togglePwd = id => { const e = $(id); e.type = e.type === 'password' ? 'text' : 'password'; };

function loadImgEl(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = URL.createObjectURL(file);
  });
}
function dataUrlToBytes(du) {
  const b = atob(du.split(',')[1]), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
function dlBytes(bytes, name) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/* ── THEME ── */
function applyTheme(dark) {
  S.isDark = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const t = $('themeToggle');
  t.innerHTML = dark ? '<i class="fa-solid fa-sun" aria-hidden="true"></i>' : '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
  t.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  try { localStorage.setItem('pdfstudio-theme', dark ? 'dark' : 'light'); } catch (_) {}
}
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('pdfstudio-theme'); } catch (_) {}
  applyTheme(saved ? saved === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches);
})();
$('themeToggle').addEventListener('click', () => applyTheme(!S.isDark));

/* ── SCREEN SWITCHING ── */
function showHome() {
  show($('homeScreen')); hide($('editorScreen'));
  hide($('homeBtn'));
  exitAnnotateMode(); exitRedactMode();
  if (typeof wmDeactivate === 'function') wmDeactivate();
  if (typeof sigDeactivate === 'function') sigDeactivate();
  if (typeof tbExit === 'function') tbExit();
  if (typeof imDeactivate === 'function') imDeactivate();
}
function showEditor(tool) {
  hide($('homeScreen')); show($('editorScreen'));
  show($('homeBtn'));
  activatePanel(tool);
}
$('goHome').addEventListener('click', showHome);
$('homeBtn').addEventListener('click', showHome);
document.querySelectorAll('.tool-card, [data-open-tool]').forEach(card => {
  card.addEventListener('click', () => showEditor(card.dataset.tool || card.dataset.openTool));
});

/* ── PANEL ACTIVATION ── */
function activatePanel(name) {
  S.activeTool = name;
  if (SERVER_TOOLS.has(name)) wakeServer();
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));

  // Sync preview to this tool's pages if loaded
  if (S.pages.length) {
    S.curPage = Math.max(1, Math.min(S.curPage, S.totalPages));
    previewMain(S.curPage);
    updateDownloadBtn();
  } else {
    hide($('previewCanvas')); show($('previewPlaceholder'));
    $('pageIndicator').textContent = '- / -';
    updateDownloadBtn();
  }

  if (name === 'pages' && S.pages.length) renderGrid();
  if (name === 'merge') refreshMergePreview();
  if (name === 'annotate' && S.pages.length) enterAnnotateMode(); else exitAnnotateMode();
  if (name === 'redact'   && S.pages.length) enterRedactMode();   else exitRedactMode();
  if (typeof tbCheckEnter === 'function') tbCheckEnter();

  // Each tool owns its own preview layers; switch them over cleanly however
  // the tool was opened (rail, home grid or hero button).
  $('previewWrap').scrollTop = 0;
  if (typeof wmDeactivate === 'function') {
    if (name === 'watermark' && S.toolPages.watermark?.length) setTimeout(wmActivate, 50); else wmDeactivate();
  }
  if (typeof sigDeactivate === 'function') {
    if (name === 'signature' && S.toolPages.signature?.length) setTimeout(() => { if (!SIG.active) sigActivate(); }, 50); else sigDeactivate();
  }
  if (typeof imDeactivate === 'function') { if (name === 'image' && S.toolPages.image?.length) setTimeout(imActivate, 50); else imDeactivate(); }
  if (S.placeMode && typeof setPlaceMode === 'function') setPlaceMode(null);
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => showEditor(btn.dataset.panel));
});

/* ── PER-TOOL PDF UPLOAD ── */
/**
 * Generic function to wire up a tool's upload zone.
 * toolName: key in S.toolPages
 * inputId:  <input type="file"> id
 * zoneId:   drop zone div id
 * infoId:   file info badge div id
 * controlsId: controls to reveal after upload (optional)
 * onLoaded:  callback after pages built
 */
// Map each toolName to its action button id
const TOOL_ACTION_BTN = {
  split:       'splitBtn',
  compress:    'compressBtn',
  pages:       null,   // no single action btn (grid-based)
  annotate:    'annotateApplyBtn',
  text:        'addTextBtn',
  image:       'addImageBtn',
  watermark:   'wmBtn',
  pagenumbers: 'pnBtn',
  redact:      'redactApplyBtn',
  signature:   'addSigBtn',
  security:    'applyPwdBtn',
};

function wirePdfUpload({ toolName, inputId, zoneId, infoId, controlsId }) {
  const input = $(inputId);
  const zone  = $(zoneId);
  const info  = $(infoId);

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') { toast('Please select a valid PDF.', 'error'); return; }
    if (!okSize(file)) return;
    loading(true, 'Loading PDF…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc   = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      if (toolName === 'compress') S.compressOrigSize = file.size;
      S.toolPages[toolName] = Array.from({ length: doc.numPages }, (_, i) => ({
        pdfJsDoc: doc, pageNum: i + 1, rotation: 0, overlays: [],
      }));
      // Show file badge
      info.innerHTML = `
        <i class="fa-solid fa-file-pdf fi-icon"></i>
        <div style="flex:1;min-width:0">
          <div class="fi-name">${escHtml(file.name)}</div>
          <div class="fi-size">${fmtSize(file.size)} · ${doc.numPages} pages</div>
        </div>
        <button class="fi-change" onclick="resetToolUpload('${toolName}','${inputId}','${zoneId}','${infoId}','${controlsId}')">Change</button>`;
      hide(zone); show(info);
      if (controlsId) show($(controlsId));

      // Enable this tool's action button
      const btnId = TOOL_ACTION_BTN[toolName];
      if (btnId) { const b = $(btnId); if (b) b.disabled = false; }

      // If this is the active tool, update preview
      if (S.activeTool === toolName) {
        S.curPage = 1;
        await fitZoomToWidth(S.toolPages[toolName][0]);
        await previewMain(1);
        updateDownloadBtn();
        if (toolName === 'pages')    { show($('pagesToolbar')); renderGrid(); }
        if (toolName === 'annotate') enterAnnotateMode();
        if (toolName === 'redact')   enterRedactMode();
        if (toolName === 'split')    updateSplitHint();
        if (toolName === 'text')     tbCheckEnter();
        if (toolName === 'watermark') setTimeout(() => { if (typeof wmActivate==='function') wmActivate(); }, 50);
        if (toolName === 'signature') setTimeout(() => { if (typeof sigActivate==='function') sigActivate(); }, 50);
        if (toolName === 'image') setTimeout(() => { if (typeof imActivate==='function') imActivate(); }, 50);
      }
      toast(`Loaded "${file.name}", ${doc.numPages} pages`, 'success');
    } catch (e) { console.error(e); toast(`Load failed: ${e.message}`, 'error'); }
    finally { loading(false); }
  }

  input.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
}

window.resetToolUpload = (toolName, inputId, zoneId, infoId, controlsId) => {
  S.toolPages[toolName] = [];
  $(inputId).value = '';
  show($(zoneId)); hide($(infoId));
  if (controlsId) hide($(controlsId));
  // Disable the tool's action button
  const btnId = TOOL_ACTION_BTN[toolName];
  if (btnId) { const b = $(btnId); if (b) b.disabled = true; }
  if (S.activeTool === toolName) {
    hide($('previewCanvas')); show($('previewPlaceholder'));
    $('pageIndicator').textContent = '- / -';
    updateDownloadBtn();
    exitAnnotateMode(); exitRedactMode();
    if (toolName === 'watermark' && typeof wmDeactivate === 'function') wmDeactivate();
  }
};

// Wire every tool that needs a single PDF
wirePdfUpload({ toolName:'split',      inputId:'splitFileInput',      zoneId:'splitUploadZone',      infoId:'splitFileInfo',      controlsId:null });
wirePdfUpload({ toolName:'compress',   inputId:'compressFileInput',   zoneId:'compressUploadZone',   infoId:'compressFileInfo',   controlsId:null });
wirePdfUpload({ toolName:'pages',      inputId:'pagesFileInput',      zoneId:'pagesUploadZone',      infoId:'pagesFileInfo',      controlsId:'pagesToolbar' });
wirePdfUpload({ toolName:'annotate',   inputId:'annotateFileInput',   zoneId:'annotateUploadZone',   infoId:'annotateFileInfo',   controlsId:'annotateControls' });
wirePdfUpload({ toolName:'text',       inputId:'textFileInput',       zoneId:'textUploadZone',       infoId:'textFileInfo',       controlsId:'textControls' });
wirePdfUpload({ toolName:'image',      inputId:'pdfImageFileInput',   zoneId:'imageUploadZone',      infoId:'imageFileInfo',      controlsId:'imageControls' });
wirePdfUpload({ toolName:'watermark',  inputId:'watermarkFileInput',  zoneId:'watermarkUploadZone',  infoId:'watermarkFileInfo',  controlsId:'watermarkControls' });
wirePdfUpload({ toolName:'pagenumbers',inputId:'pnFileInput',         zoneId:'pnUploadZone',         infoId:'pnFileInfo',         controlsId:'pnControls' });
wirePdfUpload({ toolName:'redact',     inputId:'redactFileInput',     zoneId:'redactUploadZone',     infoId:'redactFileInfo',     controlsId:'redactControls' });
wirePdfUpload({ toolName:'signature',  inputId:'signatureFileInput',  zoneId:'signatureUploadZone',  infoId:'signatureFileInfo',  controlsId:'signatureControls' });
wirePdfUpload({ toolName:'security',   inputId:'securityFileInput',   zoneId:'securityUploadZone',   infoId:'securityFileInfo',   controlsId:'securityControls' });

/* ── RENDER ENGINE ── */
async function renderPageToCanvas(desc, scale) {
  const pdfPage = await desc.pdfJsDoc.getPage(desc.pageNum);
  const baseVp  = pdfPage.getViewport({ scale: 1 });
  const rotation = (baseVp.rotation + desc.rotation) % 360;
  const vp      = pdfPage.getViewport({ scale, rotation });
  const cv      = document.createElement('canvas');
  cv.width  = Math.ceil(vp.width);
  cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
  drawOverlaysOnCanvas(cv, desc.overlays, vp);
  return { canvas: cv, viewport: vp };
}

function drawOverlaysOnCanvas(canvas, overlays, vp) {
  if (!overlays?.length) return;
  const ctx = canvas.getContext('2d'), sc = vp.scale;
  overlays.forEach(o => {
    ctx.save();
    if (o.type === 'text') {
      ctx.font      = canvasFont(o, sc);
      ctx.fillStyle = o.color || '#000';
      ctx.textAlign = 'left';
      layoutText(o, str => ctx.measureText(str).width / sc)
        .forEach(l => ctx.fillText(l.str, l.x * sc, l.y * sc));
    } else if (o.type === 'image' || o.type === 'signature') {
      if (o.imgEl) { ctx.globalAlpha = o.opacity ?? 1; ctx.drawImage(o.imgEl, o.x*sc, o.y*sc, o.w*sc, o.h*sc); }
    } else if (o.type === 'watermark') {
      const cW = canvas.width, cH = canvas.height;
      // Use fractional position if set, else default to centre
      const cx = o.xFrac !== undefined ? cW * o.xFrac : cW / 2;
      const cy = o.yFrac !== undefined ? cH * o.yFrac : cH / 2;
      ctx.globalAlpha = o.opacity;
      ctx.translate(cx, cy);
      ctx.rotate((o.angle || 0) * Math.PI / 180);
      if (o.imgEl) {
        ctx.drawImage(o.imgEl, -o.w*sc/2, -o.h*sc/2, o.w*sc, o.h*sc);
      } else {
        const weight = o.bold   ? 'bold '   : '';
        const style  = o.italic ? 'italic ' : '';
        ctx.font         = `${style}${weight}${(o.size||60) * sc}px ${o.font||'Arial'}`;
        ctx.fillStyle    = o.color || '#000';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(o.text, 0, 0);
      }
    } else if (o.type === 'pagenumber' || o.type === 'pagenumber_preview') {
      ctx.font = `${o.size * sc}px Arial`; ctx.fillStyle = o.color || '#333';
      ctx.textAlign = o.align || 'center';
      ctx.fillText(o.text, o.x * sc, o.y * sc);
    } else if (o.type === 'annotation') {
      drawAnnotation(ctx, o, sc);
    } else if (o.type === 'redact') {
      ctx.fillStyle = o.color || '#000';
      ctx.fillRect(o.x*sc, o.y*sc, o.w*sc, o.h*sc);
    }
    ctx.restore();
  });
}

function drawAnnotation(ctx, o, sc) {
  ctx.strokeStyle = o.color; ctx.lineWidth = o.size * sc;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (o.tool === 'freehand') {
    if (!o.points?.length) return;
    ctx.beginPath(); ctx.moveTo(o.points[0].x*sc, o.points[0].y*sc);
    o.points.slice(1).forEach(p => ctx.lineTo(p.x*sc, p.y*sc)); ctx.stroke();
  } else if (o.tool === 'highlight') {
    ctx.globalAlpha = 0.35; ctx.fillStyle = o.color;
    ctx.fillRect(o.x*sc, o.y*sc, o.w*sc, o.h*sc);
  } else if (o.tool === 'rect') {
    ctx.strokeRect(o.x*sc, o.y*sc, o.w*sc, o.h*sc);
  } else if (o.tool === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse((o.x+o.w/2)*sc, (o.y+o.h/2)*sc, Math.abs(o.w/2)*sc, Math.abs(o.h/2)*sc, 0, 0, Math.PI*2);
    ctx.stroke();
  } else if (o.tool === 'line') {
    ctx.beginPath(); ctx.moveTo(o.x*sc, o.y*sc); ctx.lineTo((o.x+o.w)*sc, (o.y+o.h)*sc); ctx.stroke();
  } else if (o.tool === 'arrow') {
    const ex=(o.x+o.w)*sc, ey=(o.y+o.h)*sc, sx=o.x*sc, sy=o.y*sc;
    const angle = Math.atan2(ey-sy, ex-sx), hw = Math.max(8, o.size*sc*3);
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hw*Math.cos(angle-Math.PI/6), ey - hw*Math.sin(angle-Math.PI/6));
    ctx.lineTo(ex - hw*Math.cos(angle+Math.PI/6), ey - hw*Math.sin(angle+Math.PI/6));
    ctx.closePath(); ctx.fillStyle = o.color; ctx.fill();
  }
}

async function previewMain(pg) {
  if (!S.pages.length) return;
  pg = Math.max(1, Math.min(pg ?? S.curPage, S.totalPages));
  S.curPage = pg;
  const { canvas } = await renderPageToCanvas(S.pages[pg - 1], CFG.PREVIEW_SCALE * S.zoom);
  const cv = $('previewCanvas');
  cv.width = canvas.width; cv.height = canvas.height;
  cv.getContext('2d').drawImage(canvas, 0, 0);
  show(cv); hide($('previewPlaceholder'));
  $('drawingLayer').width  = cv.width; $('drawingLayer').height  = cv.height;
  $('placementOverlay').width = cv.width; $('placementOverlay').height = cv.height;
  updateNav();

  // Fit textBoxLayer exactly over the canvas after layout completes
  requestAnimationFrame(() => {
    // The page is centred on the light table; keep drawing layers glued to it
    ['drawingLayer', 'placementOverlay'].forEach(id => {
      $(id).style.top = cv.offsetTop + 'px'; $(id).style.left = cv.offsetLeft + 'px';
    });
    const layer = $('textBoxLayer');
    const wrap  = $('previewWrap');
    const wRect = wrap.getBoundingClientRect();
    const cRect = cv.getBoundingClientRect();
    // Position relative to the wrap (scrollable container)
    layer.style.top    = (cRect.top  - wRect.top  + wrap.scrollTop)  + 'px';
    layer.style.left   = (cRect.left - wRect.left + wrap.scrollLeft) + 'px';
    layer.style.width  = cRect.width  + 'px';
    layer.style.height = cRect.height + 'px';
    if (typeof tbSyncToPage === 'function') tbSyncToPage(pg);
    if (typeof imSync === 'function') imSync();

    // Keep watermark preview canvas in sync
    const wmc = $('wmPreviewCanvas');
    wmc.style.top  = cv.offsetTop  + 'px';
    wmc.style.left = cv.offsetLeft + 'px';
    if (typeof wmDrawPreview === 'function') wmDrawPreview();

    // Keep signature placement layer in sync (scroll-aware)
    const spl = $('sigPlacementLayer');
    spl.style.top    = (cRect.top  - wRect.top  + wrap.scrollTop)  + 'px';
    spl.style.left   = (cRect.left - wRect.left + wrap.scrollLeft) + 'px';
    spl.style.width  = cRect.width  + 'px';
    spl.style.height = cRect.height + 'px';

    // Sync redact layer (scroll-aware)
    if (typeof rdSyncLayer === 'function') { rdSyncLayer(); rdRenderBoxes(); }
  });
}

/* On narrow screens, open documents at a zoom that fits the width */
async function fitZoomToWidth(desc) {
  if (window.innerWidth > 860 || !desc) return;
  const pg = await desc.pdfJsDoc.getPage(desc.pageNum);
  const w  = pg.getViewport({ scale: CFG.PREVIEW_SCALE }).width;
  const avail = $('previewWrap').clientWidth - 32;
  if (avail > 0 && w > avail) {
    S.zoom = Math.max(0.25, +(avail / w).toFixed(2));
    $('zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
  }
}

function updateNav() {
  $('pageIndicator').textContent = S.totalPages ? `${S.curPage} / ${S.totalPages}` : '- / -';
  $('prevPage').disabled = !S.totalPages || S.curPage <= 1;
  $('nextPage').disabled = !S.totalPages || S.curPage >= S.totalPages;
  $('zoomIn').disabled  = !S.totalPages || S.zoom >= CFG.ZOOM_MAX;
  $('zoomOut').disabled = !S.totalPages || S.zoom <= CFG.ZOOM_MIN;
}
function updateDownloadBtn() {
  $('downloadBtn').disabled = !S.pages.length;
}
$('prevPage').addEventListener('click', () => previewMain(S.curPage - 1));
$('nextPage').addEventListener('click', () => previewMain(S.curPage + 1));
$('zoomIn').addEventListener('click',  () => { S.zoom = Math.min(CFG.ZOOM_MAX, +(S.zoom+CFG.ZOOM_STEP).toFixed(2)); $('zoomLabel').textContent = Math.round(S.zoom*100)+'%'; previewMain(); });
$('zoomOut').addEventListener('click', () => { S.zoom = Math.max(CFG.ZOOM_MIN, +(S.zoom-CFG.ZOOM_STEP).toFixed(2)); $('zoomLabel').textContent = Math.round(S.zoom*100)+'%'; previewMain(); });

/* ── PLACEMENT OVERLAY ── */
function clearPlacementOverlay() {
  const ov = $('placementOverlay'); if (!ov) return;
  ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
  ov.style.pointerEvents = 'none';
  $('previewWrap').classList.remove('placement-active');
}
$('placementOverlay').addEventListener('click', e => {
  if (!S.placeMode) return;
  const ov = $('placementOverlay'), rect = ov.getBoundingClientRect();
  const cx = (e.clientX-rect.left)*(ov.width/rect.width);
  const cy = (e.clientY-rect.top)*(ov.height/rect.height);
  const sc = CFG.PREVIEW_SCALE * S.zoom;
  const px = Math.round(cx/sc), py = Math.round(cy/sc);
  const ctx = ov.getContext('2d');
  ctx.clearRect(0,0,ov.width,ov.height);
  ctx.strokeStyle='#4f8ef7'; ctx.lineWidth=1.5; ctx.setLineDash([5,3]);
  ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(ov.width,cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,ov.height); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle='#4f8ef7';
  ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();
  ctx.font='bold 11px monospace'; ctx.fillText(`(${px},${py})`,cx+8,cy-5);
  toast(`Position → X:${px}  Y:${py}`, 'success', 2000);
});
function setPlaceMode(mode, btnId) {
  S.placeMode = S.placeMode===mode ? null : mode;
  ['imgPickBtn'].forEach(id => {
    const b=$(id); if(!b) return;
    b.classList.remove('active-pick');
    b.innerHTML='<i class="fa-solid fa-crosshairs"></i> Pick on Page';
  });
  const ov = $('placementOverlay');
  if (S.placeMode) {
    ov.style.pointerEvents='all';
    $('previewWrap').classList.add('placement-active');
    const b=$(btnId);
    if(b){b.classList.add('active-pick');b.innerHTML='<i class="fa-solid fa-xmark"></i> Cancel';}
    toast('Click on the preview to set position.','info',3000);
  } else { clearPlacementOverlay(); }
}

/* ── BUILD PDF ──
 * Pages are copied as real PDF objects (text stays selectable, links and
 * vectors survive). Overlays are drawn onto a transparent layer and stamped
 * on top. A page is only flattened to an image when it holds redactions
 * (so hidden content is truly gone) or when compressing.
 */
const _libDocCache = new WeakMap();
function libDocFor(pdfJsDoc) {
  let p = _libDocCache.get(pdfJsDoc);
  if (!p) {
    p = pdfJsDoc.getData().then(b => PDFLib.PDFDocument.load(b, { ignoreEncryption: true }));
    _libDocCache.set(pdfJsDoc, p);
  }
  return p;
}
const liveOverlays = d => (d.overlays || []).filter(o => o.type !== 'pagenumber_preview');


// ── Text layout shared by the canvas preview and the vector PDF path ──
function canvasFont(o, sc) {
  return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size * sc}px ${o.font || 'Arial'}`;
}

function wrapText(text, maxW, measure) {
  const out = [];
  String(text).replace(/\t/g, '    ').split('\n').forEach(par => {
    if (!isFinite(maxW)) { out.push(par); return; }
    let line = '';
    par.split(/(\s+)/).forEach(tok => {
      if (tok === '') return;
      if (measure(line + tok) <= maxW || line === '') {
        line += tok;
      } else { out.push(line.trimEnd()); line = tok.trimStart(); }
      while (measure(line) > maxW && line.length > 1) {       // break very long words
        let n = line.length - 1;
        while (n > 1 && measure(line.slice(0, n)) > maxW) n--;
        out.push(line.slice(0, n)); line = line.slice(n);
      }
    });
    out.push(line.trimEnd());
  });
  return out;
}

// Returns [{str, x, y}] in unscaled view units; y is the baseline.
function layoutText(o, measure) {
  const lh   = o.size * (o.lineHeight || 1.4);
  const padX = o.padX || 0, padY = o.padY || 0;
  const maxW = o.w ? Math.max(o.size, o.w - 2 * padX) : Infinity;
  const lead = (lh - 1.117 * o.size) / 2 + 0.905 * o.size;    // CSS half-leading + ascent
  return wrapText(o.text, maxW, measure).map((str, i) =>
    ({ str, x: o.x + padX, y: o.y + padY + i * lh + lead }));
}

// ── Vector (selectable, searchable) text via the standard PDF fonts ──
function stdFontName(face, bold, italic) {
  const f = String(face || '').toLowerCase();
  if (f.includes('impact')) bold = true;
  const fam = /times|georgia|serif/.test(f) && !/sans/.test(f) ? 'Times'
            : /courier|mono/.test(f) ? 'Courier' : 'Helvetica';
  if (fam === 'Times')   return bold ? (italic ? 'TimesRomanBoldItalic' : 'TimesRomanBold') : (italic ? 'TimesRomanItalic' : 'TimesRoman');
  if (fam === 'Courier') return 'Courier' + (bold ? 'Bold' : '') + (italic ? 'Oblique' : '');
  return 'Helvetica' + (bold ? 'Bold' : '') + (italic ? 'Oblique' : '');
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || /^#?([0-9a-f]{6})$/i.exec('000000');
  const n = parseInt(m[1], 16);
  return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
}

// Draws what it can as real text. Returns the overlays it could not (left for the raster layer).
async function drawVectorOverlays(doc, page, overlays, total, fonts) {
  const { StandardFonts, degrees } = PDFLib;
  const box = page.getCropBox();
  const sideways = total % 180 !== 0;
  const Wv = sideways ? box.height : box.width, Hv = sideways ? box.width : box.height;
  // view (top-left origin, y down, after rotation) -> page user space
  const map = {
    0:   (x, y) => [box.x + x,              box.y + box.height - y],
    90:  (x, y) => [box.x + y,              box.y + x],
    180: (x, y) => [box.x + box.width - x,  box.y + y],
    270: (x, y) => [box.x + box.width - y,  box.y + box.height - x],
  }[total];
  const leftover = [];

  for (const o of overlays) {
    const isText = o.type === 'text' || o.type === 'pagenumber' || (o.type === 'watermark' && !o.imgEl);
    if (!isText || !String(o.text || '').trim()) { leftover.push(o); continue; }
    const name = stdFontName(o.type === 'pagenumber' ? 'Arial' : o.font, o.bold, o.italic);
    if (!fonts.has(name)) fonts.set(name, await doc.embedFont(StandardFonts[name]));
    const font = fonts.get(name);
    const clean = String(o.text).replace(/\t/g, '    ');
    try { font.encodeText(clean.replace(/\n/g, ' ')); } catch { leftover.push(o); continue; }  // needs raster fallback
    const measure = s => font.widthOfTextAtSize(s, o.size || 12);
    const color = hexToRgb(o.color || (o.type === 'pagenumber' ? '#333333' : '#000000'));

    if (o.type === 'text') {
      layoutText({ ...o, text: clean }, measure).forEach(l => {
        if (!l.str) return;
        const [px, py] = map(l.x, l.y);
        page.drawText(l.str, { x: px, y: py, size: o.size, font, color, rotate: degrees(total) });
      });
    } else if (o.type === 'pagenumber') {
      const w = measure(clean);
      const dx = o.align === 'right' ? -w : o.align === 'left' ? 0 : -w / 2;
      const [px, py] = map(o.x + dx, o.y);
      page.drawText(clean, { x: px, y: py, size: o.size, font, color, rotate: degrees(total) });
    } else {                                                        // text watermark
      const size = o.size || 60, a = (o.angle || 0) * Math.PI / 180;
      const cx = Wv * (o.xFrac !== undefined ? o.xFrac : 0.5);
      const cy = Hv * (o.yFrac !== undefined ? o.yFrac : 0.5);
      const w = font.widthOfTextAtSize(clean, size), drop = size * 0.32;   // canvas "middle" baseline
      const vx = cx - Math.cos(a) * w / 2 - Math.sin(a) * drop;
      const vy = cy - Math.sin(a) * w / 2 + Math.cos(a) * drop;
      const [px, py] = map(vx, vy);
      page.drawText(clean, { x: px, y: py, size, font, color, opacity: o.opacity ?? 0.3,
                             rotate: degrees(total - (o.angle || 0)) });
    }
  }
  return leftover;
}

async function renderOverlayLayer(desc, scale, overlays) {
  const pdfPage = await desc.pdfJsDoc.getPage(desc.pageNum);
  const rotation = (pdfPage.getViewport({ scale: 1 }).rotation + desc.rotation) % 360;
  const vp = pdfPage.getViewport({ scale, rotation });
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  drawOverlaysOnCanvas(cv, overlays || liveOverlays(desc), vp);
  return cv;
}

async function addRasterPage(doc, desc, quality) {
  const { canvas } = await renderPageToCanvas(desc, CFG.RENDER_SCALE);
  const img = await doc.embedJpg(dataUrlToBytes(canvas.toDataURL('image/jpeg', quality)));
  const pg1 = await desc.pdfJsDoc.getPage(desc.pageNum);
  const rot = (pg1.getViewport({ scale: 1 }).rotation + desc.rotation) % 360;
  const vp1 = pg1.getViewport({ scale: 1, rotation: rot });
  const page = doc.addPage([vp1.width, vp1.height]);
  page.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
}

async function buildPdf(pageDescs, quality = 0.92, { rasterize = false } = {}) {
  const { PDFDocument, degrees } = PDFLib;
  const doc = await PDFDocument.create();
  const fonts = new Map();
  for (let i = 0; i < pageDescs.length; i++) {
    const d = pageDescs[i];
    loading(true, `Building PDF… ${i + 1} / ${pageDescs.length}`);
    const overlays = liveOverlays(d);
    if (rasterize || overlays.some(o => o.type === 'redact')) { await addRasterPage(doc, d, quality); continue; }

    const src = await libDocFor(d.pdfJsDoc);
    const [page] = await doc.copyPages(src, [d.pageNum - 1]);
    const total = (((page.getRotation().angle + d.rotation) % 360) + 360) % 360;
    page.setRotation(degrees(total));
    doc.addPage(page);

    const rest = overlays.length ? await drawVectorOverlays(doc, page, overlays, total, fonts) : [];
    if (rest.length) {
      const layer = await renderOverlayLayer(d, CFG.OVERLAY_SCALE, rest);
      const png = await doc.embedPng(dataUrlToBytes(layer.toDataURL('image/png')));
      const box = page.getCropBox();
      const sideways = total % 180 !== 0;
      const anchor = {
        0:   [box.x, box.y],
        90:  [box.x + box.width, box.y],
        180: [box.x + box.width, box.y + box.height],
        270: [box.x, box.y + box.height],
      }[total];
      page.drawImage(png, {
        x: anchor[0], y: anchor[1],
        width:  sideways ? box.height : box.width,
        height: sideways ? box.width  : box.height,
        rotate: degrees(total),
      });
    }
  }
  return doc.save();
}

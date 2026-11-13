'use strict';
/* PDF Studio · Sign: draw, then drag into place
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ── SIGNATURE ── */
const sigCv  = $('sigCanvas');
const sigCtx = sigCv.getContext('2d');

// Signature drawing
$('clearSig').addEventListener('click', () => {
  sigCtx.clearRect(0, 0, sigCv.width, sigCv.height);
  // Remove placement box too, signature is blank now
  if (SIG.boxEl) { SIG.boxEl.remove(); SIG.boxEl = null; }
  $('addSigBtn').disabled = true;
});
function sigPos(e) {
  const r = sigCv.getBoundingClientRect(), s = e;
  return { x: (s.clientX-r.left)*(sigCv.width/r.width), y: (s.clientY-r.top)*(sigCv.height/r.height) };
}
function sigDraw(e) {
  e.preventDefault(); if (!S.sigDrawing) return;
  const p = sigPos(e);
  sigCtx.strokeStyle = $('sigColor').value;
  sigCtx.lineWidth   = +$('sigStroke').value;
  sigCtx.lineCap = 'round'; sigCtx.lineJoin = 'round';
  sigCtx.lineTo(p.x, p.y); sigCtx.stroke();
  // Auto-show box on first ink; then keep live in sync
  if (SIG.active) {
    if (!SIG.boxEl) {
      sigShowBox(); // place at default position automatically
    } else {
      const img = SIG.boxEl.querySelector('img');
      if (img) img.src = sigCv.toDataURL('image/png');
    }
  }
}
/* Pointer events: one path for mouse, pen and finger */
sigCv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  try { sigCv.setPointerCapture(e.pointerId); } catch (_) {}
  S.sigDrawing = true; const p = sigPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y);
});
sigCv.addEventListener('pointermove', e => sigDraw(e));
const sigEnd = () => { if (!S.sigDrawing) return; S.sigDrawing = false; sigCheckDrawn(); };
sigCv.addEventListener('pointerup', sigEnd);
sigCv.addEventListener('pointercancel', sigEnd);

// State
const SIG = { boxEl: null, active: false };

function sigCheckDrawn() {
  if (!SIG.active) return;
  const px = sigCtx.getImageData(0, 0, sigCv.width, sigCv.height);
  const hasInk = px.data.some(v => v > 0);
  if (hasInk) {
    if (!SIG.boxEl) sigShowBox(); // auto-place if not yet shown
    else {
      const img = SIG.boxEl.querySelector('img');
      if (img) img.src = sigCv.toDataURL('image/png');
    }
  } else {
    // No ink (e.g. after clearSig), remove box
    if (SIG.boxEl) { SIG.boxEl.remove(); SIG.boxEl = null; }
    $('addSigBtn').disabled = true;
  }
}

function sigUpdateBtns() {
  const pages  = S.toolPages['signature'] || [];
  const hasAny = pages.some(p => p.overlays.some(o => o.type === 'signature'));
  $('sigUndoBtn').disabled  = !hasAny;
  $('sigClearBtn').disabled = !hasAny;
}

// Show/create the draggable signature box on the preview at click position
function sigShowBox(clickX, clickY) {
  const layer = $('sigPlacementLayer');
  // Remove existing box
  if (SIG.boxEl) SIG.boxEl.remove();

  const cv  = $('previewCanvas');
  const box = document.createElement('div');
  box.className = 'sig-box';

  const img = document.createElement('img');
  img.src = sigCv.toDataURL('image/png');
  box.appendChild(img);

  const resH = document.createElement('div');
  resH.className = 'sig-resize';
  box.appendChild(resH);

  // Default size
  const defW = Math.round(cv.offsetWidth  * 0.30);
  const defH = Math.round(cv.offsetHeight * 0.10);

  // Place centred on click, clamped to layer
  const lw = cv.offsetWidth, lh = cv.offsetHeight;
  const left = clickX !== undefined
    ? Math.max(0, Math.min(lw - defW, clickX - defW/2))
    : Math.round(lw * 0.05);
  const top  = clickY !== undefined
    ? Math.max(0, Math.min(lh - defH, clickY - defH/2))
    : Math.round(lh * 0.75);

  box.style.left   = left + 'px';
  box.style.top    = top  + 'px';
  box.style.width  = defW + 'px';
  box.style.height = defH + 'px';

  let dragMode = null, startX, startY, startL, startT, startW, startH;
  box.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target === resH) dragMode = 'resize';
    else dragMode = 'move';
    startX = e.clientX; startY = e.clientY;
    startL = parseInt(box.style.left); startT = parseInt(box.style.top);
    startW = box.offsetWidth; startH = box.offsetHeight;
    e.preventDefault(); e.stopPropagation();
  });
  document.addEventListener('pointermove', e => {
    if (!dragMode) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (dragMode === 'move') {
      box.style.left = Math.max(0, startL + dx) + 'px';
      box.style.top  = Math.max(0, startT + dy) + 'px';
    } else {
      box.style.width  = Math.max(60, startW + dx) + 'px';
      box.style.height = Math.max(30, startH + dy) + 'px';
    }
  });
  document.addEventListener('pointerup', () => { dragMode = null; });
  document.addEventListener('pointercancel', () => { dragMode = null; });

  layer.appendChild(box);
  SIG.boxEl = box;
  $('addSigBtn').disabled = false;
}

function sigActivate() {
  SIG.active = true;
  const layer = $('sigPlacementLayer');
  const cv = $('previewCanvas');
  layer.style.top    = cv.offsetTop  + 'px';
  layer.style.left   = cv.offsetLeft + 'px';
  layer.style.width  = cv.offsetWidth  + 'px';
  layer.style.height = cv.offsetHeight + 'px';
  layer.classList.add('active');
  sigUpdateBtns();

  // Click on empty layer area → place box at click position
  layer.addEventListener('click', sigLayerClick);

  // Show box if signature already drawn
  const px = sigCtx.getImageData(0, 0, sigCv.width, sigCv.height);
  if (px.data.some(v => v > 0)) sigShowBox();
}

function sigLayerClick(e) {
  // Only trigger on the layer itself, not on the box
  if (e.target !== $('sigPlacementLayer')) return;
  const rect = $('sigPlacementLayer').getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  // Check ink
  const px = sigCtx.getImageData(0, 0, sigCv.width, sigCv.height);
  if (!px.data.some(v => v > 0)) {
    toast('Draw your signature first, then click to place it.', 'info');
    return;
  }
  sigShowBox(cx, cy);
}

function sigDeactivate() {
  SIG.active = false;
  SIG.boxEl  = null;
  $('sigPlacementLayer').classList.remove('active');
  $('sigPlacementLayer').innerHTML = '';
  $('addSigBtn').disabled = true;
}

// Hook into tool switching
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.panel === 'signature') {
      setTimeout(() => { if (S.toolPages['signature']?.length) sigActivate(); }, 50);
    } else {
      sigDeactivate();
    }
  });
});

// Hook PDF load
const _origWirePdfSig = wirePdfUpload;
(function() {
  const obs = new MutationObserver(() => {
    if (!$('signatureControls').classList.contains('hidden') && S.activeTool === 'signature' && !SIG.active) {
      sigActivate();
    }
  });
  obs.observe($('signatureControls'), { attributes:true, attributeFilter:['class'] });
})();

// Re-sync layer position on page change
const _sigPreviewHook = previewMain;

// Embed signature button
$('addSigBtn').addEventListener('click', async () => {
  const pages = S.toolPages['signature']; if (!pages?.length) return;
  if (!SIG.boxEl) { toast('Place your signature on the page first.', 'error'); return; }

  const px = sigCtx.getImageData(0, 0, sigCv.width, sigCv.height);
  if (!px.data.some(v => v > 0)) { toast('Draw a signature first.', 'error'); return; }

  // Convert box position to PDF coordinates
  const cv      = $('previewCanvas');
  const layer   = $('sigPlacementLayer');
  const bx      = parseFloat(SIG.boxEl.style.left) || 0;
  const by      = parseFloat(SIG.boxEl.style.top)  || 0;
  const bw      = SIG.boxEl.offsetWidth;
  const bh      = SIG.boxEl.offsetHeight;
  const scaleX  = cv.offsetWidth;
  const scaleY  = cv.offsetHeight;

  const pdfPage = await pages[S.curPage-1].pdfJsDoc.getPage(pages[S.curPage-1].pageNum);
  const vp      = pdfPage.getViewport({ scale:1 });
  const xPdf = (bx / scaleX) * vp.width;
  const yPdf = (by / scaleY) * vp.height;
  const wPdf = (bw / scaleX) * vp.width;
  const hPdf = (bh / scaleY) * vp.height;

  const img = new Image(); img.src = sigCv.toDataURL('image/png');
  await new Promise(r => { img.onload = r; });

  pages[S.curPage-1].overlays.push({ type:'signature', imgEl:img, x:xPdf, y:yPdf, w:wPdf, h:hPdf });
  const prevTool = S.activeTool;
  S.activeTool = 'signature';
  await previewMain(S.curPage);
  S.activeTool = prevTool;
  sigUpdateBtns();
  toast('Signature embedded!', 'success');
});

// Undo / Clear
$('sigUndoBtn').addEventListener('click', async () => {
  const pages = S.toolPages['signature']; if (!pages?.length) return;
  // Remove last signature overlay from any page (scan all)
  let removed = false;
  for (let pi = pages.length - 1; pi >= 0 && !removed; pi--) {
    for (let oi = pages[pi].overlays.length - 1; oi >= 0; oi--) {
      if (pages[pi].overlays[oi].type === 'signature') {
        pages[pi].overlays.splice(oi, 1);
        removed = true; break;
      }
    }
  }
  if (removed) {
    const prevTool = S.activeTool;
    S.activeTool = 'signature';
    await previewMain(S.curPage);
    S.activeTool = prevTool;
  }
  sigUpdateBtns();
  toast(removed ? 'Signature removed.' : 'Nothing to undo.', removed ? 'success' : 'info');
});

$('sigClearBtn').addEventListener('click', async () => {
  const pages = S.toolPages['signature']; if (!pages?.length) return;
  pages.forEach(p => { p.overlays = p.overlays.filter(o => o.type !== 'signature'); });
  const prevTool = S.activeTool;
  S.activeTool = 'signature';
  await previewMain(S.curPage);
  S.activeTool = prevTool;
  sigUpdateBtns();
  toast('All signatures removed.', 'success');
});

'use strict';
/* PDF Studio · Add Image: drag the picture into place, resize from the corner.
   Shares globals (S, CFG, $, helpers) from core.js. */

const IM = {
  active: false,
  imgEl:  null,
  boxEl:  null,
  // box geometry as fractions of the page preview, so zoom and page changes keep it in place
  fx: 0.1, fy: 0.1, fw: 0.3, fh: 0.15,
};

function imLayer() { return $('imgPlacementLayer'); }

function imSync() {
  const layer = imLayer(), cv = $('previewCanvas');
  if (!IM.active || !cv || cv.classList.contains('hidden')) return;
  layer.style.top    = cv.offsetTop  + 'px';
  layer.style.left   = cv.offsetLeft + 'px';
  layer.style.width  = cv.offsetWidth  + 'px';
  layer.style.height = cv.offsetHeight + 'px';
  imApplyGeometry();
}

function imApplyGeometry() {
  if (!IM.boxEl) return;
  const lw = imLayer().offsetWidth, lh = imLayer().offsetHeight;
  IM.boxEl.style.left   = IM.fx * lw + 'px';
  IM.boxEl.style.top    = IM.fy * lh + 'px';
  IM.boxEl.style.width  = IM.fw * lw + 'px';
  IM.boxEl.style.height = IM.fh * lh + 'px';
}

function imReadGeometry() {
  const lw = imLayer().offsetWidth, lh = imLayer().offsetHeight;
  IM.fx = (parseFloat(IM.boxEl.style.left) || 0) / lw;
  IM.fy = (parseFloat(IM.boxEl.style.top)  || 0) / lh;
  IM.fw = IM.boxEl.offsetWidth  / lw;
  IM.fh = IM.boxEl.offsetHeight / lh;
}

function imClamp() {
  IM.fw = Math.min(IM.fw, 1); IM.fh = Math.min(IM.fh, 1);
  IM.fx = Math.max(0, Math.min(1 - IM.fw, IM.fx));
  IM.fy = Math.max(0, Math.min(1 - IM.fh, IM.fy));
}

function imShowBox() {
  const layer = imLayer(), cv = $('previewCanvas');
  if (!IM.imgEl) return;
  if (IM.boxEl) IM.boxEl.remove();

  // Start at 30% of the page width, keeping the picture's own proportions, centred
  const ratio = IM.imgEl.naturalHeight / IM.imgEl.naturalWidth || 0.5;
  IM.fw = 0.3;
  IM.fh = Math.min(0.9, (IM.fw * cv.offsetWidth * ratio) / cv.offsetHeight);
  IM.fx = (1 - IM.fw) / 2; IM.fy = (1 - IM.fh) / 2;

  const box = document.createElement('div');
  box.className = 'sig-box img-box';
  box.tabIndex = 0;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', 'Image to place. Drag to move, use arrow keys to nudge, Shift plus arrows to resize.');
  const img = document.createElement('img');
  img.src = IM.imgEl.src; img.alt = '';
  img.draggable = false;
  box.appendChild(img);
  const handle = document.createElement('div');
  handle.className = 'sig-resize';
  box.appendChild(handle);

  let mode = null, sx, sy, sl, st, sw, sh;
  box.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    mode = e.target === handle ? 'resize' : 'move';
    sx = e.clientX; sy = e.clientY;
    sl = parseFloat(box.style.left) || 0; st = parseFloat(box.style.top) || 0;
    sw = box.offsetWidth; sh = box.offsetHeight;
    try { box.setPointerCapture(e.pointerId); } catch (_) {}
    box.focus({ preventScroll: true });
    e.preventDefault(); e.stopPropagation();
  });
  box.addEventListener('pointermove', e => {
    if (!mode) return;
    const lw = layer.offsetWidth, lh = layer.offsetHeight;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (mode === 'move') {
      box.style.left = Math.max(0, Math.min(lw - sw, sl + dx)) + 'px';
      box.style.top  = Math.max(0, Math.min(lh - sh, st + dy)) + 'px';
    } else {
      // keep the picture's proportions while resizing
      const w = Math.max(30, Math.min(lw - sl, sw + dx));
      box.style.width  = w + 'px';
      box.style.height = Math.min(lh - st, w * (sh / sw)) + 'px';
    }
  });
  const end = () => { if (!mode) return; mode = null; imReadGeometry(); imClamp(); imApplyGeometry(); };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);

  box.addEventListener('keydown', e => {
    const step = (e.shiftKey ? 0.02 : 0.01);
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
    e.preventDefault();
    const dx = k === 'ArrowRight' ? step : k === 'ArrowLeft' ? -step : 0;
    const dy = k === 'ArrowDown'  ? step : k === 'ArrowUp'   ? -step : 0;
    if (e.shiftKey) {                       // Shift + arrows resizes
      const ratio = IM.fh / IM.fw;
      IM.fw = Math.max(0.03, IM.fw + (dx || -dy)); IM.fh = IM.fw * ratio;
    } else { IM.fx += dx; IM.fy += dy; }
    imClamp(); imApplyGeometry();
  });

  layer.appendChild(box);
  IM.boxEl = box;
  imApplyGeometry();
  $('addImageBtn').disabled = false;
}

function imActivate() {
  IM.active = true;
  imLayer().classList.add('active');
  imSync();
  if (IM.imgEl && !IM.boxEl) imShowBox();
}

function imDeactivate() {
  IM.active = false; IM.boxEl = null;
  const l = imLayer(); if (!l) return;
  l.classList.remove('active'); l.innerHTML = '';
  $('addImageBtn').disabled = true;
}

$('overlayImageInput').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    IM.imgEl = await loadImgEl(f);
    if (!IM.active) imActivate();
    imShowBox();
    IM.boxEl?.focus({ preventScroll: true });
  } catch (err) { toast(err.message, 'error'); }
});

$('addImageBtn').addEventListener('click', async () => {
  const pages = S.toolPages['image']; if (!pages?.length) return;
  if (!IM.imgEl || !IM.boxEl) { toast('Choose an image first.', 'error'); return; }
  imReadGeometry(); imClamp();
  loading(true, 'Placing image…');
  try {
    const page = pages[S.curPage - 1];
    const vp = (await page.pdfJsDoc.getPage(page.pageNum)).getViewport({ scale: 1 });
    page.overlays.push({
      type: 'image', imgEl: IM.imgEl,
      x: IM.fx * vp.width, y: IM.fy * vp.height, w: IM.fw * vp.width, h: IM.fh * vp.height,
    });
    await previewMain(S.curPage);
    toast(`Image placed on page ${S.curPage}. Choose another to add more.`, 'success');
  } catch (e) { toast(`Image error: ${e.message}`, 'error'); }
  finally { loading(false); }
});

'use strict';
/* PDF Studio · Add Image: drag the picture into place, resize from the corner.
   Shares globals (S, CFG, $, helpers) from core.js. */

const IM = {
  active: false,
  imgEl:  null,   // what gets placed (already rotated)
  srcEl:  null,   // the original picture
  rot:    0,
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
  box.setAttribute('aria-label', 'Image to place. Drag to move, arrow keys nudge, Shift plus arrows resize, Delete discards.');
  const img = document.createElement('img');
  img.src = IM.imgEl.src; img.alt = '';
  img.draggable = false;
  box.appendChild(img);
  const handle = document.createElement('div');
  handle.className = 'sig-resize';
  box.appendChild(handle);
  const xBtn = document.createElement('button');
  xBtn.className = 'img-box-x'; xBtn.type = 'button'; xBtn.innerHTML = '&times;';
  xBtn.setAttribute('aria-label', 'Discard this image');
  xBtn.addEventListener('pointerdown', e => e.stopPropagation());
  xBtn.addEventListener('click', e => { e.stopPropagation(); imDiscard(); });
  box.appendChild(xBtn);

  let mode = null, sx, sy, sl, st, sw, sh;
  box.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target === xBtn) return;
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
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); imDiscard(); return; }
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
  imSetButtons();
}

function imActivate() {
  IM.active = true;
  imLayer().classList.add('active');
  imSync();
  if (IM.imgEl && !IM.boxEl) imShowBox();
  imRenderList();
}

function imDeactivate() {
  IM.active = false; IM.boxEl = null;
  const l = imLayer(); if (!l) return;
  l.classList.remove('active'); l.innerHTML = '';
  imSetButtons();
}

function imSetButtons() {
  const has = !!IM.boxEl;
  $('addImageBtn').disabled   = !has;
  $('imgRotateBtn').disabled  = !has;
  $('imgDeleteBtn').disabled  = !has;
  imRenderList();
}

function imDiscard() {
  if (IM.boxEl) IM.boxEl.remove();
  IM.boxEl = null; IM.imgEl = null; IM.srcEl = null; IM.rot = 0;
  $('overlayImageInput').value = '';
  imSetButtons();
}

// Rotated copy of the picture, so the placed overlay is a plain bitmap
function imRotated(src, deg) {
  if (!deg) return Promise.resolve(src);
  const swap = deg % 180 !== 0;
  const cv = document.createElement('canvas');
  cv.width = swap ? src.naturalHeight : src.naturalWidth;
  cv.height = swap ? src.naturalWidth : src.naturalHeight;
  const ctx = cv.getContext('2d');
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(src, -src.naturalWidth / 2, -src.naturalHeight / 2);
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = cv.toDataURL('image/png'); });
}

/* ── Placed images: list, remove one, undo, remove all ── */
function imPlaced() {
  const out = [];
  (S.toolPages['image'] || []).forEach((p, pi) =>
    p.overlays.forEach(o => { if (o.type === 'image') out.push({ page: pi + 1, o, p }); }));
  return out;
}

function imRenderList() {
  const list = $('imgList'); if (!list) return;
  const items = imPlaced();
  list.dataset.empty = 'Nothing placed yet.';
  list.innerHTML = '';
  items.forEach((it, n) => {
    const row = document.createElement('div');
    row.className = 'rdbox-item';
    row.innerHTML = `<span>Page ${it.page} &nbsp;·&nbsp; image ${n + 1}</span>
      <button type="button" aria-label="Remove image ${n + 1} from page ${it.page}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
    row.querySelector('button').addEventListener('click', async () => {
      it.p.overlays.splice(it.p.overlays.indexOf(it.o), 1);
      await previewMain(S.curPage); imRenderList();
      toast('Image removed.', 'info', 2000);
    });
    list.appendChild(row);
  });
  $('imgUndoBtn').disabled  = !items.length;
  $('imgClearBtn').disabled = !items.length;
}

$('imgUndoBtn').addEventListener('click', async () => {
  const last = imPlaced().pop(); if (!last) return;
  last.p.overlays.splice(last.p.overlays.indexOf(last.o), 1);
  await previewMain(S.curPage); imRenderList();
});
$('imgClearBtn').addEventListener('click', async () => {
  const items = imPlaced(); if (!items.length) return;
  if (!confirm(`Remove all ${items.length} placed image${items.length > 1 ? 's' : ''}?`)) return;
  items.forEach(it => it.p.overlays.splice(it.p.overlays.indexOf(it.o), 1));
  await previewMain(S.curPage); imRenderList();
});

$('imgOpacity').addEventListener('input', () => {
  const v = +$('imgOpacity').value;
  $('imgOpacityVal').textContent = v + '%';
  if (IM.boxEl) IM.boxEl.querySelector('img').style.opacity = v / 100;
});

$('imgRotateBtn').addEventListener('click', async () => {
  if (!IM.srcEl || !IM.boxEl) return;
  imReadGeometry();
  const lw = imLayer().offsetWidth, lh = imLayer().offsetHeight;
  // swap the box's pixel width and height around its centre, then re-fit inside the page
  const cx = (IM.fx + IM.fw / 2) * lw, cy = (IM.fy + IM.fh / 2) * lh;
  const wpx = IM.fh * lh, hpx = IM.fw * lw;
  IM.rot = (IM.rot + 90) % 360;
  IM.imgEl = await imRotated(IM.srcEl, IM.rot);
  IM.boxEl.querySelector('img').src = IM.imgEl.src;
  IM.fw = Math.min(1, wpx / lw); IM.fh = Math.min(1, hpx / lh);
  IM.fx = cx / lw - IM.fw / 2; IM.fy = cy / lh - IM.fh / 2;
  imClamp(); imApplyGeometry();
});

$('overlayImageInput').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    IM.srcEl = await loadImgEl(f); IM.imgEl = IM.srcEl; IM.rot = 0;
    if (!IM.active) imActivate();
    imShowBox();
    IM.boxEl.querySelector('img').style.opacity = (+$('imgOpacity').value) / 100;
    IM.boxEl?.focus({ preventScroll: true });
  } catch (err) { toast(err.message, 'error'); }
});

$('addImageBtn').addEventListener('click', async () => {
  const pages = S.toolPages['image']; if (!pages?.length) return;
  if (!IM.imgEl || !IM.boxEl) { toast('Choose an image first.', 'error'); return; }
  imReadGeometry(); imClamp();
  const opacity = (+$('imgOpacity').value) / 100;
  const targets = $('imgAllPages').checked ? pages : [pages[S.curPage - 1]];
  loading(true, 'Placing image…');
  try {
    for (const page of targets) {
      const vp = (await page.pdfJsDoc.getPage(page.pageNum)).getViewport({ scale: 1 });
      page.overlays.push({
        type: 'image', imgEl: IM.imgEl, opacity,
        x: IM.fx * vp.width, y: IM.fy * vp.height, w: IM.fw * vp.width, h: IM.fh * vp.height,
      });
    }
    imDiscard();
    await previewMain(S.curPage);
    imRenderList();
    toast(targets.length > 1 ? `Image placed on all ${targets.length} pages.` : `Image placed on page ${S.curPage}.`, 'success');
  } catch (e) { toast(`Image error: ${e.message}`, 'error'); }
  finally { loading(false); }
});

'use strict';
/* PDF Studio · Add Text (inline text boxes) and Add Image
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ══════════════════════════════════════════════════════════════
   TEXT TOOL ,  SimplePDF-style inline text boxes
   
   How it works:
   1. textBoxLayer (absolute div over canvas) receives clicks
   2. Click on empty space → create box at cursor
   3. Each box: contenteditable div + ✕ delete btn + SE resize handle
   4. Clicking box border (not content) → drag to move
   5. Float toolbar appears above selected box (font/size/color/B/I/delete)
   6. Apply → compute PDF coords via canvas bounding rect, burn in
   
   Coordinate system:
   - Boxes are positioned relative to textBoxLayer
   - textBoxLayer overlaps the canvas exactly (same inset as canvas padding)
   - On apply: box.left/top → canvas-relative → PDF-space via viewport scale
══════════════════════════════════════════════════════════════ */

const TB = {
  boxes:      [],      // { id, el, contentEl, page }
  nextId:     1,
  active:     false,
  selectedId: null,
};

// ── Grab float bar elements ────────────────────────
const tbFB    = () => $('tbFloatBar');
const tbFFont = () => $('tbFloatFont');
const tbFSize = () => $('tbFloatSize');
const tbFClr  = () => $('tbFloatColor');
const tbFBold = () => $('tbFloatBold');
const tbFItal = () => $('tbFloatItalic');

// ── Helper: read default style from sidebar ────────
function tbDefaultStyle() {
  return {
    font:   $('tbDefFont')?.value  || 'Arial',
    size:   parseInt($('tbDefSize')?.value)  || 16,
    color:  $('tbDefColor')?.value || '#000000',
    bold:   !!$('tbDefBold')?.classList.contains('active'),
    italic: !!$('tbDefItalic')?.classList.contains('active'),
  };
}

// ── Apply a style object to a DOM element ─────────
function tbApplyStyleToEl(el, s) {
  el.style.fontFamily = s.font;
  el.style.fontSize   = s.size + 'px';
  el.style.color      = s.color;
  el.style.fontWeight = s.bold   ? 'bold'   : 'normal';
  el.style.fontStyle  = s.italic ? 'italic' : 'normal';
}

// ── Mode enter/exit ───────────────────────────────
function tbEnter() {
  TB.active = true;
  $('previewWrap').classList.add('text-mode');
  $('textBoxLayer').classList.add('active');
}
function tbExit() {
  TB.active = false;
  $('previewWrap').classList.remove('text-mode');
  $('textBoxLayer').classList.remove('active');
  tbDeselect();
}
function tbCheckEnter() {
  if (S.activeTool === 'text' && S.toolPages['text']?.length) tbEnter();
  else tbExit();
}

// ── Float bar positioning ─────────────────────────
function tbPositionBar(boxEl) {
  const fb = tbFB(); if (!fb) return;
  const br  = boxEl.getBoundingClientRect();
  const fbH = fb.offsetHeight || 42;
  const fbW = fb.offsetWidth  || 310;
  let top  = br.top - fbH - 10;
  if (top < 60) top = br.bottom + 10;                 // flip below if no space
  let left = br.left;
  if (left + fbW > window.innerWidth - 8) left = window.innerWidth - fbW - 8;
  fb.style.top  = Math.max(4, top) + 'px';
  fb.style.left = Math.max(4, left) + 'px';
  fb.classList.remove('hidden');
}
function tbHideBar() { tbFB()?.classList.add('hidden'); }

// ── Selection ────────────────────────────────────
function tbSelect(id) {
  TB.selectedId = id;
  TB.boxes.forEach(b => b.el.classList.toggle('selected', b.id === id));
  const box = TB.boxes.find(b => b.id === id);
  if (!box) return;
  // Sync float bar to this box's current computed style
  const ce = box.contentEl;
  const cs = window.getComputedStyle(ce);
  const ff = tbFFont(), fs = tbFSize(), fc = tbFClr(), fb2 = tbFBold(), fi = tbFItal();
  if (ff) ff.value = cs.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
  if (fs) fs.value = Math.round(parseFloat(cs.fontSize));
  if (fc) fc.value = rgbToHex(cs.color);
  if (fb2) fb2.classList.toggle('active', cs.fontWeight === 'bold' || parseInt(cs.fontWeight) >= 700);
  if (fi)  fi.classList.toggle('active',  cs.fontStyle === 'italic');
  tbPositionBar(box.el);
}
function tbDeselect() {
  TB.selectedId = null;
  TB.boxes.forEach(b => b.el.classList.remove('selected'));
  tbHideBar();
}

// ── Float bar → apply style to selected box ──────
function tbApplyFloat() {
  const box = TB.boxes.find(b => b.id === TB.selectedId);
  if (!box) return;
  const s = {
    font:   tbFFont()?.value || 'Arial',
    size:   parseInt(tbFSize()?.value) || 16,
    color:  tbFClr()?.value  || '#000000',
    bold:   !!tbFBold()?.classList.contains('active'),
    italic: !!tbFItal()?.classList.contains('active'),
  };
  tbApplyStyleToEl(box.contentEl, s);
}

// Wire float bar events
['tbFloatFont','tbFloatSize','tbFloatColor'].forEach(id => {
  $(id)?.addEventListener('input',  tbApplyFloat);
  $(id)?.addEventListener('change', tbApplyFloat);
});
$('tbFloatBold')?.addEventListener('click', () => {
  $('tbFloatBold').classList.toggle('active'); tbApplyFloat();
});
$('tbFloatItalic')?.addEventListener('click', () => {
  $('tbFloatItalic').classList.toggle('active'); tbApplyFloat();
});
$('tbFloatDel')?.addEventListener('click', () => {
  if (TB.selectedId !== null) tbRemove(TB.selectedId);
});
$('tbFloatDup')?.addEventListener('click', () => {
  const box = TB.boxes.find(b => b.id === TB.selectedId);
  if (!box) return;
  const x = parseFloat(box.el.style.left) + 16;
  const y = parseFloat(box.el.style.top)  + 16;
  const nb = tbCreate(x, y);
  nb.contentEl.innerHTML = box.contentEl.innerHTML;
  // Copy styles
  const cs = window.getComputedStyle(box.contentEl);
  nb.contentEl.style.cssText = box.contentEl.style.cssText;
  tbSelect(nb.id);
});

// Wire sidebar default buttons
$('tbDefBold')?.addEventListener('click',   () => $('tbDefBold').classList.toggle('active'));
$('tbDefItalic')?.addEventListener('click', () => $('tbDefItalic').classList.toggle('active'));

// ── Create a text box ─────────────────────────────
function tbCreate(xPx, yPx) {
  const s  = tbDefaultStyle();
  const id = TB.nextId++;

  // Outer wrapper
  const box       = document.createElement('div');
  box.className   = 'inline-textbox';
  box.dataset.tbid = String(id);
  box.style.left  = xPx + 'px';
  box.style.top   = yPx + 'px';

  // Editable content
  const content = document.createElement('div');
  content.className       = 'tb-content';
  content.contentEditable = 'true';
  content.spellcheck      = false;
  content.dataset.placeholder = 'Type here…';
  tbApplyStyleToEl(content, s);

  // ✕ Delete button
  const del       = document.createElement('button');
  del.className   = 'tb-delete';
  del.textContent = '✕';
  del.title       = 'Delete box';
  del.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); });
  del.addEventListener('click',     e => { e.stopPropagation(); tbRemove(id); });

  // SE resize handle
  const rz      = document.createElement('div');
  rz.className  = 'tb-resize-handle';
  rz.title      = 'Drag to resize';

  box.appendChild(content);
  box.appendChild(del);
  box.appendChild(rz);
  $('textBoxLayer').appendChild(box);

  // ── Drag / resize logic ────────────────────────
  let dragMode = null, dsx, dsy, dox, doy, dow, doh;

  const startDrag = (mode, e) => {
    dragMode = mode;
    dsx = e.clientX; dsy = e.clientY;
    dox = parseFloat(box.style.left)  || 0;
    doy = parseFloat(box.style.top)   || 0;
    dow = box.offsetWidth;
    doh = box.offsetHeight;
    e.preventDefault(); e.stopPropagation();
  };

  box.addEventListener('mousedown', e => {
    tbSelect(id);
    // Resize handle
    if (e.target === rz) { startDrag('resize', e); return; }
    // Content → don't drag, allow typing
    if (e.target === content || e.target.closest('.tb-content')) {
      e.stopPropagation(); return;
    }
    // Delete btn → handled separately
    if (e.target === del) return;
    // Anything else on the box (border) → move
    startDrag('move', e);
  });

  const onMouseMove = e => {
    if (!dragMode) return;
    const dx = e.clientX - dsx, dy = e.clientY - dsy;
    if (dragMode === 'move') {
      box.style.left = (dox + dx) + 'px';
      box.style.top  = (doy + dy) + 'px';
      if (TB.selectedId === id) tbPositionBar(box); // keep toolbar aligned
    } else {
      box.style.width  = Math.max(60,  dow + dx) + 'px';
      box.style.height = Math.max(24, doh + dy) + 'px';
    }
  };
  const onMouseUp = () => { dragMode = null; };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // Focus → select
  content.addEventListener('focus', () => tbSelect(id));

  const cv = $('previewCanvas');
  const record = {
    id, el: box, contentEl: content,
    page:    S.curPage,
    canvasW: cv.offsetWidth,   // display size at creation, used for PDF coord scaling
    canvasH: cv.offsetHeight,
  };
  TB.boxes.push(record);
  tbUpdateApplyBtn();
  tbSelect(id);
  setTimeout(() => { content.focus(); placeCursorAtEnd(content); }, 20);
  return record;
}

// ── Helpers ───────────────────────────────────────
function placeCursorAtEnd(el) {
  const range = document.createRange();
  const sel   = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function rgbToHex(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return '#000000';
  return '#' + m.slice(0,3).map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
}

// ── Remove / clear ────────────────────────────────
function tbRemove(id) {
  const idx = TB.boxes.findIndex(b => b.id === id);
  if (idx === -1) return;
  TB.boxes[idx].el.remove();
  TB.boxes.splice(idx, 1);
  if (TB.selectedId === id) tbDeselect();
  tbUpdateApplyBtn();
}
function tbClearAll() {
  TB.boxes.forEach(b => b.el.remove());
  TB.boxes = [];
  tbDeselect();
  tbUpdateApplyBtn();
}
function tbUpdateApplyBtn() {
  const btn = $('addTextBtn');
  if (!btn) return;
  const total = TB.boxes.length;
  btn.disabled = total === 0;
  btn.innerHTML = total > 0
    ? `<i class="fa-solid fa-check"></i> Apply ${total} Text Box${total > 1 ? 'es' : ''} to PDF &amp; Download`
    : `<i class="fa-solid fa-check"></i> Apply Text to PDF &amp; Download`;
}

// Show only boxes for current page, hide others
function tbSyncToPage(pg) {
  TB.boxes.forEach(b => {
    const onThisPage = b.page === pg;
    b.el.style.display = onThisPage ? '' : 'none';
    if (!onThisPage && TB.selectedId === b.id) tbDeselect();
  });
}

// ── Click on empty layer → create new box ─────────
$('textBoxLayer').addEventListener('mousedown', e => {
  if (!TB.active) return;
  if (e.target !== $('textBoxLayer')) return; // only empty space
  const rect = $('textBoxLayer').getBoundingClientRect();
  tbCreate(e.clientX - rect.left, e.clientY - rect.top);
});

// ── Click outside boxes → deselect ───────────────
document.addEventListener('mousedown', e => {
  if (!TB.active) return;
  if (e.target.closest('.inline-textbox')) return;
  if (e.target.closest('#tbFloatBar'))     return;
  tbDeselect();
});

// ── Switch tool → exit text mode ─────────────────
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.panel !== 'text') tbExit();
  });
});

// ── Apply all boxes to PDF ────────────────────────
$('addTextBtn').addEventListener('click', async () => {
  const pages = S.toolPages['text'];
  if (!pages?.length) return;
  const validBoxes = TB.boxes.filter(b => b.contentEl.innerText.trim().length > 0);
  if (!validBoxes.length) { toast('Add some text first.', 'error'); return; }

  for (const box of validBoxes) {
    const text    = box.contentEl.innerText.trim();
    const pageIdx = (box.page || 1) - 1;
    if (!pages[pageIdx]) continue;

    // box.left/top are canvas-relative pixels (layer == canvas, no offset)
    const bx = parseFloat(box.el.style.left) || 0;
    const by = parseFloat(box.el.style.top)  || 0;

    // Scale from canvas display size → PDF coordinate space
    // Use the canvas size that was recorded when this box was created
    const canvasW = box.canvasW;
    const canvasH = box.canvasH;

    const pdfPage  = await pages[pageIdx].pdfJsDoc.getPage(pages[pageIdx].pageNum);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const scaleX   = viewport.width  / canvasW;
    const scaleY   = viewport.height / canvasH;

    const cs   = window.getComputedStyle(box.contentEl);
    const size = Math.round(parseFloat(cs.fontSize) * scaleX);

    pages[pageIdx].overlays.push({
      type:   'text',
      text,
      size,
      x:      bx * scaleX,
      y:      by * scaleY,
      color:  rgbToHex(cs.color),
      font:   cs.fontFamily.replace(/['"]/g,'').split(',')[0].trim(),
      bold:   cs.fontWeight === 'bold' || parseInt(cs.fontWeight) >= 700,
      italic: cs.fontStyle === 'italic',
    });
  }

  loading(true, 'Building PDF…');
  try {
    dlBytes(await buildPdf(pages), 'text-edited.pdf');
    toast('✓ Text applied & downloaded!', 'success');
    tbClearAll();
  } catch(e) {
    console.error('[TB apply]', e);
    toast(`Error: ${e.message}`, 'error');
  } finally {
    loading(false);
  }
});

/* ── IMAGE OVERLAY ── */
$('addImageBtn').addEventListener('click',async()=>{
  const pages=S.toolPages['image']; if(!pages?.length)return;
  const fi=$('overlayImageInput'); if(!fi.files[0]){toast('Select an image.','error');return;}
  const pgNum=parseInt($('imgPage').value,10);
  if(pgNum<1||pgNum>pages.length){toast(`Page must be 1–${pages.length}.`,'error');return;}
  loading(true,'Loading image…');
  try{
    const imgEl=await loadImgEl(fi.files[0]);
    pages[pgNum-1].overlays.push({type:'image',imgEl,
      x:parseFloat($('imgX').value)||0,y:parseFloat($('imgY').value)||0,
      w:parseFloat($('imgW').value)||150,h:parseFloat($('imgH').value)||100});
    await previewMain(pgNum); setPlaceMode(null); toast('Image added!','success');
  }catch(e){toast(`Image error: ${e.message}`,'error');}
  finally{loading(false);}
});

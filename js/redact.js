'use strict';
/* PDF Studio · Redact: drag to draw boxes
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ── REDACT ── */
/* ══════════════════════════════════════════════════
   REDACT ,  smallpdf-style div boxes, pixel-perfect coords
══════════════════════════════════════════════════ */
const RD = {
  boxes:   [],   // { el, xFrac, yFrac, wFrac, hFrac, color }
  color:   '#000000',
  active:  false,
  drawing: false,
  startX:  0, startY: 0,
};

const rdLayer  = $('redactLayer');
const rdDrag   = document.createElement('div');
rdDrag.id = 'rdDragBox';
rdLayer.appendChild(rdDrag);

// Color picker
document.querySelectorAll('.rdclr').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rdclr').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    RD.color = btn.dataset.color;
  });
});

function rdSyncLayer() {
  const cv   = $('previewCanvas');
  const wrap = $('previewWrap');
  // Match canvas exactly, accounting for scroll (same logic as textBoxLayer)
  const wRect = wrap.getBoundingClientRect();
  const cRect = cv.getBoundingClientRect();
  rdLayer.style.top    = (cRect.top  - wRect.top  + wrap.scrollTop)  + 'px';
  rdLayer.style.left   = (cRect.left - wRect.left + wrap.scrollLeft) + 'px';
  rdLayer.style.width  = cRect.width  + 'px';
  rdLayer.style.height = cRect.height + 'px';
}

function rdEnter() {
  RD.active = true;
  RD.boxes  = [];
  rdLayer.classList.add('active');
  rdSyncLayer();
  rdRenderBoxes();
}
function rdExit() {
  RD.active = false;
  rdLayer.classList.remove('active');
  rdLayer.innerHTML = '';
  rdLayer.appendChild(rdDrag);
  rdUpdateList();
}

function rdUpdateList() {
  const list = $('redactBoxList');
  list.innerHTML = '';
  RD.boxes.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'rdbox-item';
    item.innerHTML = `<span>Box ${i+1} &nbsp;·&nbsp; ${Math.round(b.wFrac*100)}% × ${Math.round(b.hFrac*100)}%</span>
      <button onclick="rdRemoveBox(${i})"><i class="fa-solid fa-xmark"></i></button>`;
    list.appendChild(item);
  });
  $('redactApplyBtn').disabled = RD.boxes.length === 0;
  $('redactUndoBtn').disabled  = RD.boxes.length === 0;
  $('redactClearBtn').disabled = RD.boxes.length === 0;
}
window.rdRemoveBox = function(i) {
  RD.boxes[i]?.el?.remove();
  RD.boxes.splice(i, 1);
  rdUpdateList();
};

function rdCreateBox(xFrac, yFrac, wFrac, hFrac, color) {
  const cv  = $('previewCanvas');
  const el  = document.createElement('div');
  el.className = 'rdbox';
  el.style.left   = (xFrac * 100) + '%';
  el.style.top    = (yFrac * 100) + '%';
  el.style.width  = (wFrac * 100) + '%';
  el.style.height = (hFrac * 100) + '%';
  el.style.background = color || '#000';

  const xBtn = document.createElement('button');
  xBtn.className = 'rdx';
  xBtn.innerHTML = '×';
  const idx = RD.boxes.length;
  xBtn.addEventListener('click', e => {
    e.stopPropagation();
    const i = RD.boxes.indexOf(box);
    if (i >= 0) { RD.boxes[i].el.remove(); RD.boxes.splice(i, 1); rdUpdateList(); }
  });
  el.appendChild(xBtn);

  rdLayer.appendChild(el);
  const box = { el, xFrac, yFrac, wFrac, hFrac, color: color || '#000' };
  RD.boxes.push(box);
  rdUpdateList();
  return box;
}

function rdRenderBoxes() {
  // Re-render all existing boxes (after page change / resize)
  RD.boxes.forEach(b => {
    b.el.style.left   = (b.xFrac * 100) + '%';
    b.el.style.top    = (b.yFrac * 100) + '%';
    b.el.style.width  = (b.wFrac * 100) + '%';
    b.el.style.height = (b.hFrac * 100) + '%';
  });
}

// Mouse drag to draw boxes
rdLayer.addEventListener('mousedown', e => {
  if (!RD.active || e.target !== rdLayer && e.target !== rdDrag) return;
  const rect = rdLayer.getBoundingClientRect();
  RD.drawing = true;
  RD.startX  = e.clientX - rect.left;
  RD.startY  = e.clientY - rect.top;
  rdDrag.style.display = 'block';
  rdDrag.style.left   = RD.startX + 'px';
  rdDrag.style.top    = RD.startY + 'px';
  rdDrag.style.width  = '0';
  rdDrag.style.height = '0';
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!RD.drawing) return;
  const rect = rdLayer.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const x = Math.min(RD.startX, cx);
  const y = Math.min(RD.startY, cy);
  const w = Math.abs(cx - RD.startX);
  const h = Math.abs(cy - RD.startY);
  rdDrag.style.left   = x + 'px';
  rdDrag.style.top    = y + 'px';
  rdDrag.style.width  = w + 'px';
  rdDrag.style.height = h + 'px';
});

document.addEventListener('mouseup', e => {
  if (!RD.drawing) return;
  RD.drawing = false;
  rdDrag.style.display = 'none';
  const rect = rdLayer.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const x = Math.min(RD.startX, cx);
  const y = Math.min(RD.startY, cy);
  const w = Math.abs(cx - RD.startX);
  const h = Math.abs(cy - RD.startY);
  if (w < 8 || h < 8) return; // too small, ignore
  const lw = rect.width, lh = rect.height;
  rdCreateBox(x/lw, y/lh, w/lw, h/lh, RD.color);
});

// Undo / Clear
$('redactUndoBtn').addEventListener('click', () => {
  const b = RD.boxes.pop();
  if (b) { b.el.remove(); rdUpdateList(); }
});
$('redactClearBtn').addEventListener('click', () => {
  RD.boxes.forEach(b => b.el.remove());
  RD.boxes = [];
  rdUpdateList();
});

// Apply, burn boxes into overlays using fractional coords → PDF space
$('redactApplyBtn').addEventListener('click', async () => {
  const pages = S.toolPages['redact']; if (!pages?.length) return;
  if (!RD.boxes.length) { toast('Draw at least one box first.', 'error'); return; }

  loading(true, 'Applying redactions…');
  try {
    const pgIdx = S.curPage - 1;
    const pdfPage = await pages[pgIdx].pdfJsDoc.getPage(pages[pgIdx].pageNum);
    const vp      = pdfPage.getViewport({ scale: 1 });

    RD.boxes.forEach(b => {
      pages[pgIdx].overlays.push({
        type:  'redact',
        x:     b.xFrac * vp.width,
        y:     b.yFrac * vp.height,
        w:     b.wFrac * vp.width,
        h:     b.hFrac * vp.height,
        color: b.color,
      });
    });

    // Clear boxes and re-render
    RD.boxes.forEach(b => b.el.remove());
    RD.boxes = [];
    rdUpdateList();
    await previewMain(S.curPage);
    toast('Redactions applied!', 'success');
  } finally { loading(false); }
});

// Hook into enterRedactMode / exitRedactMode
function enterRedactMode() { rdEnter(); }
function exitRedactMode()  { rdExit(); }

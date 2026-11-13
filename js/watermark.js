'use strict';
/* PDF Studio · Watermark: live, draggable preview
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ══════════════════════════════════════════════════
   WATERMARK ,  live preview, draggable, real-time styling
══════════════════════════════════════════════════ */

const WM = {
  // Position as fraction of canvas (0–1), default centre
  xFrac: 0.5,
  yFrac: 0.5,
  imgEl: null,      // loaded image element for image watermarks
  active: false,    // true when watermark panel is open & PDF loaded
};

// ── Tab switching ──────────────────────────────────
document.querySelectorAll('.tab-btn[data-wtab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn[data-wtab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('wmTextTab').classList.toggle('hidden', btn.dataset.wtab !== 'text');
    $('wmImageTab').classList.toggle('hidden', btn.dataset.wtab !== 'image');
    wmDrawPreview();
  });
});

// ── Bold / Italic buttons ──────────────────────────
$('wmBold')?.addEventListener('click',   () => { $('wmBold').classList.toggle('active');   wmDrawPreview(); });
$('wmItalic')?.addEventListener('click', () => { $('wmItalic').classList.toggle('active'); wmDrawPreview(); });

// ── All live-update inputs ─────────────────────────
['wmText','wmFont','wmSize','wmColor','wmOpacity','wmAngle','wmImgW','wmImgH'].forEach(id => {
  $(id)?.addEventListener('input',  wmDrawPreview);
  $(id)?.addEventListener('change', wmDrawPreview);
});
$('wmOpacity').addEventListener('input', () => {
  $('wmOpacityVal').textContent = $('wmOpacity').value + '%';
  wmDrawPreview();
});

// Image upload → load & preview immediately
$('wmImageInput').addEventListener('change', async () => {
  const f = $('wmImageInput').files[0];
  if (!f) return;
  try { WM.imgEl = await loadImgEl(f); wmDrawPreview(); }
  catch(e) { toast(e.message, 'error'); }
});

// ── Build current watermark descriptor from UI ─────
function wmGetDesc() {
  const isImg   = !$('wmImageTab').classList.contains('hidden');
  const opacity = (+$('wmOpacity').value) / 100;
  const angle   = +$('wmAngle').value;
  if (isImg) {
    return { type:'watermark', opacity, angle, imgEl: WM.imgEl,
             w: +$('wmImgW').value || 300, h: +$('wmImgH').value || 200 };
  }
  return {
    type: 'watermark', opacity, angle,
    text:   $('wmText').value || 'WATERMARK',
    size:   +$('wmSize').value || 60,
    color:  $('wmColor').value || '#000000',
    font:   $('wmFont').value  || 'Arial',
    bold:   !!$('wmBold').classList.contains('active'),
    italic: !!$('wmItalic').classList.contains('active'),
  };
}

// ── Draw watermark onto a canvas at given position ─
function wmRenderToCanvas(ctx, canvasW, canvasH, desc, xFrac, yFrac) {
  ctx.save();
  ctx.globalAlpha = desc.opacity || 0.3;
  ctx.translate(canvasW * xFrac, canvasH * yFrac);
  ctx.rotate((desc.angle || 0) * Math.PI / 180);
  if (desc.imgEl) {
    const w = desc.w || 300, h = desc.h || 200;
    ctx.drawImage(desc.imgEl, -w / 2, -h / 2, w, h);
  } else {
    const weight = desc.bold   ? 'bold '   : '';
    const style  = desc.italic ? 'italic ' : '';
    ctx.font         = `${style}${weight}${desc.size || 60}px ${desc.font || 'Arial'}`;
    ctx.fillStyle    = desc.color || '#000000';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(desc.text || '', 0, 0);
  }
  ctx.restore();
}

// ── Redraw the live preview canvas ─────────────────
function wmDrawPreview() {
  const cv  = $('previewCanvas');
  const wmc = $('wmPreviewCanvas');
  if (!WM.active || cv.classList.contains('hidden')) return;

  wmc.width  = cv.offsetWidth;
  wmc.height = cv.offsetHeight;
  wmc.style.width  = cv.offsetWidth  + 'px';
  wmc.style.height = cv.offsetHeight + 'px';

  const ctx  = wmc.getContext('2d');
  ctx.clearRect(0, 0, wmc.width, wmc.height);
  // Draw at the same scale as the page preview so what you see is what you get
  const k = CFG.PREVIEW_SCALE * S.zoom, d = wmGetDesc();
  if (d.size) d.size *= k;
  if (d.w) { d.w *= k; d.h *= k; }
  wmRenderToCanvas(ctx, wmc.width, wmc.height, d, WM.xFrac, WM.yFrac);
}

// ── Draggable watermark on preview canvas ──────────
(function() {
  let dragging = false, lastX, lastY;
  const wmc = $('wmPreviewCanvas');

  wmc.addEventListener('mousedown', e => {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    wmc.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const cv   = $('previewCanvas');
    const rect = wmc.getBoundingClientRect();
    WM.xFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    WM.yFrac = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
    wmDrawPreview();
  });
  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; $('wmPreviewCanvas').style.cursor = 'move'; }
  });
  // Touch support
  wmc.addEventListener('touchstart', e => {
    dragging = true; const t = e.touches[0]; lastX = t.clientX; lastY = t.clientY;
    e.preventDefault();
  }, { passive: false });
  wmc.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    const rect = wmc.getBoundingClientRect();
    WM.xFrac = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width));
    WM.yFrac = Math.max(0, Math.min(1, (t.clientY - rect.top)  / rect.height));
    wmDrawPreview();
    e.preventDefault();
  }, { passive: false });
  wmc.addEventListener('touchend', () => { dragging = false; });
})();

// ── Activate / deactivate preview ─────────────────
function wmActivate() {
  WM.active = true;
  WM.xFrac  = 0.5;
  WM.yFrac  = 0.5;
  $('wmPreviewCanvas').classList.add('active');

  // Position the preview canvas over the PDF canvas
  const cv  = $('previewCanvas');
  const wmc = $('wmPreviewCanvas');
  wmc.style.top  = cv.offsetTop  + 'px';
  wmc.style.left = cv.offsetLeft + 'px';
  wmUpdateUndoBtns();
  wmDrawPreview();
}
function wmDeactivate() {
  WM.active = false;
  $('wmPreviewCanvas').classList.remove('active');
  const wmc = $('wmPreviewCanvas');
  const ctx = wmc.getContext('2d');
  ctx.clearRect(0, 0, wmc.width, wmc.height);
}

// Hook into tool switching
const _origActivatePanel = typeof activatePanel === 'function' ? activatePanel : null;
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.panel === 'watermark') {
      setTimeout(() => {
        if (S.toolPages['watermark']?.length) wmActivate();
      }, 100);
    } else {
      wmDeactivate();
    }
  });
});

// ── Update undo/remove button states ──────────────
function wmUpdateUndoBtns() {
  const pages   = S.toolPages['watermark'] || [];
  const hasAny  = pages.some(p => p.overlays.some(o => o.type === 'watermark'));
  $('wmUndoBtn').disabled  = !hasAny;
  $('wmClearBtn').disabled = !hasAny;
}

// ── Undo last watermark (removes most recently applied batch) ──
$('wmUndoBtn').addEventListener('click', async () => {
  const pages = S.toolPages['watermark'];
  if (!pages?.length) return;
  // Find the last watermark overlay added and remove that entire batch
  // We track by removing the last watermark from each page simultaneously
  let removed = false;
  pages.forEach(p => {
    // Find last watermark index on this page
    for (let i = p.overlays.length - 1; i >= 0; i--) {
      if (p.overlays[i].type === 'watermark') {
        p.overlays.splice(i, 1);
        removed = true;
        break; // only remove last one per page
      }
    }
  });
  if (removed) {
    await previewMain(S.curPage);
    wmUpdateUndoBtns();
    toast('Last watermark removed.', 'success');
  }
});

// ── Remove ALL watermarks from all pages ───────────
$('wmClearBtn').addEventListener('click', async () => {
  const pages = S.toolPages['watermark'];
  if (!pages?.length) return;
  pages.forEach(p => {
    p.overlays = p.overlays.filter(o => o.type !== 'watermark');
  });
  await previewMain(S.curPage);
  wmUpdateUndoBtns();
  toast('All watermarks removed.', 'success');
});
$('wmBtn').addEventListener('click', async () => {
  const pages = S.toolPages['watermark'];
  if (!pages?.length) return;

  const desc   = wmGetDesc();
  const isImg  = !!desc.imgEl;
  const filter = $('wmPages').value;

  if (isImg && !desc.imgEl) { toast('Select a watermark image.', 'error'); return; }
  if (!isImg && !desc.text.trim()) { toast('Enter watermark text.', 'error'); return; }

  const pdfPage  = await pages[0].pdfJsDoc.getPage(pages[0].pageNum);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const xPdf = WM.xFrac * viewport.width;
  const yPdf = WM.yFrac * viewport.height;

  loading(true, 'Applying watermark…');
  try {
    pages.forEach((p, i) => {
      const n = i + 1;
      const match = filter === 'all'
        || (filter === 'odd'   && n % 2 !== 0)
        || (filter === 'even'  && n % 2 === 0)
        || (filter === 'first' && n === 1);
      if (match) {
        p.overlays.push({ ...desc, xFrac: WM.xFrac, yFrac: WM.yFrac, xPdf, yPdf });
      }
    });
    await previewMain(S.curPage);
    wmUpdateUndoBtns();
    toast('Watermark applied!', 'success');
  } finally {
    loading(false);
  }
});

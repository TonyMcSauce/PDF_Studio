'use strict';
/* PDF Studio · Page numbers
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ── PAGE NUMBERS ── */
// Live preview helper, computes overlay for given page index
async function pnMakeOverlay(pages, i) {
  const pos   = $('pnPosition').value;
  const start = parseInt($('pnStart').value, 10) || 1;
  const size  = +$('pnSize').value || 14;
  const color = $('pnColor').value;
  const fmt   = $('pnFormat').value;
  const total = pages.length;
  const n     = i + start;
  const text  = fmt==='n' ? `${n}` : fmt==='of' ? `${n} of ${total}` : fmt==='dash' ? `- ${n} -` : `Page ${n}`;
  const pg    = await pages[i].pdfJsDoc.getPage(pages[i].pageNum);
  const rot   = (pg.getViewport({scale:1}).rotation + pages[i].rotation) % 360;
  const vp    = pg.getViewport({scale:1, rotation:rot});
  const W = vp.width, H = vp.height, pad = 20;
  let x, y, align = 'center';
  if      (pos==='bottom-center') { x=W/2;   y=H-pad;      align='center'; }
  else if (pos==='bottom-right')  { x=W-pad; y=H-pad;      align='right';  }
  else if (pos==='bottom-left')   { x=pad;   y=H-pad;      align='left';   }
  else if (pos==='top-center')    { x=W/2;   y=pad+size;   align='center'; }
  else if (pos==='top-right')     { x=W-pad; y=pad+size;   align='right';  }
  else                            { x=pad;   y=pad+size;   align='left';   }
  return { type:'pagenumber', text, size, color, x, y, align };
}

// Preview: apply temp overlay to current page and re-render (don't save)
async function pnPreview() {
  const pages = S.toolPages['pagenumbers'];
  if (!pages?.length) return;
  const idx = S.curPage - 1;
  // Remove any existing preview overlay, add fresh one
  pages[idx].overlays = pages[idx].overlays.filter(o => o.type !== 'pagenumber_preview');
  const o = await pnMakeOverlay(pages, idx);
  o.type = 'pagenumber_preview'; // mark as preview, not saved
  pages[idx].overlays.push(o);
  await previewMain(S.curPage);
  // Clean up preview overlay (it's just for display, removed on next render)
  pages[idx].overlays = pages[idx].overlays.filter(o => o.type !== 'pagenumber_preview');
}

// Wire all pn inputs to trigger live preview
['pnPosition','pnStart','pnSize','pnColor','pnFormat'].forEach(id => {
  $(id)?.addEventListener('input',  pnPreview);
  $(id)?.addEventListener('change', pnPreview);
});

function pnUpdateUndoBtn() {
  const pages  = S.toolPages['pagenumbers'] || [];
  const hasAny = pages.some(p => p.overlays.some(o => o.type === 'pagenumber'));
  $('pnUndoBtn').disabled  = !hasAny;
  $('pnClearBtn').disabled = !hasAny;
}

$('pnBtn').addEventListener('click', async () => {
  const pages = S.toolPages['pagenumbers']; if (!pages?.length) return;
  loading(true, 'Adding page numbers…');
  try {
    const jobs = pages.map(async (p, i) => {
      const o = await pnMakeOverlay(pages, i);
      p.overlays.push(o);
    });
    await Promise.all(jobs);
    await previewMain(S.curPage);
    pnUpdateUndoBtn();
    toast('Page numbers added!', 'success');
  } finally { loading(false); }
});

$('pnUndoBtn').addEventListener('click', async () => {
  const pages = S.toolPages['pagenumbers']; if (!pages?.length) return;
  pages.forEach(p => {
    for (let i = p.overlays.length - 1; i >= 0; i--) {
      if (p.overlays[i].type === 'pagenumber') { p.overlays.splice(i, 1); break; }
    }
  });
  await previewMain(S.curPage);
  pnUpdateUndoBtn();
  toast('Last page numbers removed.', 'success');
});

$('pnClearBtn').addEventListener('click', async () => {
  const pages = S.toolPages['pagenumbers']; if (!pages?.length) return;
  pages.forEach(p => { p.overlays = p.overlays.filter(o => o.type !== 'pagenumber'); });
  await previewMain(S.curPage);
  pnUpdateUndoBtn();
  toast('All page numbers removed.', 'success');
});

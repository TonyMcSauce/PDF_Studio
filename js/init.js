'use strict';
/* PDF Studio · Main download button and start-up
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ── DOWNLOAD (main button, current tool's pages) ── */
$('downloadBtn').addEventListener('click',async()=>{
  if(!S.pages.length)return;
  loading(true,'Building PDF…');
  try{ dlBytes(await buildPdf(S.pages),'edited.pdf'); toast('Downloaded!','success'); }
  catch(e){ console.error(e); toast(`Failed: ${e.message}`,'error'); }
  finally{ loading(false); }
});

/* ── KEYBOARD SHORTCUTS (ignored while typing in a field or text box) ── */
document.addEventListener('keydown', e => {
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable="true"], .img-box')) return;
  if (e.altKey || $('editorScreen').classList.contains('hidden')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {            // Ctrl/Cmd + S downloads the current result
    e.preventDefault();
    if (!$('downloadBtn').disabled) $('downloadBtn').click();
    return;
  }
  if (mod) return;
  if (e.key === 'PageDown' || e.key === 'ArrowRight' && !e.shiftKey && t === document.body) { if (!$('nextPage').disabled) $('nextPage').click(); }
  else if (e.key === 'PageUp' || e.key === 'ArrowLeft' && !e.shiftKey && t === document.body) { if (!$('prevPage').disabled) $('prevPage').click(); }
  else if (e.key === '+' || e.key === '=') { if (!$('zoomIn').disabled)  $('zoomIn').click(); }
  else if (e.key === '-') { if (!$('zoomOut').disabled) $('zoomOut').click(); }
});

/* ── INIT ── */
showHome();
console.log('%c PDF Studio v8 ','background:#e8452c;color:#fff7ea;font-size:1rem;padding:3px 12px;border-radius:2px');

/* Offline support: cache the app so local tools work without a connection */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

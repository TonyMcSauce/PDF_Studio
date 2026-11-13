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

/* ── INIT ── */
showHome();
console.log('%c PDF Studio v8 ','background:#e8452c;color:#fff7ea;font-size:1rem;padding:3px 12px;border-radius:2px');

/* Offline support: cache the app so local tools work without a connection */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

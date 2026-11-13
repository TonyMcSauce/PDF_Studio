'use strict';
/* PDF Studio · Assemble tools: merge, split, compress, images to PDF, organize pages
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ── MERGE ── */
async function addMergeFiles(files) {
  loading(true, 'Loading…');
  try {
    for (const f of Array.from(files)) {
      if (f.type !== 'application/pdf') { toast(`Not a PDF: ${f.name}`, 'error'); continue; }
      if (!okSize(f)) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc   = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      S.mergeSources.push({ name: f.name, pdfJsDoc: doc, curPage: 1 });
    }
    S._mergeViewIdx = Math.max(0, S.mergeSources.length - 1);
    refreshMergeList(); await refreshMergePreview();
  } catch(e) { console.error(e); toast(e.message, 'error'); }
  finally { loading(false); }
}
function refreshMergeList() {
  const list = $('mergeList'); list.innerHTML = '';
  S.mergeSources.forEach((src, i) => {
    const li = document.createElement('li');
    li.className = 'merge-item' + (i === S._mergeViewIdx ? ' active' : '');
    li.innerHTML = `<i class="fa-solid fa-file-pdf"></i>
      <span class="merge-item-name" title="${src.name}">${src.name}</span>
      <small class="merge-item-size">${src.pdfJsDoc.numPages}p</small>
      <button class="icon-btn" onclick="viewMergeDoc(${i})"><i class="fa-solid fa-eye"></i></button>
      <button class="icon-btn danger" onclick="removeMergeDoc(${i})"><i class="fa-solid fa-xmark"></i></button>`;
    list.appendChild(li);
  });
  $('mergeBtn').disabled = S.mergeSources.length < 2;
  const src = S.mergeSources[S._mergeViewIdx];
  $('mergeDocLabel').textContent = src ? `${src.name.slice(0,22)}, pg ${src.curPage}/${src.pdfJsDoc.numPages}` : 'No PDFs added yet';
  $('mergePrevDoc').disabled = S._mergeViewIdx <= 0;
  $('mergeNextDoc').disabled = S._mergeViewIdx >= S.mergeSources.length - 1;
  $('mergePrevPg').disabled  = !src || src.curPage <= 1;
  $('mergeNextPg').disabled  = !src || src.curPage >= src.pdfJsDoc.numPages;
}
window.viewMergeDoc   = i => { S._mergeViewIdx=i; S.mergeSources[i].curPage=1; refreshMergeList(); refreshMergePreview(); };
window.removeMergeDoc = i => { S.mergeSources.splice(i,1); S._mergeViewIdx=Math.max(0,Math.min(S._mergeViewIdx,S.mergeSources.length-1)); refreshMergeList(); refreshMergePreview(); };

async function refreshMergePreview() {
  const cv=$('mergePreviewCanvas'), ph=$('mergePreviewPlaceholder');
  const src = S.mergeSources[S._mergeViewIdx];
  if (!src) { hide(cv); show(ph); refreshMergeList(); return; }
  src.curPage = Math.max(1, Math.min(src.curPage, src.pdfJsDoc.numPages));
  const pg = await src.pdfJsDoc.getPage(src.curPage);
  const vp = pg.getViewport({ scale: CFG.PREVIEW_SCALE });
  cv.width = vp.width; cv.height = vp.height; show(cv); hide(ph);
  await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  refreshMergeList();
}

$('mergeInput').addEventListener('change', async e => { await addMergeFiles(e.target.files); e.target.value=''; });
const muz = $('mergeUploadZone');
muz.addEventListener('dragover',  e => { e.preventDefault(); muz.classList.add('drag-over'); });
muz.addEventListener('dragleave', () => muz.classList.remove('drag-over'));
muz.addEventListener('drop', async e => { e.preventDefault(); muz.classList.remove('drag-over'); await addMergeFiles(e.dataTransfer.files); });
$('mergePrevDoc').addEventListener('click',()=>{S._mergeViewIdx--;S.mergeSources[S._mergeViewIdx].curPage=1;refreshMergeList();refreshMergePreview();});
$('mergeNextDoc').addEventListener('click',()=>{S._mergeViewIdx++;S.mergeSources[S._mergeViewIdx].curPage=1;refreshMergeList();refreshMergePreview();});
$('mergePrevPg').addEventListener('click',()=>{const s=S.mergeSources[S._mergeViewIdx];if(s){s.curPage--;refreshMergePreview();}});
$('mergeNextPg').addEventListener('click',()=>{const s=S.mergeSources[S._mergeViewIdx];if(s){s.curPage++;refreshMergePreview();}});
$('mergeBtn').addEventListener('click', async () => {
  if (S.mergeSources.length < 2) return;
  loading(true,'Merging…');
  try {
    const descs = S.mergeSources.flatMap(src =>
      Array.from({length:src.pdfJsDoc.numPages},(_,i)=>({pdfJsDoc:src.pdfJsDoc,pageNum:i+1,rotation:0,overlays:[]})));
    dlBytes(await buildPdf(descs), 'merged.pdf');
    toast(`Merged ${S.mergeSources.length} PDFs!`, 'success');
  } catch(e) { console.error(e); toast(`Merge failed: ${e.message}`, 'error'); }
  finally { loading(false); }
});

/* ── SPLIT ── */
function updateSplitHint() {
  const n = S.toolPages['split']?.length || 0;
  $('splitPageCount').textContent = n ? `Document has ${n} pages` : '';
  if (n) { $('splitTo').value=n; $('splitFrom').max=$('splitTo').max=n; }
}
$('splitBtn').addEventListener('click', async () => {
  const pages = S.toolPages['split']; if (!pages?.length) return;
  const from=parseInt($('splitFrom').value,10), to=parseInt($('splitTo').value,10);
  if (!Number.isFinite(from)||!Number.isFinite(to)||from<1||to>pages.length||from>to){toast('Invalid range.','error');return;}
  loading(true,'Splitting…');
  try { dlBytes(await buildPdf(pages.slice(from-1,to)), `pages_${from}-${to}.pdf`); toast(`Pages ${from}–${to} extracted!`,'success'); }
  catch(e){ console.error(e); toast(`Split failed: ${e.message}`,'error'); }
  finally { loading(false); }
});


/* ── COMPRESS ── */
document.querySelectorAll('.compress-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.compress-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    S.compressQuality = parseFloat(opt.dataset.quality);
  });
});
$('compressBtn').addEventListener('click', async () => {
  const pages = S.toolPages['compress']; if (!pages?.length) return;
  loading(true,'Compressing…');
  try { dlBytes(await buildPdf(pages, S.compressQuality, { rasterize: true }), 'compressed.pdf'); toast('Compressed PDF downloaded!','success'); }
  catch(e){ console.error(e); toast(`Compress failed: ${e.message}`,'error'); }
  finally { loading(false); }
});

/* ── IMAGES TO PDF ── */
async function addImgToPdfFiles(files) {
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) { toast(`Not an image: ${f.name}`,'error'); continue; }
    const imgEl = await loadImgEl(f);
    S.imgToPdfFiles.push({ file:f, imgEl });
  }
  refreshImgToPdfList();
}
function refreshImgToPdfList() {
  const list = $('imgToPdfList'); list.innerHTML='';
  S.imgToPdfFiles.forEach((item,i) => {
    const li = document.createElement('li');
    li.className = 'img-to-pdf-item';
    li.innerHTML = `<img src="${item.imgEl.src}" alt=""/>
      <span>${escHtml(item.file.name)}</span>
      <button class="icon-btn danger" onclick="removeImgFile(${i})"><i class="fa-solid fa-xmark"></i></button>`;
    list.appendChild(li);
  });
  $('imgToPdfBtn').disabled = S.imgToPdfFiles.length === 0;
  if (S.imgToPdfFiles.length > 1 && !S._imgSortable) {
    S._imgSortable = Sortable.create(list, { animation:150,
      onEnd(ev){const m=S.imgToPdfFiles.splice(ev.oldIndex,1)[0];S.imgToPdfFiles.splice(ev.newIndex,0,m);}
    });
  }
}
window.removeImgFile = i => { S.imgToPdfFiles.splice(i,1); refreshImgToPdfList(); };
const iuz = $('imgToPdfUploadZone');
$('imgToPdfInput').addEventListener('change', async e => { await addImgToPdfFiles(e.target.files); e.target.value=''; });
iuz.addEventListener('dragover',  e => { e.preventDefault(); iuz.classList.add('drag-over'); });
iuz.addEventListener('dragleave', () => iuz.classList.remove('drag-over'));
iuz.addEventListener('drop', async e => { e.preventDefault(); iuz.classList.remove('drag-over'); await addImgToPdfFiles(e.dataTransfer.files); });
$('imgToPdfBtn').addEventListener('click', async () => {
  if (!S.imgToPdfFiles.length) return;
  loading(true,'Converting images…');
  try {
    const doc = await PDFLib.PDFDocument.create();
    const sizes = { A4:[595.28,841.89], Letter:[612,792] };
    const psize = $('imgToPdfPageSize').value;
    const ori   = $('imgToPdfOrientation').value;
    for (const item of S.imgToPdfFiles) {
      let img;
      if (item.file.type === 'image/png') {
        // Embed PNGs losslessly, transparency intact
        img = await doc.embedPng(new Uint8Array(await item.file.arrayBuffer()));
      } else {
        // JPEGs go through a canvas so phone photos keep their EXIF orientation
        const cv = document.createElement('canvas');
        cv.width=item.imgEl.naturalWidth; cv.height=item.imgEl.naturalHeight;
        cv.getContext('2d').drawImage(item.imgEl,0,0);
        img = await doc.embedJpg(dataUrlToBytes(cv.toDataURL('image/jpeg',0.95)));
      }
      const iw=item.imgEl.naturalWidth, ih=item.imgEl.naturalHeight;
      let pw,ph;
      if (psize==='fit') { pw=iw; ph=ih; }
      else { [pw,ph]=(sizes[psize]||sizes.A4); if(ori==='landscape')[pw,ph]=[ph,pw]; }
      const page=doc.addPage([pw,ph]);
      const sc=Math.min(pw/iw,ph/ih);
      page.drawImage(img,{x:(pw-iw*sc)/2,y:(ph-ih*sc)/2,width:iw*sc,height:ih*sc});
    }
    dlBytes(await doc.save(),'images.pdf');
    toast(`Converted ${S.imgToPdfFiles.length} image(s) to PDF!`,'success');
  } catch(e){ console.error(e); toast(`Failed: ${e.message}`,'error'); }
  finally { loading(false); }
});

/* ── PAGE GRID (pages tool) ── */
let sortable = null;
async function renderGrid() {
  const pages = S.toolPages['pages']; if (!pages?.length) return;
  const grid = $('pageGrid'); grid.innerHTML = '';
  loading(true,'Rendering thumbnails…');
  try {
    for (let i=0;i<pages.length;i++) {
      const {canvas} = await renderPageToCanvas(pages[i], CFG.THUMB_SCALE);
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb'+(S.selectedPgs.has(i)?' selected':'');
      thumb.dataset.idx = i;
      canvas.style.cssText='width:100%;height:auto;display:block';
      const lbl = document.createElement('div');
      lbl.className='page-thumb-label'; lbl.textContent=`Page ${i+1}`;
      const chk = document.createElement('div');
      chk.className='page-thumb-select';
      chk.innerHTML='<i class="fa-solid fa-check" style="font-size:.6rem"></i>';
      thumb.append(canvas,lbl,chk);
      if (pages[i].rotation) {
        const rb=document.createElement('div');
        rb.className='page-rotation-badge'; rb.textContent=`${pages[i].rotation}°`;
        thumb.appendChild(rb);
      }
      thumb.addEventListener('click',()=>{
        const idx=+thumb.dataset.idx;
        if(S.selectedPgs.has(idx)){S.selectedPgs.delete(idx);thumb.classList.remove('selected');}
        else{S.selectedPgs.add(idx);thumb.classList.add('selected');}
        updateGridBtns();
      });
      grid.appendChild(thumb);
    }
    if(sortable) sortable.destroy();
    sortable=Sortable.create(grid,{animation:150,ghostClass:'sortable-ghost',onEnd(ev){
      const p=S.toolPages['pages'];
      const m=p.splice(ev.oldIndex,1)[0]; p.splice(ev.newIndex,0,m);
      grid.querySelectorAll('.page-thumb').forEach((el,i)=>{el.dataset.idx=i;el.querySelector('.page-thumb-label').textContent=`Page ${i+1}`;});
      S.selectedPgs.clear();
      // Update preview to show new page order
      const newCur = Math.min(S.curPage, p.length);
      previewMain(newCur);
      toast('Reordered. Download to save.','info');
    }});
  } finally { loading(false); }
  updateGridBtns();
}
function updateGridBtns(){const h=S.selectedPgs.size>0;$('deleteSelectedBtn').disabled=!h;$('rotateLeftBtn').disabled=!h;$('rotateRightBtn').disabled=!h;}
$('selectAllBtn').addEventListener('click',()=>{const p=S.toolPages['pages']||[];p.forEach((_,i)=>S.selectedPgs.add(i));document.querySelectorAll('.page-thumb').forEach(t=>t.classList.add('selected'));updateGridBtns();});
$('deselectAllBtn').addEventListener('click',()=>{S.selectedPgs.clear();document.querySelectorAll('.page-thumb').forEach(t=>t.classList.remove('selected'));updateGridBtns();});
$('deleteSelectedBtn').addEventListener('click',async()=>{
  const p=S.toolPages['pages']||[];
  if(!S.selectedPgs.size||S.selectedPgs.size>=p.length){toast('Cannot delete all pages.','error');return;}
  if(!confirm(`Delete ${S.selectedPgs.size} page(s)?`))return;
  [...S.selectedPgs].sort((a,b)=>b-a).forEach(i=>p.splice(i,1));
  S.selectedPgs.clear();
  await renderGrid();
  if(S.activeTool==='pages') previewMain(Math.min(S.curPage,p.length));
  toast('Deleted.','success');
});
async function rotateSel(deg){
  const p=S.toolPages['pages']||[]; if(!S.selectedPgs.size)return;
  S.selectedPgs.forEach(i=>{p[i].rotation=(p[i].rotation+deg+360)%360;});
  S.selectedPgs.clear();
  await renderGrid();
  if(S.activeTool==='pages') previewMain(S.curPage);
  toast(`Rotated.`,'success');
}
$('rotateLeftBtn').addEventListener('click',()=>rotateSel(-90));
$('rotateRightBtn').addEventListener('click',()=>rotateSel(90));

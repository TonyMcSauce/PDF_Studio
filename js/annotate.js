'use strict';
/* PDF Studio · Annotate: freehand, highlight, shapes and arrows
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ── ANNOTATE ── */
document.querySelectorAll('.annotate-tool-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.annotate-tool-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); S.annoteTool=btn.dataset.atool;
  });
});
const dl=$('drawingLayer');
function getDrawPos(e){
  // Always measure against previewCanvas, not drawingLayer, to avoid CSS offset issues
  const cv=document.getElementById('previewCanvas');
  const rect=cv.getBoundingClientRect(),src=e.touches?e.touches[0]:e;
  return{x:(src.clientX-rect.left)*(cv.width/rect.width),y:(src.clientY-rect.top)*(cv.height/rect.height)};
}
function enterAnnotateMode(){
  show(dl); dl.classList.add('active');
  $('previewWrap').classList.add('drawing-active'); S.annoteStrokes=[];
}
function exitAnnotateMode(){
  dl.getContext('2d').clearRect(0,0,dl.width,dl.height);
  hide(dl); dl.classList.remove('active');
  $('previewWrap').classList.remove('drawing-active');
}
function redrawAnnoteLayer(){
  const ctx=dl.getContext('2d'); ctx.clearRect(0,0,dl.width,dl.height);
  const sc=CFG.PREVIEW_SCALE*S.zoom;
  S.annoteStrokes.forEach(o=>drawAnnotation(ctx,o,sc));
}
dl.addEventListener('mousedown',e=>{
  if(!$('previewWrap').classList.contains('drawing-active'))return;
  e.preventDefault(); S.annoteDrawing=true;
  const p=getDrawPos(e),sc=CFG.PREVIEW_SCALE*S.zoom;
  const color=$('annotateColor').value,size=+$('annotateSize').value;
  if(S.annoteTool==='freehand'){S.annoteCurStroke={type:'annotation',tool:'freehand',color,size,points:[{x:p.x/sc,y:p.y/sc}]};}
  else{S.annoteStart=p;S.annoteCurStroke={type:'annotation',tool:S.annoteTool,color,size,x:p.x/sc,y:p.y/sc,w:0,h:0};}
});
dl.addEventListener('mousemove',e=>{
  if(!S.annoteDrawing||!S.annoteCurStroke)return; e.preventDefault();
  const p=getDrawPos(e),sc=CFG.PREVIEW_SCALE*S.zoom;
  if(S.annoteTool==='freehand'){S.annoteCurStroke.points.push({x:p.x/sc,y:p.y/sc});}
  else{const st=S.annoteStart;S.annoteCurStroke.w=(p.x-st.x)/sc;S.annoteCurStroke.h=(p.y-st.y)/sc;}
  redrawAnnoteLayer(); drawAnnotation(dl.getContext('2d'),S.annoteCurStroke,sc);
});
dl.addEventListener('mouseup',()=>{if(!S.annoteDrawing)return;S.annoteDrawing=false;if(S.annoteCurStroke){S.annoteStrokes.push(S.annoteCurStroke);S.annoteCurStroke=null;}redrawAnnoteLayer();});
dl.addEventListener('mouseleave',()=>{if(S.annoteDrawing){S.annoteDrawing=false;if(S.annoteCurStroke){S.annoteStrokes.push(S.annoteCurStroke);S.annoteCurStroke=null;}redrawAnnoteLayer();}});
$('annotateUndoBtn').addEventListener('click',()=>{S.annoteStrokes.pop();redrawAnnoteLayer();});
$('annotateClearBtn').addEventListener('click',()=>{S.annoteStrokes=[];redrawAnnoteLayer();});
$('annotateApplyBtn').addEventListener('click',async()=>{
  const pages=S.toolPages['annotate']; if(!pages?.length)return;
  const pgNum=S.curPage;
  if(pgNum<1||pgNum>pages.length){toast(`Page must be 1–${pages.length}.`,'error');return;}
  pages[pgNum-1].overlays.push(...S.annoteStrokes);
  S.annoteStrokes=[]; exitAnnotateMode();
  await previewMain(pgNum); enterAnnotateMode();
  toast('Annotations applied!','success');
});

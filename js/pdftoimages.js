'use strict';
/* PDF Studio · PDF to Images
   Renders pages with PDF.js and saves them as JPG or PNG. One page downloads
   as an image; several are bundled into a ZIP. Runs on this device.
   Shares globals from core.js and the IK toolkit from imagekit.js. */

function piUpdate() {
  const pages = S.toolPages.pdftoimages || [], n = pages.length;
  const mode = $('pdfImgPages').value;
  $('pdfImgRange').classList.toggle('hidden', mode !== 'range');
  $('pdfImgQualityWrap').classList.toggle('hidden', $('pdfImgFormat').value !== 'jpeg');
  $('pdfImgQualityVal').textContent = $('pdfImgQuality').value + '%';
  if (!n) return;
  $('pdfImgFrom').max = $('pdfImgTo').max = n;
  const sel = piSelection();
  const dpi = +$('pdfImgDpi').value;
  $('pdfImgHint').textContent = sel.length
    ? `${sel.length} image${sel.length === 1 ? '' : 's'} at ${dpi} DPI${sel.length > 1 ? ', downloaded as a ZIP' : ''}.`
    : `Choose pages between 1 and ${n}.`;
  $('pdfImgBtn').disabled = !sel.length;
}

function piSelection() {
  const n = (S.toolPages.pdftoimages || []).length;
  const mode = $('pdfImgPages').value;
  if (!n) return [];
  if (mode === 'current') return [S.activeTool === 'pdftoimages' ? S.curPage : 1];
  if (mode === 'range') {
    const a = Math.max(1, +$('pdfImgFrom').value || 1), b = Math.min(n, +$('pdfImgTo').value || n);
    return a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [];
  }
  return Array.from({ length: n }, (_, i) => i + 1);
}

['pdfImgPages', 'pdfImgFormat', 'pdfImgDpi', 'pdfImgFrom', 'pdfImgTo'].forEach(id =>
  $(id).addEventListener('change', piUpdate));
$('pdfImgQuality').addEventListener('input', piUpdate);
['prevPage', 'nextPage'].forEach(id => $(id).addEventListener('click', () => setTimeout(piUpdate, 0)));

// Called by core.js once a PDF has loaded: start with the whole document
function piLoaded() {
  $('pdfImgFrom').value = 1;
  $('pdfImgTo').value = (S.toolPages.pdftoimages || []).length;
  piUpdate();
}

$('pdfImgBtn').addEventListener('click', async () => {
  const pages = S.toolPages.pdftoimages || [];
  const sel = piSelection();
  if (!pages.length || !sel.length) return;
  const fmt = $('pdfImgFormat').value, mime = IK.MIME[fmt];
  const quality = +$('pdfImgQuality').value / 100;
  const dpi = +$('pdfImgDpi').value;
  const base = IK.baseName(S.toolFileNames?.pdftoimages || 'document');
  const pad = String(pages.length).length;
  const out = [];
  try {
    for (let i = 0; i < sel.length; i++) {
      loading(true, `Saving page ${sel[i]} (${i + 1} / ${sel.length})…`);
      const desc = pages[sel[i] - 1];
      const pg = await desc.pdfJsDoc.getPage(desc.pageNum);
      const vp = pg.getViewport({ scale: 1 });
      let scale = dpi / 72;
      const px = vp.width * vp.height * scale * scale;
      if (px > IK.MAX_PX) scale *= Math.sqrt(IK.MAX_PX / px);
      const { canvas } = await renderPageToCanvas(desc, scale);
      const blob = await IK.encode(canvas, mime, fmt === 'jpeg' ? quality : undefined);
      canvas.width = canvas.height = 0;
      out.push({ name: `${base}-page-${String(sel[i]).padStart(pad, '0')}.${IK.EXT[fmt]}`, data: blob });
    }
    if (out.length === 1) IK.download(out[0].data, out[0].name);
    else { loading(true, 'Packing ZIP…'); IK.download(await IK.zip(out), `${base}-images.zip`); }
    const total = out.reduce((n, f) => n + f.data.size, 0);
    toast(`Saved ${out.length} page${out.length === 1 ? '' : 's'} as ${IK.LABEL[fmt]} · ${fmtSize(total)}`, 'success');
  } catch (e) { console.error(e); toast(`Failed: ${e.message}`, 'error'); }
  finally { loading(false); }
});

piUpdate();

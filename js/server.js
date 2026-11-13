'use strict';
/* PDF Studio · Server-backed tools: Protect (AES-256) and Office conversions
   Shares globals (S, CFG, $, helpers) from core.js. */

/* ── SECURITY, server-side AES-256 encryption via pikepdf ── */

$('applyPwdBtn').addEventListener('click', async () => {
  const pages = S.toolPages['security']; if (!pages?.length) return;
  const userPwd  = $('userPassword').value.trim();
  const ownerPwd = ($('ownerPassword').value || userPwd).trim();
  if (!userPwd) { toast('Enter a password first.', 'error'); return; }

  loading(true, 'Building PDF…');
  let pdfBytes;
  try {
    pdfBytes = await buildPdf(pages);
  } catch(e) {
    console.error(e);
    toast(`PDF build failed: ${e.message}`, 'error');
    loading(false); return;
  }

  loading(true, 'Encrypting… (server may take 15s to wake)');
  try {
    const formData = new FormData();
    formData.append('file', new Blob([pdfBytes], { type:'application/pdf' }), 'document.pdf');
    formData.append('userPassword', userPwd);
    formData.append('ownerPassword', ownerPwd);

    const res = await fetch(`${CFG.SERVER_URL}/encrypt`, {
      method: 'POST', body: formData, mode: 'cors',
      signal: mkTimeout(90000),
    });

    // Server sends heartbeat spaces then JSON, strip and parse
    const raw = await res.text();
    let json;
    try { json = JSON.parse(raw.trim()); }
    catch(_) { throw new Error(`Server error (${res.status}): ${raw.slice(0,200)}`); }

    if (!json.ok) throw new Error(json.error || 'Encryption failed on server');

    // base64 → Uint8Array → download
    const bin = atob(json.data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    dlBytes(out, 'protected.pdf');

    $('userPassword').value  = '';
    $('ownerPassword').value = '';
    toast('✓ Password-protected PDF downloaded!', 'success');
  } catch(e) {
    console.error(e);
    toast(`Encryption failed: ${e.message}`, 'error');
  } finally {
    loading(false);
  }
});

/* ══════════════════════════════════════════════════
   SERVER-SIDE CONVERSIONS
   PDF → Word / Excel / PowerPoint via Render server
══════════════════════════════════════════════════ */

const SERVER_URL = CFG.SERVER_URL;

[
  { tool:'pdftoword',  zoneId:'pdftowordUploadZone',  infoId:'pdftowordFileInfo',  btnId:'pdftowordBtn',  statusId:'pdftowordStatus',  endpoint:'/convert/word',  ext:'docx', label:'Word' },
  { tool:'pdftoexcel', zoneId:'pdftoexcelUploadZone', infoId:'pdftoexcelFileInfo', btnId:'pdftoexcelBtn', statusId:'pdftoexcelStatus', endpoint:'/convert/excel', ext:'xlsx', label:'Excel' },
  { tool:'pdftopptx',  zoneId:'pdftopptxUploadZone',  infoId:'pdftopptxFileInfo',  btnId:'pdftopptxBtn',  statusId:'pdftopptxStatus',  endpoint:'/convert/pptx',  ext:'pptx', label:'PowerPoint' },
].forEach(({ tool, zoneId, infoId, btnId, statusId, endpoint, ext, label }) => {

  let storedFile = null;

  // Create a fresh file input dynamically, avoids hidden input issues across browsers
  function makeInput() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf';
    inp.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      if (inp.files[0]) handleFile(inp.files[0]);
      document.body.removeChild(inp);
    });
    return inp;
  }

  function setStatus(type, msg) {
    const el = $(statusId);
    if (!type) { hide(el); return; }
    el.className = `convert-status ${type}`;
    el.textContent = msg;
    show(el);
  }

  function handleFile(file) {
    if (!file || file.type !== 'application/pdf') { toast('Please select a valid PDF.', 'error'); return; }
    if (!okSize(file)) return;
    storedFile = file;
    $(infoId).innerHTML = `
      <i class="fa-solid fa-file-pdf fi-icon"></i>
      <div style="flex:1;min-width:0">
        <div class="fi-name">${escHtml(file.name)}</div>
        <div class="fi-size">${fmtSize(file.size)}</div>
      </div>
      <button class="fi-change" id="change-${tool}">Change</button>`;
    $(`change-${tool}`).addEventListener('click', () => resetServerTool(tool, zoneId, infoId, btnId, statusId));
    hide($(zoneId)); show($(infoId));
    $(btnId).disabled = false;
    setStatus(null);
    toast(`Loaded "${file.name}"`, 'success');
  }

  // Whole zone is clickable
  const zone = $(zoneId);
  zone.addEventListener('click', e => {
    // Don't trigger if they clicked the inner button (it will trigger too)
    if (e.target.tagName === 'BUTTON') return;
    makeInput().click();
  });
  // The "Choose PDF" button inside the zone
  zone.querySelector('button')?.addEventListener('click', e => {
    e.stopPropagation();
    makeInput().click();
  });

  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  $(btnId).addEventListener('click', async () => {
    if (!storedFile) return;
    $(btnId).disabled = true;

    // Step 1: ping to wake server (Render free tier sleeps after 15 min)
    setStatus('working', '⏳ Waking up server…');
    try {
      await fetch(`${SERVER_URL}/ping`, { method: 'GET', mode: 'cors', signal: mkTimeout(60000) });
    } catch (_) {
      await new Promise(r => setTimeout(r, 4000));
    }

    // Step 2: convert, server streams keep-alive spaces then ends with JSON
    setStatus('working', `⚙ Converting to ${label}… please wait`);
    try {
      const formData = new FormData();
      formData.append('file', storedFile, storedFile.name);

      let res;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          res = await fetch(`${SERVER_URL}${endpoint}`, {
            method: 'POST',
            body:   formData,
            mode:   'cors',
            signal: mkTimeout(180000), // 3 min max
          });
          break;
        } catch (fetchErr) {
          if (attempt === 2) throw fetchErr;
          setStatus('working', `Retrying… (attempt ${attempt}/2)`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      // Server always returns 200 with JSON (even on errors), because
      // it uses chunked streaming, parse the text and trim whitespace/spaces
      const raw  = await res.text();
      const json = JSON.parse(raw.trim());

      if (!json.ok) throw new Error(json.error || `Conversion failed`);

      // Decode base64 → Blob → download
      const byteChars = atob(json.data);
      const byteArr   = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob   = new Blob([byteArr], { type: json.mime });
      const url    = URL.createObjectURL(blob);
      const a      = Object.assign(document.createElement('a'), { href: url, download: json.filename });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 15000);

      setStatus('done', `✓ Converted successfully, check your downloads`);
      toast(`${label} file downloaded!`, 'success');

    } catch (err) {
      console.error('[convert]', err);
      const isCors = err.name === 'TypeError' || err.message.includes('fetch');
      const msg = isCors
        ? 'Connection failed. Click Convert again, server may need another moment.'
        : err.message;
      setStatus('fail', `✗ ${msg}`);
      toast(msg, 'error', 7000);
    } finally {
      $(btnId).disabled = false;
    }
  });
});

function resetServerTool(tool, zoneId, infoId, btnId, statusId) {
  show($(zoneId)); hide($(infoId));
  $(btnId).disabled = true;
  hide($(statusId));
}
window.resetServerTool = resetServerTool;

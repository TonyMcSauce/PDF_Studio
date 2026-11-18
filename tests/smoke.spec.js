const { test, expect } = require('@playwright/test');
const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfstudio-'));

async function makePdf(name, pages) {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${name} page ${i} selectable`, { x: 50, y: 780, size: 18 });
  }
  const file = path.join(tmp, `${name}.pdf`);
  fs.writeFileSync(file, await doc.save());
  return file;
}

async function pageTexts(file) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map(it => it.str).join(' '));
  }
  return out;
}

async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const file = path.join(tmp, `out-${Date.now()}-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  return file;
}

const fixture = name => path.join(__dirname, 'fixtures', name);

// Reads a stored (uncompressed) ZIP: [{ name, data }]
function readZip(file) {
  const b = fs.readFileSync(file), out = [];
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = b.readUInt32LE(end + 16);
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    const nameLen = b.readUInt16LE(p + 28), size = b.readUInt32LE(p + 20), local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    out.push({ name, data: b.subarray(start, start + size) });
    p += 46 + nameLen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return out;
}

// Decodes an image the way a browser shows it: size plus the colour at the left and right edges
async function look(page, bytes) {
  return page.evaluate(async b64 => {
    const blob = await (await fetch('data:application/octet-stream;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3));
    return { w: bmp.width, h: bmp.height, left: at(5, bmp.height >> 1), right: at(bmp.width - 6, bmp.height >> 1) };
  }, Buffer.from(bytes).toString('base64'));
}
const isRed  = ([r, g, b]) => r > 160 && g < 90 && b < 90;
const isBlue = ([r, g, b]) => b > 160 && r < 90;

let errors, external;
test.beforeEach(async ({ page }) => {
  errors = []; external = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('request', r => { const u = r.url(); if (!/^(http:\/\/localhost|data:|blob:)/.test(u)) external.push(u); });
  page.on('dialog', d => d.accept());
  await page.goto('/');
});
test.afterEach(() => {
  expect(errors, 'console errors').toEqual([]);
  expect(external, 'third-party requests').toEqual([]);
});

const openTool = async (page, tool) => {
  await page.click(`.tool-card[data-tool="${tool}"]`);
};

test('home shows every tool', async ({ page }) => {
  await expect(page.locator('.tool-card')).toHaveCount(21);
});

test('merge combines PDFs and keeps text selectable', async ({ page }) => {
  const a = await makePdf('alpha', 2), b = await makePdf('beta', 1);
  await openTool(page, 'merge');
  await page.setInputFiles('#mergeInput', [a, b]);
  await page.waitForTimeout(1000);
  const out = await download(page, '#mergeBtn');
  const texts = await pageTexts(out);
  expect(texts).toHaveLength(3);
  expect(texts[2]).toContain('beta page 1');
});

test('page numbers are real text', async ({ page }) => {
  await openTool(page, 'pagenumbers');
  await page.setInputFiles('#pnFileInput', await makePdf('nums', 2));
  await page.waitForTimeout(1200);
  await page.selectOption('#pnFormat', 'of');
  await page.click('#pnBtn');
  await page.waitForTimeout(600);
  const texts = await pageTexts(await download(page, '#downloadBtn'));
  expect(texts[0]).toContain('nums page 1 selectable');
  expect(texts[0]).toContain('1 of 2');
  expect(texts[1]).toContain('2 of 2');
});

test('text watermark is real text', async ({ page }) => {
  await openTool(page, 'watermark');
  await page.setInputFiles('#watermarkFileInput', await makePdf('wm', 1));
  await page.waitForTimeout(1200);
  await page.click('#wmBtn');
  await page.waitForTimeout(500);
  const out = await download(page, '#downloadBtn');
  expect((await pageTexts(out))[0]).toContain('CONFIDENTIAL');
});

test('redact removes the text underneath', async ({ page }) => {
  await openTool(page, 'redact');
  await page.setInputFiles('#redactFileInput', await makePdf('secret', 2));
  await page.waitForTimeout(1200);
  const c = await page.locator('#previewCanvas').boundingBox();
  await page.mouse.move(c.x + 20, c.y + 10);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width - 20, c.y + c.height * 0.12, { steps: 5 });
  await page.mouse.up();
  await page.click('#redactApplyBtn');
  await page.waitForTimeout(800);
  const texts = await pageTexts(await download(page, '#downloadBtn'));
  expect(texts[0].trim()).toBe('');
  expect(texts[1]).toContain('secret page 2');
});

test('compress never returns a bigger file', async ({ page }) => {
  await openTool(page, 'compress');
  await page.setInputFiles('#compressFileInput', await makePdf('tiny', 1));
  await page.waitForTimeout(1200);
  await page.click('#compressBtn');
  await expect(page.locator('#toast')).toContainText('already compact');
});

test('add image: box appears and can be embedded', async ({ page }) => {
  const png = path.join(tmp, 'logo.png');
  // 1x1 red PNG
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
  await openTool(page, 'image');
  await page.setInputFiles('#pdfImageFileInput', await makePdf('img', 1));
  await page.waitForTimeout(1200);
  await page.setInputFiles('#overlayImageInput', png);
  await expect(page.locator('.img-box')).toHaveCount(1);
  await page.click('#addImageBtn');
  await page.waitForTimeout(600);
  const out = await download(page, '#downloadBtn');
  expect(await pageTexts(out)).toHaveLength(1);
});

test('keyboard: Page Down moves to the next page', async ({ page }) => {
  await openTool(page, 'annotate');
  await page.setInputFiles('#annotateFileInput', await makePdf('kb', 3));
  await page.waitForTimeout(1200);
  await page.keyboard.press('PageDown');
  await expect(page.locator('#pageIndicator')).toContainText('2 / 3');
});

test('images can be discarded, removed, undone and applied to every page', async ({ page }) => {
  const png = path.join(tmp, 'dot.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
  await openTool(page, 'image');
  await page.setInputFiles('#pdfImageFileInput', await makePdf('multi', 3));
  await page.waitForTimeout(1200);

  // Delete key discards the pending image
  await page.setInputFiles('#overlayImageInput', png);
  await expect(page.locator('.img-box')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(page.locator('.img-box')).toHaveCount(0);
  await expect(page.locator('#addImageBtn')).toBeDisabled();

  // The cross button discards it too
  await page.setInputFiles('#overlayImageInput', png);
  await page.click('.img-box-x');
  await expect(page.locator('.img-box')).toHaveCount(0);

  // Place on every page, then remove one from the list
  await page.setInputFiles('#overlayImageInput', png);
  await page.check('#imgAllPages');
  await page.click('#addImageBtn');
  await expect(page.locator('#imgList .rdbox-item')).toHaveCount(3);
  await page.locator('#imgList .rdbox-item button').first().click();
  await expect(page.locator('#imgList .rdbox-item')).toHaveCount(2);

  // Undo removes the latest, Remove all clears the rest
  await page.click('#imgUndoBtn');
  await expect(page.locator('#imgList .rdbox-item')).toHaveCount(1);
  await page.click('#imgClearBtn');
  await expect(page.locator('#imgList .rdbox-item')).toHaveCount(0);
  await expect(page.locator('#imgUndoBtn')).toBeDisabled();
});

test('HEIC to JPG decodes on this device and leaves location behind', async ({ page }) => {
  await openTool(page, 'heic');
  await page.setInputFiles('#heicInput', fixture('photo.heic'));
  const card = page.locator('.photo-card');
  await expect(card).toHaveClass(/is-ready/, { timeout: 20000 });
  await expect(card).toContainText('320 × 240');
  await expect(card.locator('.photo-chip.is-warn')).toContainText('Location');
  await expect(card).toContainText('iPhone 15 Pro');
  const out = fs.readFileSync(await download(page, '#heicBtn'));
  expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(out.includes('Exif')).toBe(false);
  expect(out.includes('iPhone')).toBe(false);
  const img = await look(page, out);
  expect([img.w, img.h]).toEqual([320, 240]);
  expect(isRed(img.left) && isBlue(img.right)).toBe(true);
  await expect(card).toHaveClass(/is-done/);
  await expect(card.locator('.photo-chip.is-removed')).not.toHaveCount(0);
});

test('convert several photos to PNG arrives as a ZIP', async ({ page }) => {
  await openTool(page, 'convertimg');
  await page.setInputFiles('#convertimgInput', [fixture('photo.heic'), fixture('gps.jpg')]);
  await expect(page.locator('.photo-card.is-ready')).toHaveCount(2, { timeout: 20000 });
  await page.selectOption('#convertimgFormat', 'png');
  const files = readZip(await download(page, '#convertimgBtn'));
  expect(files.map(f => f.name)).toEqual(['photo.png', 'gps.png']);
  for (const f of files) expect(f.data.subarray(1, 4).toString()).toBe('PNG');
  const sideways = await look(page, files[1].data);
  expect([sideways.w, sideways.h]).toEqual([240, 160]);          // rotation baked in
  expect(isRed(sideways.left) && isBlue(sideways.right)).toBe(true);
});

test('convert can keep camera details when asked', async ({ page }) => {
  await openTool(page, 'convertimg');
  await page.setInputFiles('#convertimgInput', fixture('gps.jpg'));
  await expect(page.locator('.photo-card')).toHaveClass(/is-ready/);
  await page.uncheck('#convertimgStrip');
  const out = fs.readFileSync(await download(page, '#convertimgBtn'));
  expect(out.includes('iPhone 15 Pro')).toBe(true);
  const img = await look(page, out);                              // orientation reset, still upright
  expect([img.w, img.h]).toEqual([240, 160]);
  expect(isRed(img.left)).toBe(true);
});

test('remove photo details is lossless and keeps the photo upright', async ({ page }) => {
  const orig = fs.readFileSync(fixture('gps.jpg'));
  await openTool(page, 'cleanimg');
  await page.setInputFiles('#cleanimgInput', fixture('gps.jpg'));
  const card = page.locator('.photo-card');
  await expect(card).toHaveClass(/is-ready/);
  await expect(card).toContainText('Location');
  await expect(card).toContainText('XMP, comment');
  const out = fs.readFileSync(await download(page, '#cleanimgBtn'));
  for (const secret of ['iPhone', 'Apple', 'secret note', 'xmpmeta', '2025:03:12']) expect(out.includes(secret)).toBe(false);
  // The compressed picture itself is byte-for-byte the same
  const sos = b => b.indexOf(Buffer.from([0xff, 0xda]));
  expect(out.subarray(sos(out)).equals(orig.subarray(sos(orig)))).toBe(true);
  const img = await look(page, out);
  expect([img.w, img.h]).toEqual([240, 160]);
  expect(isRed(img.left) && isBlue(img.right)).toBe(true);
  await expect(card).toContainText('Cleaned with no quality loss');
});

test('resize scales to the longest side', async ({ page }) => {
  await openTool(page, 'resizeimg');
  await page.setInputFiles('#resizeimgInput', fixture('photo.heic'));
  await expect(page.locator('.photo-card')).toHaveClass(/is-ready/, { timeout: 20000 });
  await page.fill('#resizeimgResizeVal', '160');
  await page.locator('#resizeimgResizeVal').dispatchEvent('change');
  const out = fs.readFileSync(await download(page, '#resizeimgBtn'));
  const img = await look(page, out);
  expect([img.w, img.h]).toEqual([160, 120]);
  await expect(page.locator('.photo-card')).toContainText('160 × 120');
});

test('resize meets a target file size', async ({ page }) => {
  // A noisy 1200x900 PNG is far bigger than 200 KB
  const big = await page.evaluate(async () => {
    const c = new OffscreenCanvas(1200, 900), x = c.getContext('2d'), d = x.createImageData(1200, 900);
    for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : Math.random() * 255;
    x.putImageData(d, 0, 0);
    const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const file = path.join(tmp, 'noise.png');
  fs.writeFileSync(file, Buffer.from(big, 'base64'));
  await openTool(page, 'resizeimg');
  await page.selectOption('#resizeimgResize', 'none');
  await page.selectOption('#resizeimgFormat', 'jpeg');
  await page.selectOption('#resizeimgTarget', '204800');
  await page.setInputFiles('#resizeimgInput', file);
  await expect(page.locator('.photo-card')).toHaveClass(/is-ready/);
  const out = fs.readFileSync(await download(page, '#resizeimgBtn'));
  expect(out.length).toBeLessThanOrEqual(204800);
});

test('PDF to images exports a page range as a ZIP', async ({ page }) => {
  await openTool(page, 'pdftoimages');
  await page.setInputFiles('#pdfImgFileInput', await makePdf('deck', 3));
  await expect(page.locator('#pdfImgBtn')).toBeEnabled();
  await page.selectOption('#pdfImgPages', 'range');
  await page.fill('#pdfImgFrom', '2');
  await page.locator('#pdfImgFrom').dispatchEvent('change');
  await expect(page.locator('#pdfImgHint')).toContainText('2 images');
  const files = readZip(await download(page, '#pdfImgBtn'));
  expect(files.map(f => f.name)).toEqual(['deck-page-2.png', 'deck-page-3.png']);
  const img = await look(page, files[0].data);
  expect([img.w, img.h]).toEqual([Math.ceil(595 * 150 / 72), Math.ceil(842 * 150 / 72)]);
});

test('PDF to images saves a single page as a JPG', async ({ page }) => {
  await openTool(page, 'pdftoimages');
  await page.setInputFiles('#pdfImgFileInput', await makePdf('one', 1));
  await expect(page.locator('#pdfImgBtn')).toBeEnabled();
  await page.selectOption('#pdfImgFormat', 'jpeg');
  const file = await download(page, '#pdfImgBtn');
  expect(path.basename(file)).toMatch(/one-page-1\.jpg$/);
  expect(fs.readFileSync(file).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
});

test('images to PDF accepts HEIC photos', async ({ page }) => {
  await openTool(page, 'imagestopdf');
  await page.setInputFiles('#imgToPdfInput', [fixture('photo.heic'), fixture('gps.jpg')]);
  await expect(page.locator('.img-to-pdf-item')).toHaveCount(2, { timeout: 20000 });
  await expect(page.locator('.img-to-pdf-item').first()).toContainText('photo.heic');
  const out = await download(page, '#imgToPdfBtn');
  expect(await pageTexts(out)).toHaveLength(2);
});

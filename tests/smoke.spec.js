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
  const file = path.join(tmp, `out-${Date.now()}.pdf`);
  await dl.saveAs(file);
  return file;
}

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
  await expect(page.locator('.tool-card')).toHaveCount(16);
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

// Direct-write memos: a memo style that draws bare text on the manuscript.
// Existing bubble memos and v1-v5 files must stay byte-compatible; saving
// moves to v6 and only direct memos gain style/fontSize fields.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew, saveUser } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const glyphPoint = (page, offset, dx = 0, dy = 0) => page.evaluate(([o, x, y]) => {
  const g = window.Reader.getWritingGeometry(), root = document.getElementById('reader').getBoundingClientRect();
  const glyph = g.byOffset.get(o);
  return { x: root.left + glyph.x + glyph.width / 2 + x, y: root.top + glyph.y + glyph.height / 2 + y };
}, [offset, dx, dy]);
const saved = async page => (await saveUser(page)).manuscripts[0].manuscript;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const text = '本文を読みます。次の文です。'.repeat(30);
    const bubble = { id: 1, type: 'memo', offset: 0, dx: .6, dy: 1, tx: 0, ty: 0, color: 'yellow', text: '既存の吹き出し' };
    const v5 = { format: 'reading-support-manuscript', version: 5, text, annotations: [], sourceRubies: [], marks: [bubble], memoSettings: { fontSize: 16, opacity: .9 } };
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await startNew(page);
    await page.locator('[data-go=read-input]').click();
    await page.locator('#manuscript-file').setInputFiles({ name: 'v5.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v5)) });
    await page.locator('#reader').waitFor();
    // v5 bubble data survives untouched; saving upgrades the version only.
    let data = await saved(page);
    assert.equal(data.version, 6);
    const kept = data.marks.find(m => m.id === 1);
    assert.ok(kept); assert.ok(!('style' in kept) && !('fontSize' in kept), 'bubble memo gains no new fields');
    assert.equal(kept.text, '既存の吹き出し');
    // Create a direct memo through the dialog.
    await page.locator('#writing-mode').click();
    await page.locator('[data-writing-tool=memo]').click();
    const spot = await glyphPoint(page, 200);
    await page.mouse.click(spot.x, spot.y);
    await page.locator('#writing-memo-dialog').waitFor();
    await page.locator('#memo-style-direct').click();
    assert.equal(await page.locator('#memo-font-size-row').isVisible(), true);
    await page.locator('#writing-memo-font-size').fill('28');
    await page.locator('#writing-memo-input').fill('直接メモ');
    await page.locator('#writing-memo-save').click();
    const directEl = page.locator('.writing-memo.memo-direct', { hasText: '直接メモ' });
    assert.equal(await directEl.count(), 1);
    assert.equal(await directEl.evaluate(el => el.style.fontSize), '28px');
    data = await saved(page);
    const direct = data.marks.find(m => m.text === '直接メモ');
    assert.ok(direct); assert.equal(direct.style, 'direct'); assert.equal(direct.fontSize, 28);
    // Converting it back to a bubble clears the style fields completely.
    await directEl.locator('.memo-direct-text').click();
    await directEl.locator('.memo-direct-text').click();
    await page.locator('#writing-memo-dialog').waitFor();
    assert.equal(await page.locator('#memo-style-direct').getAttribute('aria-pressed'), 'true');
    await page.locator('#memo-style-bubble').click();
    await page.locator('#writing-memo-save').click();
    data = await saved(page);
    const converted = data.marks.find(m => m.text === '直接メモ');
    assert.ok(converted); assert.ok(!('style' in converted) && !('fontSize' in converted), 'converted bubble is pristine again');
    assert.equal(await page.locator('.writing-memo.memo-direct', { hasText: '直接メモ' }).count(), 0);
    // A fresh direct memo reaches the PDF in place, with no note page.
    await page.locator('[data-writing-tool=memo]').click();
    const spot2 = await glyphPoint(page, 300);
    await page.mouse.click(spot2.x, spot2.y);
    await page.locator('#writing-memo-dialog').waitFor();
    assert.equal(await page.locator('#memo-style-direct').getAttribute('aria-pressed'), 'true', 'style choice is remembered');
    await page.locator('#writing-memo-input').fill('印刷確認');
    await page.locator('#writing-memo-save').click();
    data = await saved(page);
    const printDirect = data.marks.find(m => m.text === '印刷確認');
    assert.equal(printDirect.style, 'direct');
    const pdf = await page.evaluate(id => {
      const result = window.ManuscriptPrint.prepare(window.Reader.printSnapshot(), window.ManuscriptWriting.printSnapshot({ forPrint: true }));
      const el = document.querySelector(`#manuscript-print .memo-direct[data-mark-id="${id}"]`);
      const bubbleEl = document.querySelector('#manuscript-print .writing-memo:not(.memo-direct)');
      const notePages = document.querySelectorAll('#manuscript-print .manuscript-memo-page').length;
      const rect = el?.getBoundingClientRect();
      window.ManuscriptPrint.clear();
      return { found: Boolean(el), notePages, bubbleFound: Boolean(bubbleEl), width: rect?.width ?? 0 };
    }, printDirect.id);
    assert.ok(pdf.found, 'direct memo printed in place');
    assert.equal(pdf.notePages, 0, 'direct memo creates no note page');
    assert.ok(pdf.bubbleFound, 'bubble memo still printed');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('desktop: v5 compat, direct create, conversion, PDF in-place passed');
    // Vertical: direct text is vertical on screen and reaches the PDF.
    const v6v = { ...v5, version: 6, writingDirection: 'vertical', marks: [{ id: 1, type: 'memo', offset: 0, dx: .6, dy: 1, tx: 0, ty: 0, color: 'pink', text: '縦の直接', style: 'direct', fontSize: 24, verticalPosition: { dx: -3, dy: 1, tx: 0, ty: 0 } }] };
    const vpage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const verrors = []; vpage.on('pageerror', e => verrors.push(e.message));
    await vpage.goto(`http://127.0.0.1:${server.address().port}/`);
    await startNew(vpage);
    await vpage.locator('[data-go=read-input]').click();
    await vpage.locator('#manuscript-file').setInputFiles({ name: 'v6v.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v6v)) });
    await vpage.locator('#reader').waitFor();
    const vel = vpage.locator('.writing-memo.memo-direct.memo-vertical', { hasText: '縦の直接' });
    assert.equal(await vel.count(), 1);
    assert.equal(await vel.locator('.memo-direct-text').evaluate(el => getComputedStyle(el).writingMode), 'vertical-rl');
    await vpage.locator('#export-pdf').click();
    await vpage.waitForFunction(() => document.getElementById('pdf-dialog').open);
    assert.ok(await vpage.locator('#manuscript-print .memo-direct').count() >= 1, 'vertical direct memo in PDF');
    await vpage.locator('#pdf-cancel').click();
    assert.deepEqual(verrors, []);
    await vpage.close();
    console.log('vertical: direct memo renders vertical and prints passed');
    // Older formats still open (v4 spot check through the same import path).
    const v4 = { format: 'reading-support-manuscript', version: 4, text, annotations: [], sourceRubies: [], marks: [{ ...bubble, id: 7 }], memoSettings: { fontSize: 16, opacity: .9 } };
    const opage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await opage.goto(`http://127.0.0.1:${server.address().port}/`);
    await startNew(opage);
    await opage.locator('[data-go=read-input]').click();
    await opage.locator('#manuscript-file').setInputFiles({ name: 'v4.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v4)) });
    await opage.locator('#reader').waitFor();
    assert.ok(await opage.locator('.writing-memo', { hasText: '既存の吹き出し' }).count() >= 1);
    await opage.close();
    console.log('legacy: v4 manuscript still opens passed');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

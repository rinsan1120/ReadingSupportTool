// Run with Playwright on NODE_PATH and Chrome installed. Touch drags use native
// CDP touch events so touch-action, cancellation and scrolling are exercised.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const sourceText = '黄昏の空に狐が現れた。静かな森で、間を取って読む。\n\n👩‍👩‍👧‍👦と、が、𠮷【原文の括弧】。\n' + '夜の森で立ち止まり、遠くから聞こえる声に耳を澄ませた。'.repeat(45);
const fox = sourceText.indexOf('狐');
const data = { format: 'reading-support-manuscript', version: 2, text: sourceText,
  annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: fox, end: fox + 1, reading: 'きつね' }] };
const originalText = page => page.locator('#reader').evaluate(root => {
  const copy = root.cloneNode(true); copy.querySelectorAll('rt,.reading-annotation').forEach(el => el.remove()); return copy.textContent;
});
const save = async page => {
  await page.locator('#operations').click(); const pending = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
  const download = await pending; return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
};
const checkSaved = (saved, original) => { const { marks, ...base } = saved; assert.deepEqual(base, { ...original, version: 3 }); return marks; };
const writingOn = async page => {
  await page.locator('#operations').click(); await page.locator('#writing-mode').click();
  await page.locator('#writing-toolbar').waitFor({ state: 'visible' });
};
const tool = (page, name) => page.locator(`[data-writing-tool=${name}]`).click();
const glyph = async (page, offset, visible = true) => {
  const box = () => page.evaluate(offset => {
    const r = document.getElementById('reader').getBoundingClientRect(), g = window.Reader.getWritingGeometry().glyphs.find(g => g.start === offset);
    if (!g) throw new Error(`No original glyph ${offset}`);
    return { x: r.left + g.x + g.width / 2, y: r.top + g.y + g.height / 2, width: g.width, height: g.height };
  }, offset);
  let result = await box();
  if (visible) {
    await page.evaluate(y => {
      const edge = document.querySelector('.reader-controls').getBoundingClientRect().bottom;
      if (y < edge + 20 || y > innerHeight - 60) scrollBy(0, y - edge - 80);
    }, result.y);
    result = await box();
  }
  return result;
};
const counts = page => page.evaluate(() => ({ pen: document.querySelectorAll('#writing-pen path').length,
  marker: new Set([...document.querySelectorAll('#writing-markers rect')].map(el => el.dataset.markId)).size,
  memo: document.querySelectorAll('.writing-memo').length }));

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const cdp = width < 600 ? await context.newCDPSession(page) : null;
      const drag = async (from, to) => {
        if (cdp) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
          for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up(); }
      };
      const tap = point => cdp ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y);
      await page.locator('[data-go="read-input"]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.locator('#reading').waitFor({ state: 'visible' });
      const initialStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })), initialRequests = requests.length;
      const originalCount = await page.locator('#read-count').textContent();
      assert.equal(await page.locator('#writing-toolbar').isVisible(), false);
      let p = await glyph(page, fox); await drag({ x: p.x + 5, y: p.y - 8 }, { x: p.x - 5, y: p.y + 8 });
      assert.deepEqual(await counts(page), { pen: 0, marker: 0, memo: 0 }, 'OFF never draws');
      await writingOn(page);
      const toolBounds = await page.locator('#writing-toolbar').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, buttons: [...el.querySelectorAll('[data-writing-tool]')].map(b => b.getBoundingClientRect().height) }));
      assert.equal(toolBounds.width, toolBounds.scroll); assert.ok(toolBounds.buttons.every(height => height <= 44));
      assert.match(await page.locator('#writing-save-help').textContent(), /JSONに保存できます/);
      assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'false');
      p = await glyph(page, fox);
      await tap(p); assert.equal((await counts(page)).pen, 0, 'pen tap alone is not a stray line');
      await drag({ x: p.x + 6, y: p.y - 8 }, { x: p.x - 5, y: p.y + 8 });
      assert.equal((await counts(page)).pen, 1);
      assert.ok((await page.locator('#writing-pen path').getAttribute('d')).split('L').length > 2, 'continuous stroke');
      assert.equal(await page.locator('#writing-pen path').evaluate(el => getComputedStyle(el).stroke), 'rgb(255, 107, 107)');
      await tool(page, 'marker'); const first = await glyph(page, 0), last = await glyph(page, 4);
      await drag(first, last);
      assert.equal((await counts(page)).marker, 1);
      assert.equal(await page.locator('#writing-markers rect').first().getAttribute('data-start'), '0');
      assert.equal(await page.locator('#writing-markers rect').first().getAttribute('data-end'), '5');
      assert.equal(await originalText(page), sourceText); assert.equal(await page.locator('#read-count').textContent(), originalCount);
      assert.deepEqual(checkSaved(await save(page), data).map(mark => mark.type), ['pen', 'marker']);
      // Source positions survive reflow; short pen stays attached to the fox.
      const before = await page.evaluate(() => {
        const path = document.querySelector('#writing-pen path'), point = path.getPointAtLength(0), geometry = window.Reader.getWritingGeometry();
        const g = geometry.glyphs.find(g => g.start === Number(path.dataset.offset));
        return { x: (point.x - g.x - g.width / 2) / geometry.fontSize, y: (point.y - g.y - g.height / 2) / geometry.fontSize };
      });
      await page.evaluate(() => window.Reader.configure({ width: 520, columns: 20, height: 2.2, breaks: 2 }));
      assert.equal((await counts(page)).pen, 1);
      const attached = await page.evaluate(({ before, fox }) => {
        const point = document.querySelector('#writing-pen path').getPointAtLength(0), geometry = window.Reader.getWritingGeometry(), g = geometry.glyphs.find(g => g.start === fox);
        return Math.hypot(point.x - g.x - g.width / 2 - before.x * geometry.fontSize, point.y - g.y - g.height / 2 - before.y * geometry.fontSize);
      }, { before, fox });
      assert.ok(attached < .1, 'pen retains original character anchor and relative shape');
      const coverage = await page.evaluate(() => {
        const r = document.getElementById('reader').getBoundingClientRect(), rects = [...document.querySelectorAll('#writing-markers rect')].map(el => el.getBoundingClientRect());
        return window.Reader.getWritingGeometry().glyphs.filter(g => g.start < 5).every(g => rects.some(box => r.left + g.x + g.width / 2 >= box.left && r.left + g.x + g.width / 2 <= box.right && r.top + g.y + g.height / 2 >= box.top && r.top + g.y + g.height / 2 <= box.bottom));
      });
      assert.equal(coverage, true, 'marker follows the same source range');
      await tool(page, 'memo'); await tap(await glyph(page, fox));
      assert.equal(await page.locator('#writing-memo-save').isDisabled(), true);
      await page.locator('#writing-memo-input').fill('少し大');
      const prevented = await page.locator('#writing-memo-input').evaluate(el => !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
      assert.equal(prevented, true);
      if (width < 600) {
        await page.setViewportSize({ width, height: 340 });
        await page.waitForFunction(() => document.getElementById('writing-memo-save').getBoundingClientRect().bottom <= visualViewport.height);
        const bounds = await page.locator('#writing-memo-dialog').boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 340);
      }
      await page.locator('#writing-memo-save').click();
      if (width < 600) await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => document.querySelectorAll('.writing-memo').length === 1);
      await page.locator('.writing-memo').click(); await page.locator('#writing-memo-input').fill('間を取る'); await page.locator('#writing-memo-save').click();
      assert.match(await page.locator('.writing-memo').textContent(), /間を取る/);
      await page.locator('#writing-undo').click(); assert.match(await page.locator('.writing-memo').textContent(), /少し大/);
      await page.locator('.writing-memo').click(); await page.locator('#writing-memo-input').fill('間を取る'); await page.locator('#writing-memo-save').click();
      const safePosition = await page.locator('.writing-memo').evaluate(el => {
        const note = el.getBoundingClientRect(), text = document.getElementById('reader').getBoundingClientRect();
        return note.left >= text.right && note.right <= innerWidth;
      }); assert.equal(safePosition, true, 'memo has its own rail, never covers body');
      await tool(page, 'pen');
      const noteBox = await page.locator('.writing-memo').boundingBox(), pensBeforeNoteDrag = (await counts(page)).pen;
      await drag({ x: noteBox.x + 8, y: noteBox.y + 10 }, { x: noteBox.x + 20, y: noteBox.y + 24 });
      assert.equal((await counts(page)).pen, pensBeforeNoteDrag, 'dragging a disabled memo is not a pen stroke');
      await page.locator('#writing-off').click();
      const retained = await counts(page); assert.equal(retained.memo, 1);
      assert.equal(await page.locator('.writing-memo').isDisabled(), true);
      assert.match(await page.locator('#writing-status').textContent(), /JSON保存・PDF出力に対応/);
      // Native touch scroll returns when OFF, without creating marks.
      if (cdp) {
        const beforeScroll = await page.evaluate(() => scrollY);
        await drag({ x: width / 2, y: 650 }, { x: width / 2, y: 300 });
        await page.waitForFunction(y => scrollY > y + 20, beforeScroll);
      }
      assert.deepEqual(await counts(page), retained);
      await page.locator('#reader-back').click(); await page.locator('#open-read').click();
      assert.deepEqual(await counts(page), retained, 'same manuscript reopens without losing marks');
      await writingOn(page); await page.locator('#ruby-mode').click();
      assert.equal(await page.locator('#writing-toolbar').isVisible(), false);
      assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'true');
      await writingOn(page); assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'false');
      // Delete each kind, then restore it using the bounded undo history.
      await tool(page, 'eraser'); await page.locator('.writing-memo').click();
      assert.equal((await counts(page)).memo, 0); await page.locator('#writing-undo').click(); assert.equal((await counts(page)).memo, 1);
      await tap(await glyph(page, 0)); assert.equal((await counts(page)).marker, 0);
      await page.locator('#writing-undo').click(); assert.equal((await counts(page)).marker, 1);
      await tap(await glyph(page, fox)); assert.equal((await counts(page)).pen, 0);
      await page.locator('#writing-undo').click(); assert.equal((await counts(page)).pen, 1);
      // A complex stroke is retained but hidden when its layout changes. It
      // returns with the same id when restored; unchanged refresh keeps it.
      await tool(page, 'pen');
      const wideStart = await glyph(page, 0), wideEnd = await glyph(page, fox);
      await drag(wideStart, wideEnd); assert.equal((await counts(page)).pen, 2);
      const complexId = await page.locator('#writing-pen path').last().getAttribute('data-mark-id');
      await page.evaluate(() => window.Reader.refresh()); assert.equal((await counts(page)).pen, 2);
      await page.evaluate(() => window.Reader.configure({ height: 2.6 }));
      assert.equal((await counts(page)).pen, 1); assert.match(await page.locator('#writing-status').textContent(), /赤ペン1件を一時非表示/);
      await page.evaluate(() => window.Reader.configure({ height: 2.2 }));
      assert.equal((await counts(page)).pen, 2); assert.equal(await page.locator('#writing-pen path').last().getAttribute('data-mark-id'), complexId);
      await page.locator('#writing-undo').click(); assert.equal((await counts(page)).pen, 1);
      // A layout change cancels an unfinished pointer stroke, not the model.
      const unfinished = await glyph(page, fox);
      await page.mouse.move(unfinished.x, unfinished.y); await page.mouse.down(); await page.mouse.move(unfinished.x + 6, unfinished.y + 5);
      await page.evaluate(() => window.Reader.refresh()); await page.mouse.up(); assert.equal((await counts(page)).pen, 1);
      assert.equal(await originalText(page), sourceText); assert.equal(await page.locator('#reader rt').textContent(), 'きつね');
      assert.equal(await page.locator('.reading-annotation').textContent(), '【たそがれ】');
      assert.equal(await page.locator('#layout-status').textContent(), '');
      if (process.env.READER_TEST_ARTIFACTS) {
        fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
        await tool(page, 'memo'); await glyph(page, fox);
        await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `writing-${width}.png`) });
      }
      // Confirmed writing enters the independent print layers and survives cancel.
      await page.locator('#operations').click(); await page.locator('#export-pdf').click();
      await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
      assert.ok(await page.locator('#manuscript-print .manuscript-pens path[data-mark-id]').count());
      assert.equal(await page.locator('#manuscript-print .manuscript-memo').count(), 1);
      await page.locator('#pdf-cancel').click(); assert.deepEqual(await counts(page), retained);
      const beforePrintPath = await page.locator('#writing-pen path').getAttribute('d');
      await page.locator('#operations').click(); await page.locator('#export-pdf').click();
      await page.evaluate(() => { window.originalPrint = window.print; window.print = () => {}; });
      await page.locator('#pdf-print').click(); await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => window.ManuscriptWriting.cancelPending());
      assert.equal(await page.locator('#writing-pen path').getAttribute('d'), beforePrintPath, 'printing never measures overlays against a hidden reader');
      await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
      await page.waitForFunction(() => !document.body.classList.contains('manuscript-printing'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#writing-pen path').getAttribute('d'), beforePrintPath);
      assert.deepEqual(await counts(page), retained);
      await page.evaluate(() => { window.print = window.originalPrint; });
      // Protect unsaved writing on edited input, JSON import and HTML replacement.
      await page.locator('#reader-back').click();
      await page.locator('#read-text').evaluate(el => { el.value += '変更'; el.dispatchEvent(new Event('input')); });
      await page.locator('#open-read').click(); assert.match(await page.locator('#confirm-message').textContent(), /書き込み.*失われます/);
      await page.locator('#confirm-cancel').click();
      await page.locator('#read-text').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input')); }, sourceText);
      await page.locator('#open-read').click(); assert.deepEqual(await counts(page), retained);
      await page.locator('#reader-back').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'new.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.locator('#confirm-dialog').waitFor({ state: 'visible' }); assert.match(await page.locator('#confirm-message').textContent(), /書き込み.*失われます/);
      await page.locator('#confirm-cancel').click();
      await page.locator('#read-text').evaluate(el => {
        el.setSelectionRange(0, el.value.length); const clipboardData = new DataTransfer(); clipboardData.setData('text/html', '<ruby>森<rt>もり</rt></ruby>');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, cancelable: true, bubbles: true }));
      });
      assert.match(await page.locator('#confirm-message').textContent(), /書き込み.*失われます/); await page.locator('#confirm-cancel').click();
      await page.locator('#open-read').click(); assert.deepEqual(await counts(page), retained);
      // Timing gets an independent, read-only copy of the writing.
      await page.locator('#operations').click(); await page.locator('#measure-current').click();
      assert.deepEqual(await counts(page), retained);
      assert.equal(await page.locator('#writing-mode').isVisible(), false);
      await page.locator('#operations').click(); await page.locator('#home-from-menu').click();
      await page.locator('[data-go="read-input"]').click(); await page.locator('#open-read').click();
      assert.deepEqual(await counts(page), retained);
      assert.deepEqual(checkSaved(await save(page), data).map(mark => mark.type).sort(), ['marker', 'memo', 'pen']);
      assert.equal(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })), initialStorage);
      assert.equal(requests.length, initialRequests, 'writing makes no network requests'); assert.deepEqual(errors, []);
      // A manuscript with writing but no ruby still asks before replacement.
      await page.reload(); await page.locator('[data-go="read-input"]').click();
      await page.locator('#read-text').fill('本文だけの原稿です。'); await page.locator('#open-read').click(); await writingOn(page);
      await tool(page, 'marker'); await tap(await glyph(page, 0));
      await page.locator('#reader-back').click();
      await page.locator('#read-text').evaluate(el => { el.value = '差し替え'; el.dispatchEvent(new Event('input')); });
      await page.locator('#open-read').click(); assert.match(await page.locator('#confirm-message').textContent(), /書き込み.*失われます/);
      await page.locator('#confirm-ok').click(); await page.locator('#reading').waitFor({ state: 'visible' });
      assert.deepEqual(await counts(page), { pen: 0, marker: 0, memo: 0 });
      const unicode = '𠮷👩‍👩‍👧‍👦が\r\n\r\n狐';
      const unicodeData = { ...data, text: unicode, annotations: [{ offset: 2, text: 'かぞく' }], sourceRubies: [{ start: unicode.length - 1, end: unicode.length, reading: 'きつね' }] };
      await page.locator('#reader-back').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'unicode.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(unicodeData)) });
      await page.locator('#confirm-ok').click(); await page.locator('#reading').waitFor({ state: 'visible' });
      await writingOn(page); await tool(page, 'marker'); await tap(await glyph(page, 2));
      assert.equal(await page.locator('#writing-markers rect').first().getAttribute('data-start'), '2');
      assert.equal(await page.locator('#writing-markers rect').first().getAttribute('data-end'), '13', 'ZWJ family is one marked grapheme at original UTF-16 boundaries');
      assert.equal(await originalText(page), unicode); assert.deepEqual(checkSaved(await save(page), unicodeData), [{ id: 1, type: 'marker', start: 2, end: 13, color: 'yellow' }]);
      console.log(`PASS ${width}px: pen/marker/memo, edits/eraser/undo, source anchors/reflow, touch scrolling, ruby isolation, replacement protection, JSON/PDF marks, unchanged timing`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

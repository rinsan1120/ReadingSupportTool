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
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const state = page => page.evaluate(() => Reader.pageState);
const setMode = async (page, value) => {
  await page.locator('#toolbar-settings').click(); await page.locator('#display-mode').selectOption(value);
  await page.locator('[data-close=settings-dialog]').click(); await settle(page);
};
const pdfState = page => page.evaluate(() => Reader.withPrintLayout(() => {
  const text = Reader.printSnapshot(), writing = ManuscriptWriting.printSnapshot({ forPrint: true });
  const result = ManuscriptPrint.prepare(text, writing);
  const html = document.getElementById('manuscript-print').innerHTML;
  ManuscriptPrint.clear();
  return { text: JSON.parse(JSON.stringify(text, (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v)), items: writing.items, pages: result.pages, html };
}));
const bodyText = page => page.locator('#reader').evaluate(root => { const copy = root.cloneNode(true); copy.querySelectorAll('rt,.reading-annotation,.reading-end-marker').forEach(el => el.remove()); return copy.textContent; });
const keys = async (page, key) => { await page.locator('#page-position').click(); await page.keyboard.press(key); };
const checkPages = page => page.evaluate(() => {
  const root = document.getElementById('reader'), stage = document.getElementById('reader-stage');
  const offset = root.getBoundingClientRect().top - stage.getBoundingClientRect().top, p = Reader.pageState;
  const geometry = Reader.getWritingGeometry();
  const boxes = [...geometry.glyphs, ...geometry.annotationRects];
  return { total: p.total, missing: boxes.filter(g => !p.pages.some(page => g.y + offset >= page.top - 1 && g.y + offset + g.height <= page.top + p.height + 1)).slice(0, 3),
    height: p.height, fits: document.getElementById('reader-viewport').getBoundingClientRect().bottom <= innerHeight - document.getElementById('page-controls').getBoundingClientRect().height - (document.getElementById('measurement-bar').hidden ? 0 : document.getElementById('measurement-bar').getBoundingClientRect().height) + 2 };
});
const text = '黄昏の空に狐が現れた。👩‍👩‍👧‍👦が𠮷。\r\n\r\n' + Array.from({ length: 60 }, (_, i) => `第${i}段落。静かな森で間を取り、ゆっくりと読みます。\n`).join('');
const data = { format: 'reading-support-manuscript', version: 5, text, writingDirection: 'horizontal',
  annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 5, end: 6, reading: 'きつね' }],
  marks: [ { id: 1, type: 'pen', offset: 0, layoutKey: '40:1.8:5:0', fontSize: 22, points: [{ x: 0, y: .5 }, { x: 2, y: .5 }], witnesses: [{ offset: 0, x: 0, y: 0 }], color: 'blue' },
    { id: 2, type: 'marker', start: 0, end: 200, color: 'lightblue' },
    { id: 3, type: 'memo', offset: 6, dx: .6, dy: 1, tx: 0, ty: 0, color: 'pink', text: 'ゆっくり読む' } ], memoSettings: { fontSize: 16, opacity: .9 } };
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let portableFile;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page);
      await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden && !document.getElementById('import-manuscript').disabled); await settle(page);
      const original = await page.evaluate(() => ManuscriptWriting.printSnapshot().items);
      for (const direction of ['horizontal', 'vertical']) {
        await page.locator(`button[data-direction=${direction}]`).click();
        await page.locator('#direction-notice').evaluate(el => { el.hidden = true; }); await settle(page);
        const before = await pdfState(page);
        await setMode(page, 'pages');
        assert.equal(await page.locator('#page-controls').isVisible(), true);
        const info = await checkPages(page); assert.ok(info.total > 1); assert.deepEqual(info.missing, [], `all text fits: ${width} ${direction}`); assert.ok(info.fits, 'viewport fits between toolbar and controls');
        assert.equal(await bodyText(page), text, 'source bytes are preserved');
        await page.evaluate(() => Reader.restore({ offset: 0, y: 200 }));
        assert.equal((await state(page)).current, 1); assert.equal(await page.locator('#page-previous').isDisabled(), true);
        const nextKey = direction === 'vertical' ? 'ArrowLeft' : 'ArrowRight', prevKey = direction === 'vertical' ? 'ArrowRight' : 'ArrowLeft';
        await keys(page, nextKey); assert.equal((await state(page)).current, 2);
        await keys(page, prevKey); assert.equal((await state(page)).current, 1);
        await page.locator('#page-next').click(); assert.equal((await state(page)).current, 2);
        await page.waitForTimeout(500);
        await page.locator('#reader-viewport').evaluate(el => { for (let i = 0; i < 30; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })); });
        assert.equal((await state(page)).current, 3, 'one continuous wheel burst turns only once');
        if (width < 600) {
          const r = await page.locator('#reader-viewport').boundingBox(), cdp = await context.newCDPSession(page);
          const x = r.x + r.width / 2, y = r.y + r.height / 2, dx = direction === 'vertical' ? 90 : -90;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - dx / 2, y }] });
          for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - dx / 2 + dx * i / 5, y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          assert.equal((await state(page)).current, 4, 'real touch swipe follows reading direction');
          await page.touchscreen.tap(direction === 'vertical' ? r.x + 10 : r.x + r.width - 10, y);
          assert.equal((await state(page)).current, 5, 'edge tap follows reading direction');
          await cdp.detach();
        }
        const anchor = await page.evaluate(() => Reader.capture());
        await setMode(page, 'scroll'); await setMode(page, 'pages');
        const samePosition = await page.evaluate(offset => {
          const g = Reader.getWritingGeometry().byOffset.get(offset), r = document.getElementById('reader').getBoundingClientRect(), v = document.getElementById('reader-viewport').getBoundingClientRect();
          return g && r.top + g.y >= v.top - 1 && r.top + g.y + g.height <= v.bottom + 1;
        }, anchor.offset);
        assert.ok(samePosition, JSON.stringify({ width, direction, anchor, details: await page.evaluate(offset => { const g = Reader.getWritingGeometry().byOffset.get(offset), r = document.getElementById('reader').getBoundingClientRect(), v = document.getElementById('reader-viewport').getBoundingClientRect(); return { y: r.top + g.y, h: g.height, top: v.top, bottom: v.bottom, state: Reader.pageState, capture: Reader.capture() }; }, anchor.offset) }));
        const printed = await pdfState(page);
        assert.deepEqual(printed.text, before.text, 'PDF text geometry is independent of viewing mode');
        assert.deepEqual(printed.items, before.items); assert.equal(printed.pages, before.pages); assert.equal(printed.html, before.html, 'PDF rendering is identical in either display mode');
        assert.deepEqual(await page.evaluate(() => ManuscriptWriting.printSnapshot().items), original);
        for (const settings of [{ height: 2.6, columns: 10 }, { height: 1.2, columns: 18 }, { height: 1.8, columns: 14 }]) {
          await page.evaluate(settings => Reader.configure(settings), settings); await settle(page);
          const fit = await checkPages(page); assert.deepEqual(fit.missing, [], JSON.stringify({ width, direction, settings, fit })); assert.ok(fit.fits);
        }
        await page.evaluate(() => Reader.configure({ height: 1.8, columns: Reader.getWritingGeometry().width / 22 })); await settle(page);
        await settle(page); await page.waitForTimeout(200);
        await page.evaluate(() => { for (let i = 0; i < 500; i++) Reader.turnPage(1); });
        assert.equal((await state(page)).current, (await state(page)).total); assert.equal(await page.locator('#page-next').isDisabled(), true);
        await page.evaluate(() => Reader.turnPage(1)); assert.equal((await state(page)).current, (await state(page)).total);
        await page.evaluate(() => Reader.restore({ offset: 0, y: 200 }));
        await page.locator('#writing-mode').click();
        await page.locator('#reader-viewport').dispatchEvent('wheel', { deltaY: 120 });
        await page.keyboard.press(nextKey); assert.equal((await state(page)).current, 1, 'writing mode blocks implicit page turns');
        await page.locator('#page-next').click(); assert.equal((await state(page)).current, 2, 'explicit buttons remain usable during writing');
        const at = await page.evaluate(() => {
          const r = document.getElementById('reader').getBoundingClientRect(), v = document.getElementById('reader-viewport').getBoundingClientRect();
          const g = Reader.getWritingGeometry().glyphs.find(g => r.top + g.y > v.top + 30 && r.top + g.y < v.bottom - 30 && r.left + g.x > 25 && r.left + g.x < innerWidth - 45);
          return { x: r.left + g.x + g.width / 2, y: r.top + g.y + g.height / 2 };
        });
        const drawingPage = (await state(page)).current;
        await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 18, at.y + 12, { steps: 6 }); await page.mouse.up();
        assert.equal((await page.evaluate(() => ManuscriptWriting.printSnapshot().items)).length, original.length + 1);
        assert.equal((await state(page)).current, drawingPage, 'pen strokes never turn a page');
        await page.locator('#writing-undo').click(); assert.deepEqual(await page.evaluate(() => ManuscriptWriting.printSnapshot().items), original);
        await page.locator('#writing-off').click();
        await page.locator('#writing-mode').click(); await page.locator('[data-writing-tool=ruby]').click(); await settle(page);
        await page.locator('#page-next').click(); await page.locator('.reading-annotation').first().focus();
        assert.equal((await state(page)).current, 1, 'focusing an off-page ruby reveals its source page');
        await page.locator('.reading-annotation').first().click(); await page.locator('#ruby-input').fill('仮の読み仮名');
        assert.ok((await state(page)).total > 0); await page.locator('#ruby-cancel').click(); await settle(page);
        for (const reading of ['ゆうぐれ', 'たそがれ']) {
          await page.locator('.reading-annotation').first().click(); await page.locator('#ruby-input').fill(reading); await page.locator('#ruby-save').click();
          await page.locator('#confirm-ok').click();
          await page.waitForFunction(reading => document.querySelector('.reading-annotation')?.textContent === `【${reading}】`, reading);
          assert.equal(await bodyText(page), text); assert.deepEqual(await page.evaluate(() => ManuscriptWriting.printSnapshot().items), original);
        }
        await page.locator('#writing-off').click();
        await settle(page);
        assert.equal(await page.locator('#page-controls').isVisible(), true, 'page navigation stays visible after writing');
        await page.locator('#notice').evaluate(el => { el.hidden = true; });
        if (process.env.READER_TEST_ARTIFACTS) { fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `pages-${direction}-${width}.png`) }); }
        await setMode(page, 'scroll');
      }
      await setMode(page, 'pages');
      await page.evaluate(() => Reader.turnPage(2)); const beforeResize = await page.evaluate(() => Reader.capture());
      await page.setViewportSize({ width, height: 600 }); await settle(page); await page.waitForTimeout(100);
      assert.deepEqual((await checkPages(page)).missing, []); assert.ok((await checkPages(page)).fits);
      const restored = await page.evaluate(offset => { const g = Reader.getWritingGeometry().byOffset.get(offset), r = document.getElementById('reader').getBoundingClientRect(), v = document.getElementById('reader-viewport').getBoundingClientRect(); return !g || r.top + g.y >= v.top - 1 && r.top + g.y + g.height <= v.bottom + 1; }, beforeResize.offset);
      assert.ok(restored, 'rotation/resize preserves the source anchor');
      await page.setViewportSize({ width: 900, height: 390 }); await settle(page); await page.waitForTimeout(100);
      assert.deepEqual((await checkPages(page)).missing, []); assert.ok((await checkPages(page)).fits, 'landscape pages fit');
      await page.setViewportSize({ width, height: 600 }); await settle(page);
      const file = await saveUser(page); portableFile = file; assert.equal(file.displaySettings.mode, 'pages');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(UserLibrary.KEY)).displaySettings.mode), 'pages');
      await page.reload(); await startNew(page); assert.equal(await page.locator('#display-mode').inputValue(), 'pages');
      await page.locator('#library-list .book-open').click(); assert.equal(await page.locator('#page-controls').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => ManuscriptWriting.printSnapshot().items), original);
      await page.locator('.brand').click(); await page.locator('#new-manuscript').click();
      await page.locator('#read-text').fill('一頁の原稿。'); await page.locator('#open-read').click(); await settle(page);
      assert.equal((await state(page)).total, 1); assert.equal(await page.locator('#page-next').isDisabled(), true); assert.equal(await page.locator('#page-previous').isDisabled(), true);
      await page.locator('.brand').click(); await page.locator('#library-list .book-open').nth(1).click(); await settle(page);
      assert.equal(await page.locator('#display-mode').inputValue(), 'pages'); assert.ok((await state(page)).total > 1);
      assert.deepEqual(errors, []); await context.close(); console.log(`${width}: pages, controls, geometry, resize, persistence and PDF passed`);
    }
    for (const direction of ['horizontal', 'vertical']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page); await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'measure.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...data, writingDirection: direction })) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden); await setMode(page, 'pages');
      await page.locator('#measure-current').click(); await settle(page);
      assert.equal(await page.locator('#page-start').isVisible(), true);
      if (direction === 'vertical') { await page.locator('#preparation-partial-enabled').check(); await page.locator('#preparation-partial-limit').fill('600'); await settle(page); }
      const expectedCount = Number((await page.locator('#preparation-info').textContent()).match(/(?:実際に読む文字数：|計測する本文：)([0-9]+)/)[1]);
      const before = await page.evaluate(() => ManuscriptWriting.printSnapshot().items);
      await page.clock.install({ time: new Date('2026-11-04T00:00:00Z') }); await page.clock.pauseAt(new Date('2026-11-04T00:00:10Z')); await page.locator('#page-start').click(); await page.clock.runFor(3100); await page.clock.runFor(1250);
      assert.match(await page.locator('#measurement-status').textContent(), /計測中/);
      await page.locator('#page-next').click(); await page.locator('#page-next').click(); await page.locator('#page-previous').click();
      await page.clock.runFor(5000); assert.match(await page.locator('#measurement-status').textContent(), /計測中/);
      assert.equal(await page.locator('#elapsed').textContent(), '0:06');
      assert.ok((await checkPages(page)).fits); assert.deepEqual((await checkPages(page)).missing, []);
      await page.locator('#pause-measurement').click(); await page.locator('#page-next').click(); await page.clock.runFor(3000);
      assert.equal(await page.locator('#elapsed').textContent(), '0:06');
      await page.locator('#pause-measurement').click(); await page.clock.runFor(3000); await page.clock.runFor(1000); await page.locator('#finish').click();
      const record = await page.evaluate(() => JSON.parse(localStorage.getItem(UserLibrary.KEY)).history.at(-1));
      assert.equal(record.characters, expectedCount);
      assert.ok(Math.abs(record.seconds - 7.35) < .01, `only active reading time counted: ${record.seconds}`);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem(UserLibrary.KEY)).manuscripts[0].manuscript.marks), before);
      assert.deepEqual(errors, []); await context.close(); console.log(`${direction}: paged measurement and pause/resume continued without resets`);
    }
    for (const legacy of [false, true]) {
      const context = await browser.newContext(), page = await context.newPage();
      const file = structuredClone(portableFile); if (legacy) delete file.displaySettings;
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('#user-file').setInputFiles({ name: 'user.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await page.waitForFunction(() => !document.getElementById('startup-dialog').open && !document.getElementById('import-user').disabled);
      assert.equal(await page.locator('#display-mode').inputValue(), legacy ? 'scroll' : 'pages');
      await page.locator('#library-list .book-open').click(); await settle(page);
      assert.equal(await page.locator('#page-controls').isVisible(), !legacy);
      await context.close();
    }
    console.log('new and legacy JSON display settings restored');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

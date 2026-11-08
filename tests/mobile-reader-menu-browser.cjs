// Run with Playwright on NODE_PATH and Chrome installed. Phone profiles here
// exercise touch/viewport behavior in Chromium; they do not replace Safari QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew, saveUser } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^[\w-]+\.(html|css|js)$/.test(name)) return res.writeHead(404).end();
  const file = path.join(directory, name);
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(file));
});
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const openMenu = async page => { await page.locator('#mobile-reader-tab').tap(); await page.locator('#mobile-reader-menu').waitFor({ state: 'visible' }); };
const action = async (page, selector) => { await openMenu(page); await page.locator(selector).tap(); await settle(page); };
const geometry = page => page.evaluate(() => {
  const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
  return { viewport: rect('reader-viewport'), tab: rect('mobile-reader-tab'), pages: rect('page-controls'), dock: rect('mobile-writing-dock'), state: Reader.pageState,
    overflow: document.documentElement.scrollWidth > innerWidth, capture: Reader.capture(), scrollY, docHeight: document.documentElement.scrollHeight,
    padding: getComputedStyle(document.getElementById('reading')).paddingBottom, controls: document.querySelector('.reader-controls').getBoundingClientRect().height };
});
const source = '黄昏の空に狐が現れた。\n' + Array.from({ length: 80 }, (_, i) => `第${i}段落。静かな森で間を取り、ゆっくり読みます。\n`).join('');
const manuscript = { format: 'reading-support-manuscript', version: 5, text: source, writingDirection: 'horizontal', annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [], marks: [], memoSettings: { fontSize: 16, opacity: .9 } };
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 600, height: 360 }]) {
      const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page);
      await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'mobile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manuscript)) });
      await page.locator('.mobile-manuscript').waitFor(); await settle(page);
      await action(page, '#toolbar-settings');
      await page.locator('#display-mode').selectOption('pages');
      await page.locator('[data-close=settings-dialog]').click(); await settle(page);
      const initial = await geometry(page);
      if (process.env.READER_TEST_ARTIFACTS) {
        fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `mobile-normal-${size.width}.png`) });
      }
      assert.ok(initial.viewport.height > size.height * .6, `manuscript uses most of the viewport: ${JSON.stringify(initial)}`);
      assert.ok(!initial.overflow); assert.ok(initial.tab.x >= initial.viewport.right, 'tab has its own gutter');
      await openMenu(page);
      if (process.env.READER_TEST_ARTIFACTS) await page.screenshot({ animations: 'disabled', path: path.join(process.env.READER_TEST_ARTIFACTS, `mobile-menu-${size.width}.png`) });
      for (const id of ['reader-back', 'wake', 'paper-mode', 'toolbar-settings', 'writing-mode', 'measure-current', 'export-manuscript', 'export-pdf', 'fullscreen-reading']) {
        assert.equal(await page.locator(`#mobile-reader-menu #${id}`).count(), 1, id);
      }
      for (const direction of ['horizontal', 'vertical']) assert.equal(await page.locator(`#mobile-reader-menu [data-direction=${direction}]`).count(), 1);
      assert.deepEqual((await geometry(page)).state, initial.state, 'drawer does not repaginate');
      assert.deepEqual((await geometry(page)).viewport, initial.viewport, 'drawer does not resize manuscript');
      await page.touchscreen.tap(8, size.height / 2);
      assert.equal(await page.locator('#mobile-reader-menu').isVisible(), false, 'outside tap closes drawer');
      await openMenu(page); await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('mobile-reader-tab').getAttribute('aria-expanded') === 'false');

      for (const direction of ['horizontal', 'vertical']) {
        await action(page, `button[data-direction=${direction}]`);
        await page.locator('#direction-notice').evaluate(el => { el.hidden = true; });
        await page.locator('#page-next').tap(); await settle(page);
        const before = await geometry(page);
        await action(page, '#writing-mode');
        assert.equal(await page.locator('#mobile-reader-menu').isVisible(), false);
        const writing = await geometry(page);
        assert.ok(writing.dock.height > 0);
        assert.ok(writing.dock.bottom <= writing.pages.y + 1, 'writing tools sit above navigation');
        assert.ok(writing.viewport.bottom <= writing.dock.y + 1, `text stays above writing tools: ${JSON.stringify(writing)}`);
        if (direction === 'horizontal' && process.env.READER_TEST_ARTIFACTS) await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `mobile-writing-${size.width}.png`) });
        assert.ok(await page.evaluate(offset => {
          const s = Reader.pageState, p = s.pages[s.current - 1], next = s.pages[s.current];
          return offset >= p.anchor.offset && (!next || offset < next.anchor.offset);
        }, before.capture.offset), 'writing starts on the page containing the current source anchor');
        await page.locator('[data-writing-tool=marker]').tap(); await settle(page);
        const current = (await geometry(page)).state.current;
        await page.locator('#page-next').tap(); await settle(page);
        assert.equal((await geometry(page)).state.current, current + 1);
        assert.equal(await page.locator('[data-writing-tool=marker]').getAttribute('aria-pressed'), 'true');
        assert.equal((await geometry(page)).dock.height, writing.dock.height, 'tool changes keep page geometry stable');
        await action(page, '#paper-mode');
        assert.equal(await page.evaluate(() => ManuscriptWriting.enabled), true, 'drawer is usable while writing');

        // Native touch pen strokes must not become page gestures.
        const pen = page.locator('[data-writing-tool=pen]'); await pen.scrollIntoViewIfNeeded(); await pen.tap();
        const stroke = await page.evaluate(() => {
          const root = document.getElementById('reader').getBoundingClientRect(), v = document.getElementById('reader-viewport').getBoundingClientRect();
          const g = Reader.getWritingGeometry().glyphs.find(g => root.top + g.y > v.top + 20 && root.top + g.y + g.height < v.bottom - 20);
          return g && { x: root.left + g.x + g.width / 2, y: root.top + g.y + g.height / 2 };
        });
        assert.ok(stroke, 'a writable glyph is visible');
        const cdp = await context.newCDPSession(page);
        const pageBeforeStroke = (await geometry(page)).state.current;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stroke] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stroke.x + 12, y: stroke.y + 6 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
        assert.equal((await geometry(page)).state.current, pageBeforeStroke);
        assert.ok(await page.evaluate(() => ManuscriptWriting.printSnapshot().items.some(item => item.type === 'pen')));
        await page.locator('#mobile-writing-done').tap(); await settle(page);
        assert.equal(await page.locator('#writing-toolbar').isVisible(), false);
        assert.equal((await geometry(page)).dock.height, 0);
      }
      if (size.width === 390) {
        await action(page, '#writing-mode');
        const memo = page.locator('[data-writing-tool=memo]'); await memo.scrollIntoViewIfNeeded(); await memo.tap();
        const point = await page.evaluate(() => {
          const root = document.getElementById('reader').getBoundingClientRect(), v = document.getElementById('reader-viewport').getBoundingClientRect();
          const g = Reader.getWritingGeometry().glyphs.find(g => root.top + g.y > v.top + 20 && root.top + g.y + g.height < v.bottom - 20);
          return { x: root.left + g.x + g.width / 2, y: root.top + g.y + g.height / 2 };
        });
        await page.touchscreen.tap(point.x, point.y);
        await page.locator('#writing-memo-input').fill('小さい表示領域でも入力できます');
        await page.setViewportSize({ width: size.width, height: 320 }); await settle(page);
        const editor = await page.locator('#writing-memo-dialog').boundingBox();
        assert.ok(editor.y >= 0 && editor.y + editor.height <= 320, 'memo editor fits reduced visual height');
        await page.locator('#writing-memo-cancel').tap();
        await page.setViewportSize(size); await settle(page);
        await page.locator('#mobile-writing-done').tap(); await settle(page);
      }
      await action(page, '#export-pdf');
      await page.locator('#pdf-dialog').waitFor({ state: 'visible' }); await page.locator('#pdf-cancel').click();
      await openMenu(page); const saved = await saveUser(page);
      assert.equal(saved.manuscripts[0].manuscript.text, source);
      assert.ok(saved.manuscripts[0].manuscript.marks.some(item => item.type === 'pen'));
      await action(page, '#fullscreen-reading');
      assert.equal(await page.evaluate(() => document.body.classList.contains('zen-reading')), true);
      await page.locator('#zen-exit').tap(); await settle(page);
      assert.equal(await page.locator('#mobile-reader-tab').isVisible(), true);
      await action(page, '#measure-current');
      assert.equal(await page.locator('#mobile-reader-tab').isVisible(), false, 'measurement retains its existing controls');
      assert.equal(await page.locator('#preparation').isVisible(), true);
      await page.locator('.brand').click();
      await page.locator('#library-list .book-open').first().click(); await settle(page);
      // Rotation across the breakpoint restores the original desktop controls.
      await page.setViewportSize({ width: 844, height: 390 }); await settle(page);
      assert.equal(await page.locator('#mobile-reader-tab').isVisible(), false);
      assert.equal(await page.locator('.reader-controls > .reader-toolbar').count(), 1);
      assert.equal(await page.locator('.reader-controls > #writing-toolbar').count(), 1);
      assert.equal(await page.locator('#reader-back').isVisible(), true);
      await page.setViewportSize(size); await settle(page);
      assert.equal(await page.locator('#mobile-reader-tab').isVisible(), true);
      assert.ok(!(await geometry(page)).overflow);
      // Reduced visual height (browser chrome / keyboard) keeps controls usable.
      await page.setViewportSize({ width: size.width, height: Math.max(320, size.height - 180) }); await settle(page);
      const reduced = await geometry(page);
      assert.ok(reduced.tab.bottom <= Math.max(320, size.height - 180));
      assert.ok(reduced.pages.bottom <= Math.max(320, size.height - 180) + 1);
      assert.deepEqual(errors, []);
      console.log(`mobile reader touch and geometry: ${size.width}x${size.height} passed`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

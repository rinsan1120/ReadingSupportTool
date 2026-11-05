// Native touch scrolling must preserve reader-relative writing coordinates.
// Run with Playwright on NODE_PATH and Chrome installed. Not Safari device QA.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const { startNew, saveUser } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^[\w-]+\.(html|css|js)$/.test(name) || !fs.existsSync(path.join(directory, name))) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const text = '本文の下まで書き込みます。黄昏の森で狐が歩く。\n'.repeat(50) + '最後の文字まで操作できます。';
const fixture = { format: 'reading-support-manuscript', version: 6, text, writingDirection: 'horizontal',
  annotations: [{ offset: 2, text: 'ほんぶん' }], sourceRubies: [{ start: 14, end: 16, reading: 'たそがれ' }],
  marks: [{ id: 1, type: 'marker', start: 0, end: 5, color: 'pink' },
    { id: 2, type: 'pen', direction: 'horizontal', offset: 0, fontSize: 22, layoutKey: '40:1.8:5:0', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], witnesses: [{ offset: 0, x: 0, y: 0 }], color: 'green' },
    { id: 3, type: 'memo', offset: 0, text: '既存のメモ', color: 'yellow', dx: .6, dy: 1, tx: 0, ty: 0 }], memoSettings: { fontSize: 16, opacity: .9 } };
const openMenu = async page => { await page.locator('#mobile-reader-tab').tap(); await page.locator('#mobile-reader-menu').waitFor({ state: 'visible' }); };
const action = async (page, selector) => { await openMenu(page); await page.locator(selector).tap(); await settle(page); };
const snapshot = page => page.evaluate(() => ({ items: ManuscriptWriting.printSnapshot().items, pens: ManuscriptWriting.printSnapshot().pens,
  glyphs: Reader.getWritingGeometry().glyphs.map(({ start, x, y, width, height }) => ({ start, x, y, width, height })) }));
const workArea = page => page.evaluate(() => {
  const v = document.getElementById('reader-viewport').getBoundingClientRect(), d = document.getElementById('mobile-writing-dock').getBoundingClientRect();
  const values = getComputedStyle(document.getElementById('reader-viewport')).clipPath.match(/[\d.]+/g)?.map(Number);
  return { top: Math.max(0, v.top + (values?.[0] || 0)), bottom: v.bottom - (values?.[2] ?? values?.[0] ?? 0), dockTop: d.top, left: v.left, right: v.right };
});
async function pan(page, cdp) {
  const area = await workArea(page), x = (area.left + area.right) / 2;
  const y = Math.min(area.bottom - 20, area.top + 180), distance = Math.min(100, y - area.top - 15);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance * i / 6 }] });
    await settle(page);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Let kinetic scrolling settle before switching back to an editing tool.
  await page.waitForTimeout(400); await settle(page);
}
async function selectTool(page, tool) {
  if (tool === 'move') await selectTool(page, 'pen');
  const button = page.locator(`[data-writing-tool=${tool}]`); await button.scrollIntoViewIfNeeded(); await button.tap(); await settle(page);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 600, height: 360 }]) {
      const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
      const page = await context.newPage(), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page);
      await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'scroll.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
      try { await page.locator('#reader').waitFor(); } catch (error) { throw new Error(`${error.message}: ${await page.locator('#notice').textContent()}`); } await settle(page);
      const cdp = await context.newCDPSession(page);
      for (const direction of ['horizontal', 'vertical']) {
        await action(page, `button[data-direction=${direction}]`);
        await page.locator('#direction-notice').evaluate(el => { el.hidden = true; });
        for (const mode of ['scroll', 'pages']) {
          await page.evaluate(mode => Reader.setDisplayMode(mode), mode); await settle(page);
          await action(page, '#writing-mode');
          const area = await workArea(page);
          assert.ok(area.bottom <= area.dockTop + 1, 'painted work area ends above toolbar');
          for (const tool of ['pen', 'marker', 'memo', 'ruby', 'eraser', 'move']) {
            await selectTool(page, tool);
            if (tool === 'pen') {
              const blue = page.locator('[data-pen-color=blue]'); await blue.scrollIntoViewIfNeeded(); await blue.tap();
              await page.locator('#pen-line-mode').tap();
            }
            if (tool === 'marker') { const pink = page.locator('[data-marker-color=pink]'); await pink.scrollIntoViewIfNeeded(); await pink.tap(); }
            const before = await snapshot(page), oldScroll = await page.evaluate(() => scrollY);
            await page.locator('#mobile-writing-scroll').tap(); await settle(page);
            assert.equal(await page.evaluate(() => ManuscriptWriting.enabled), true);
            assert.equal(await page.locator('#mobile-writing-scroll').getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('#reader').evaluate(el => el.classList.contains('ruby-mode')), false);
            if (tool === 'memo') assert.ok(await page.locator('.memo-body').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).pointerEvents === 'none')), 'memo bodies cannot intercept a scroll gesture');
            if (tool === 'move') assert.ok(await page.locator('.pen-hit').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).pointerEvents === 'none')), 'pen hit targets cannot intercept a scroll gesture');
            await pan(page, cdp);
            if (mode === 'scroll') assert.ok(await page.evaluate(y => scrollY > y + 2, oldScroll), `${size.width}/${direction}/${tool}: real touch scrolls document`);
            await page.locator('#mobile-writing-scroll').tap(); await settle(page);
            assert.deepEqual(await snapshot(page), before, `${tool}: scroll and resume preserve model and geometry`);
            assert.equal(await page.locator(`[data-writing-tool=${tool}]`).getAttribute('aria-pressed'), 'true');
            if (tool === 'ruby') assert.equal(await page.locator('#reader').evaluate(el => el.classList.contains('ruby-mode')), true);
            if (tool === 'pen') {
              assert.equal(await page.locator('[data-pen-color=blue]').getAttribute('aria-pressed'), 'true');
              assert.equal(await page.locator('#pen-line-mode').getAttribute('aria-pressed'), 'true');
              await page.locator('#pen-line-mode').tap();
            }
            if (tool === 'marker') assert.equal(await page.locator('[data-marker-color=pink]').getAttribute('aria-pressed'), 'true');
            if (mode === 'scroll') await page.evaluate(() => scrollTo(0, 0));
          }
          if (mode === 'pages') {
            await selectTool(page, 'pen'); const state = await page.evaluate(() => Reader.pageState);
            const step = state.current < state.total ? 1 : -1;
            await page.locator(step === 1 ? '#page-next' : '#page-previous').tap(); await settle(page);
            assert.equal(await page.evaluate(() => Reader.pageState.current), state.current + step);
            assert.ok((await workArea(page)).bottom <= (await workArea(page)).dockTop + 1);
            assert.ok(await page.evaluate(() => {
              const root = document.getElementById('reader').getBoundingClientRect(), stage = document.getElementById('reader-stage').getBoundingClientRect();
              const p = Reader.pageState;
              return Reader.getWritingGeometry().glyphs.every(g => p.pages.some(page => g.y + root.top - stage.top >= page.top - 1 && g.y + root.top - stage.top + g.height <= page.top + p.height + 1));
            }), 'each paged glyph is reachable above the toolbar');
          } else {
            await selectTool(page, 'pen'); await page.locator('#mobile-writing-scroll').tap();
            await page.evaluate(() => {
              const g = Reader.getWritingGeometry().glyphs.at(-1), root = document.getElementById('reader').getBoundingClientRect();
              scrollBy(0, root.top + g.y - 40);
            }); await settle(page);
            await page.locator('#mobile-writing-scroll').tap(); await settle(page);
          }
          // Stroke the lowest reachable character, after scrolling or paging.
          const point = await page.evaluate(() => {
            const root = document.getElementById('reader').getBoundingClientRect(), dock = document.getElementById('mobile-writing-dock').getBoundingClientRect();
            const viewport = document.getElementById('reader-viewport').getBoundingClientRect();
            const glyphs = Reader.getWritingGeometry().glyphs.filter(g => root.top + g.y >= Math.max(10, viewport.top) && root.top + g.y + g.height < dock.top - 12);
            const g = glyphs.at(-1); return g && { x: root.left + g.x + g.width / 2, y: root.top + g.y + g.height / 2, offset: g.start };
          });
          assert.ok(point, 'a target glyph is accessible');
          if (mode === 'scroll') assert.equal(point.offset, await page.evaluate(() => Reader.getWritingGeometry().glyphs.at(-1).start), 'the manuscript end is reachable without leaving writing mode');
          await selectTool(page, 'marker');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          assert.ok(await page.evaluate(offset => ManuscriptWriting.printSnapshot().items.some(item => item.type === 'marker' && item.start === offset && item.color === 'pink'), point.offset), 'marker reaches the same source character after scrolling');
          await selectTool(page, 'pen');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 5, y: point.y + 3 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          assert.ok(await page.evaluate(offset => ManuscriptWriting.printSnapshot().items.some(item => item.type === 'pen' && item.offset === offset && item.color === 'blue'), point.offset), 'pen uses the correct source anchor after scrolling');
          if (process.env.READER_TEST_ARTIFACTS && size.width === 320) {
            fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
            await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `writing-${direction}-${mode}.png`) });
          }
          await page.locator('#mobile-writing-done').tap(); await settle(page);
          assert.equal(await page.locator('#reader-viewport').evaluate(el => getComputedStyle(el).clipPath), 'none');
        }
      }
      await cdp.detach(); await openMenu(page); const saved = await saveUser(page);
      assert.equal(saved.manuscripts[0].manuscript.text, text);
      assert.ok(saved.manuscripts[0].manuscript.marks.length > fixture.marks.length);
      await action(page, '#writing-mode'); await page.locator('#mobile-writing-scroll').tap();
      await page.setViewportSize({ width: 1200, height: 900 }); await settle(page);
      assert.equal(await page.locator('#mobile-writing-scroll').isVisible(), false, 'desktop UI has no mobile scrolling button');
      assert.equal(await page.evaluate(() => ManuscriptWriting.scrolling), false, 'rotation restores the desktop writing tool');
      assert.equal(await page.evaluate(() => ManuscriptWriting.enabled), true);
      assert.equal(await page.locator('#reader-viewport').evaluate(el => getComputedStyle(el).clipPath), 'none', 'desktop work area is unchanged');
      assert.deepEqual(errors, []); await context.close();
      console.log(`${size.width}x${size.height}: native scroll for all tools, resume, source coordinates, both directions/modes and save passed`);
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

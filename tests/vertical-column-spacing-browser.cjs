// Rendered column bounds, including native rt and fallback fonts. Run with
// Playwright on NODE_PATH and Chrome installed; Safari still needs device QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
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
const text = '黄昏の森で狐が歩く。次の列にも読みを付けます。👩‍👩‍👧‍👦𠮷\n'.repeat(22);
const sourceRubies = [...text.matchAll(/黄昏|狐/g)].map(match => ({ start: match.index, end: match.index + match[0].length, reading: match[0] === '狐' ? 'きつね' : 'たそがれ' }));
const fixture = { format: 'reading-support-manuscript', version: 6, text, annotations: [{ offset: 4, text: 'もり' }], sourceRubies, marks: [], memoSettings: { fontSize: 16, opacity: .9 }, writingDirection: 'vertical' };
const columnBounds = page => page.evaluate(() => {
  const range = document.createRange();
  return [...document.querySelectorAll('.vertical-page')].map(page => {
    const outer = page.getBoundingClientRect();
    return [...page.children].map(column => {
      const boxes = [...column.querySelectorAll('.source-ruby-unit')].map(node => node.getBoundingClientRect());
      const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        range.selectNodeContents(walker.currentNode);
        boxes.push(...[...range.getClientRects()].filter(r => r.width && r.height));
      }
      const rect = column.getBoundingClientRect();
      return { left: Math.min(rect.right, ...boxes.map(r => r.left)) - outer.left,
        right: Math.max(rect.left, ...boxes.map(r => r.right)) - outer.left,
        width: rect.width, slot: parseFloat(column.style.right), pageWidth: outer.width };
    });
  });
});
const checkBounds = async (page, label) => {
  for (const columns of await columnBounds(page)) for (let i = 0; i < columns.length; i++) {
    const col = columns[i], previous = columns[i - 1];
    assert.ok(col.left >= -.6 && col.right <= col.pageWidth + .6, `${label}: column stays in section: ${JSON.stringify(col)}`);
    if (previous) assert.ok(col.right <= previous.left + .6, `${label}: adjacent column ink overlaps: ${JSON.stringify({ previous, col })}`);
  }
};
const pdf = page => page.evaluate(() => Reader.withPrintLayout(() => {
  const snapshot = Reader.printSnapshot();
  const result = ManuscriptPrint.prepare(snapshot, ManuscriptWriting.printSnapshot({ forPrint: true }));
  const html = document.getElementById('manuscript-print').innerHTML;
  ManuscriptPrint.clear(); return { pages: result.pages, html };
}, { inlineSize: 800 }));
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [320, 390, 600, 1200]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width <= 600, hasTouch: width <= 600 });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page);
      await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'spacing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
      await page.locator('#reader').waitFor(); await settle(page);
      for (const mode of ['scroll', 'pages']) for (const fontSize of [18, 36]) for (const height of [1.2, 1.8, 2.6]) {
        await page.evaluate(({ mode, fontSize, height }) => { Reader.setDisplayMode(mode); Reader.configure({ fontSize, height, breaks: 0 }); }, { mode, fontSize, height }); await settle(page);
        if (width <= 600) await checkBounds(page, `${width}/${mode}/${fontSize}/${height}`);
        else {
          const columns = (await columnBounds(page)).flat();
          assert.ok(columns.every(col => Math.abs(col.width - fontSize * height) < .1), 'desktop nominal pitch remains unchanged');
          const firstSection = (await columnBounds(page))[0];
          firstSection.forEach((col, i) => assert.ok(Math.abs(col.slot - i * fontSize * height) < .1, 'desktop column placement stays unchanged'));
        }
        const consistency = await page.evaluate(() => {
          const root = document.getElementById('reader'), origin = root.getBoundingClientRect(), range = document.createRange();
          const g = Reader.getWritingGeometry();
          const nodes = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let offset = 0;
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.parentElement.closest('rt,.reading-annotation')) continue;
            nodes.push({ node, start: offset, end: offset + node.length }); offset += node.length;
          }
          return g.glyphs.every(glyph => {
            // Find the frozen source text by the source mapping, then compare
            // the geometry used by pen/marker hit testing with its DOM bounds.
            const part = nodes.find(part => glyph.start >= part.start && glyph.start < part.end);
            if (!part) return false;
            range.setStart(part.node, glyph.start - part.start); range.setEnd(part.node, glyph.end - part.start);
            const r = range.getBoundingClientRect();
            return Math.abs(r.left - origin.left - glyph.x) < .1 && Math.abs(r.top - origin.top - glyph.y) < .1;
          });
        });
        assert.ok(consistency, `${width}/${mode}/${fontSize}/${height}: writing geometry follows rendered glyphs`);
        if (width === 320 && fontSize === 18 && height === 1.2 && process.env.READER_TEST_ARTIFACTS) {
          fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
          await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `vertical-spacing-${mode}.png`) });
        }
        if (mode === 'pages') {
          assert.ok(await page.evaluate(() => {
            const root = document.getElementById('reader').getBoundingClientRect(), stage = document.getElementById('reader-stage').getBoundingClientRect();
            const p = Reader.pageState, boxes = [...Reader.getWritingGeometry().glyphs, ...Reader.getWritingGeometry().annotationRects];
            return boxes.every(g => p.pages.some(page => g.y + root.top - stage.top >= page.top - 1 && g.y + root.top - stage.top + g.height <= page.top + p.height + 1));
          }), 'all glyphs and manual readings belong to a page');
        }
      }
      if (width <= 600) {
        // Larger rt / a different font represents engine/font metric variance,
        // including overflow on either side of the nominal column box.
        await page.addStyleTag({ content: '#reader { font-family:system-ui,sans-serif!important } #reader rt { font-size:.85em; position:relative; right:-3px }' });
        await page.evaluate(() => Reader.configure({ fontSize: 22, height: 1.2, breaks: 3 })); await settle(page);
        await checkBounds(page, `${width}/alternate ruby metrics`);
        const before = await pdf(page);
        await page.evaluate(() => Reader.setDisplayMode('scroll'));
        assert.deepEqual(await pdf(page), before, 'PDF layout stays independent of screen paging');
        // A sufficiently wide requested pitch must still be honored unchanged.
        await page.evaluate(() => { document.querySelector('style:last-of-type')?.remove(); Reader.configure({ fontSize: 22, height: 2.6, breaks: 0 }); }); await settle(page);
        assert.ok((await columnBounds(page)).flat().every(col => Math.abs(col.width - 57.2) < .1));
        for (const columns of await columnBounds(page)) columns.forEach((col, i) => assert.ok(Math.abs(col.slot - i * 57.2) < .1, 'a sufficiently wide pitch keeps its existing placement'));
        await page.evaluate(() => Reader.configure({ height: 1.2 })); await settle(page);
        await page.locator('#mobile-reader-tab').click();
        const saved = await saveUser(page);
        assert.equal(saved.displaySettings.height, 1.2, 'the requested minimum is saved without substitution');
        assert.equal(saved.manuscripts[0].manuscript.text, text);
        assert.deepEqual(saved.manuscripts[0].manuscript.sourceRubies, sourceRubies);
        await page.reload(); await startNew(page);
        await page.locator('#library-list .book-open').first().click(); await settle(page);
        assert.equal(await page.locator('#line-height').inputValue(), '1.2', 'saved settings load without migration');
        await checkBounds(page, `${width}/restored settings`);
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.locator('#line-height').getAttribute('min'), '1.2', 'slider minimum is preserved');
      console.log(`${width}: column bounds, settings, writing geometry and pagination passed`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

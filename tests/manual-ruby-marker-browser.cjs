// Real wrapped readings, restored source ranges and paginated vector markers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.locator('[data-go=read-input]').click();
      const text = '花筏が風に舞う。\n' + '夏の川を見つめる。\n'.repeat(90);
      const later = text.indexOf('夏', Math.floor(text.length / 2)) + 1;
      const data = { format: 'reading-support-manuscript', version: 4, text,
        annotations: [{ offset: 0, text: '冒頭は対象外' }, { offset: 2, text: 'はないかだ' },
          { offset: 4, text: 'ながいよみがな'.repeat(18) }, { offset: 6, text: 'まう' }, { offset: later, text: 'なつ'.repeat(25) }],
        sourceRubies: [{ start: 0, end: 2, reading: 'はないかだ' }],
        marks: [{ id: 1, type: 'marker', start: 0, end: 2, color: 'yellow' },
          { id: 2, type: 'marker', start: 2, end: 3, color: 'pink' },
          { id: 3, type: 'marker', start: 3, end: 4, color: 'lightblue' },
          { id: 4, type: 'marker', start: 4, end: 6, color: 'pink' },
          { id: 5, type: 'marker', start: later - 1, end: later, color: 'yellow' }],
        memoSettings: { fontSize: 16, opacity: .9 } };
      await page.locator('#manuscript-file').setInputFiles({ name: 'ruby-marker.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden && !document.getElementById('import-manuscript').disabled);
      await page.evaluate(() => document.fonts.ready);
      const inspect = () => page.evaluate(() => {
        const snapshot = Reader.printSnapshot(), writing = ManuscriptWriting.printSnapshot();
        const rects = [...document.querySelectorAll('#writing-markers rect')].map(r => ({
          id: Number(r.dataset.markId), color: r.dataset.color,
          x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')),
          width: Number(r.getAttribute('width')), height: Number(r.getAttribute('height')) }));
        return { snapshot, writing, rects, dom: document.getElementById('reader').innerHTML,
          color: getComputedStyle(document.querySelector('.reading-annotation')).color,
          bodyColor: getComputedStyle(document.getElementById('reader')).color,
          originalColor: getComputedStyle(document.querySelector('.source-ruby-unit rt')).color };
      });
      const dark = await inspect();
      assert.equal(dark.color, 'rgb(252, 213, 138)');
      assert.ok(new Set(dark.snapshot.annotationRects.filter(r => r.offset === 4).map(r => r.y)).size > 1, 'reading wraps across lines');
      for (const settings of [{}, { height: 2.4, breaks: 2 }]) {
        await page.evaluate(s => Reader.configure(s), settings);
        const state = await inspect();
        for (const mark of data.marks) {
          const eligible = state.snapshot.annotationRects.filter(r => mark.start < r.offset && r.offset <= mark.end);
          for (const box of eligible) assert.ok(state.rects.some(r => r.id === mark.id && r.color === mark.color
            && Math.abs(r.x - box.x) < .01 && Math.abs(r.y - box.y) < .01
            && Math.abs(r.width - box.width) < .01 && Math.abs(r.height - box.height) < .01), 'full reading fragment is highlighted');
        }
        const excluded = state.snapshot.annotationRects.filter(r => r.offset === 2);
        for (const box of excluded) assert.ok(!state.rects.some(r => r.id === 2 && Math.abs(r.x - box.x) < .01 && Math.abs(r.y - box.y) < .01));
        assert.deepEqual(state.writing.items, data.marks, 'drawing does not alter saved ranges');
        const print = await page.evaluate(() => {
          const snapshot = Reader.printSnapshot(), result = ManuscriptPrint.prepare(snapshot, ManuscriptWriting.printSnapshot());
          const rects = [...document.querySelectorAll('.manuscript-markers rect[data-annotation]')].map(r => ({
            id: Number(r.dataset.markId), offset: Number(r.dataset.annotation), color: r.dataset.color,
            width: Number(r.getAttribute('width')), height: Number(r.getAttribute('height')) }));
          const colors = [...document.querySelectorAll('.manuscript-annotation')].map(e => getComputedStyle(e).color);
          const root = document.getElementById('manuscript-print'); root.classList.add('print-measuring');
          const positioned = [...root.querySelectorAll('.manuscript-markers rect[data-annotation]')].every(rect => {
            const box = rect.getBoundingClientRect();
            return [...rect.closest('.manuscript-canvas').querySelectorAll('.manuscript-annotation')].some(span => {
              if (span.dataset.annotation !== rect.dataset.annotation) return false;
              const range = document.createRange(); range.selectNodeContents(span);
              const ink = range.getBoundingClientRect();
              return Math.abs(box.left - ink.left) < 1.5 && Math.abs(box.top - ink.top) < 1.5
                && Math.abs(box.width - ink.width) < 2 && Math.abs(box.height - ink.height) < 1.5;
            });
          });
          ManuscriptPrint.clear();
          return { result, rects, colors, positioned };
        });
        assert.ok(print.result.pages > 1, 'annotations are checked on multiple pages');
        assert.ok(print.positioned, 'printed highlights sit behind the actual reading text');
        for (const mark of data.marks) {
          const expected = state.snapshot.annotationRects.filter(r => mark.start < r.offset && r.offset <= mark.end);
          const actual = print.rects.filter(r => r.id === mark.id);
          assert.equal(actual.length, expected.length, 'PDF uses exactly the eligible fragments');
          for (let i = 0; i < expected.length; i++) {
            assert.equal(actual[i].offset, expected[i].offset); assert.equal(actual[i].color, mark.color);
            assert.ok(Math.abs(actual[i].width - expected[i].width * print.result.scale) < .001);
            assert.ok(Math.abs(actual[i].height - expected[i].height * print.result.scale) < .001);
          }
        }
        assert.ok(print.colors.every(c => c === 'rgb(23, 54, 93)'), 'PDF manual reading stays navy');
      }
      const beforeWhite = await inspect();
      await page.locator('#paper-mode').click();
      const white = await inspect();
      assert.equal(white.color, 'rgb(37, 99, 235)');
      assert.equal(white.originalColor, white.bodyColor, 'native reading keeps the existing body color');
      assert.deepEqual(white.snapshot, beforeWhite.snapshot, 'paint toggle preserves all layout geometry');
      assert.deepEqual(white.writing, beforeWhite.writing);
      assert.equal(white.dom, beforeWhite.dom);
      await page.locator('#paper-mode').click();
      assert.equal((await inspect()).color, dark.color);
      await page.locator('#writing-mode').click(); // Autosave removes the former file-edit warning.
      await page.locator('[data-writing-tool=eraser]').click();
      await page.locator('.reading-annotation[data-offset="2"]').first().click();
      assert.ok(!(await inspect()).writing.items.some(m => m.id === 1), 'eraser works on highlighted reading');
      await page.locator('#writing-undo').click();
      assert.deepEqual((await inspect()).writing.items, data.marks, 'Undo restores the original source range and color');
      await page.locator('#writing-off').click();
      await page.evaluate(data => {
        const readings = ReadingAnnotations.fromData(data); readings.set(2, '編集した読み仮名');
        Reader.show(data.text, readings);
      }, data);
      assert.ok((await inspect()).snapshot.annotationRects.some(r => r.offset === 2));
      await page.evaluate(data => {
        const readings = ReadingAnnotations.fromData(data); readings.remove(2);
        Reader.show(data.text, readings);
      }, data);
      assert.equal((await inspect()).snapshot.annotationRects.filter(r => r.offset === 2).length, 0);
      assert.deepEqual((await inspect()).writing.items, data.marks, 'reading changes do not rewrite stored markers');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(width + 'px: restored 3-color ranges, wrapped readings, PDF and paint-only colors passed');
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

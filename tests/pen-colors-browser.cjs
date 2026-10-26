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
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: true });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.locator('[data-go=read-input]').click();
      const text = '静かな森を歩いて風の音を聞く。\n'.repeat(90);
      const pen = (id, offset, color, points = [{ x: 0, y: .7 }, { x: 2, y: .7 }]) => ({
        id, type: 'pen', offset, layoutKey: '40:1.8:5:0', fontSize: 22, points,
        witnesses: [{ offset, x: 0, y: 0 }], ...(color ? { color } : {}) });
      const data = { format: 'reading-support-manuscript', version: 4, text, annotations: [], sourceRubies: [],
        marks: [pen(1, 0), pen(2, 2, 'blue', [{ x: 0, y: 1 }, { x: 1, y: 100 }, { x: 2, y: 1 }]), pen(3, 4, 'green')],
        memoSettings: { fontSize: 16, opacity: .9 } };
      await page.locator('#manuscript-file').setInputFiles({ name: 'pens.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden && !document.getElementById('import-manuscript').disabled);
      await page.evaluate(() => document.fonts.ready);
      const state = () => page.evaluate(() => ManuscriptWriting.printSnapshot());
      const initial = await state();
      assert.equal(initial.items[0].color, 'red');
      for (let i = 0; i < 3; i++) {
        assert.deepEqual(initial.items[i].points, data.marks[i].points);
        assert.deepEqual(initial.items[i].witnesses, data.marks[i].witnesses);
      }
      const validations = await page.evaluate(data => {
        const restored = ManuscriptMarks.restoreManuscript(JSON.stringify(data));
        const legacy = [1, 2, 3, 4].map(version => {
          const input = { ...data, version };
          if (version < 3) { delete input.marks; delete input.memoSettings; }
          const result = ManuscriptMarks.restoreManuscript(JSON.stringify(input));
          return result.markings.items.length === (version < 3 ? 0 : 3);
        });
        const invalid = ['yellow', '#ff0000', 'RED', '', null, 7, {}].map(color => {
          const input = structuredClone(data); input.marks[0].color = color;
          let load = false, save = false;
          try { ManuscriptMarks.restoreManuscript(JSON.stringify(input)); } catch { load = true; }
          restored.markings.items[0].color = color;
          try { ManuscriptMarks.serializeManuscript(restored.manuscript, restored.markings); } catch { save = true; }
          return load && save;
        });
        return { legacy, invalid };
      }, data);
      assert.ok(validations.legacy.every(Boolean)); assert.ok(validations.invalid.every(Boolean));
      await page.locator('#writing-mode').click(); // Autosave removes the former file-edit warning.
      assert.deepEqual(await page.locator('.writing-tools > button > span').allTextContents(), ['ペン', 'マーカー', 'メモ', 'ルビ', '消去', '戻す']);
      assert.ok(await page.locator('#writing-mode').isVisible());
      assert.equal(await page.locator('#writing-mode').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#writing-mode .button-state').count(), 0);
      assert.equal(await page.locator('#writing-off').getAttribute('aria-label'), '書込メニューを閉じる');
      assert.ok(await page.locator('#export-pdf').isHidden()); assert.ok(await page.locator('#measure-current').isHidden());
      assert.ok(await page.locator('#pen-options').isVisible());
      assert.equal(await page.locator('[data-pen-color=red]').getAttribute('aria-pressed'), 'true');
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('.writing-tools button, #pen-options button')]
        .every(b => b.getBoundingClientRect().right <= innerWidth && b.scrollWidth <= b.clientWidth + 1)));
      const cdp = await context.newCDPSession(page);
      const drag = async (point, dx, dy) => {
        if (width < 600) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + dx, y: point.y + dy }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(point.x, point.y); await page.mouse.down();
          await page.mouse.move(point.x + dx, point.y + dy, { steps: 5 }); await page.mouse.up();
        }
      };
      for (const [i, color] of ['red', 'blue', 'green'].entries()) {
        await page.locator('[data-pen-color=' + color + ']').click();
        const point = await page.evaluate(index => {
          const g = Reader.getWritingGeometry().byOffset.get(index), r = document.getElementById('reader').getBoundingClientRect();
          return { x: r.left + g.x + g.width / 2, y: r.top + g.y + g.height / 2 };
        }, 5 + i * 2);
        await drag(point, 24, 5);
        assert.equal((await state()).items.at(-1).color, color);
        assert.equal(await page.locator('#writing-pen path[data-mark-id]').last().getAttribute('data-color'), color);
      }
      for (const tool of ['marker', 'memo', 'ruby', 'eraser']) {
        await page.locator('[data-writing-tool=' + tool + ']').click();
        assert.ok(await page.locator('#pen-options').isHidden());
      }
      await page.locator('[data-writing-tool=pen]').click();
      assert.equal(await page.locator('[data-pen-color=green]').getAttribute('aria-pressed'), 'true');
      const beforeMove = await state(), target = beforeMove.pens.at(-1);
      await page.locator('[data-writing-tool=move]').click();
      assert.ok(await page.locator('#pen-options').isVisible());
      assert.equal(await page.locator('[data-writing-tool=pen]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-pen-color][aria-pressed=true]').count(), 0);
      const point = await page.evaluate(p => {
        const r = document.getElementById('reader').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y };
      }, target.points[0]);
      await drag(point, 18, 25);
      const moved = await state(), movedPen = moved.pens.at(-1);
      assert.equal(moved.items.length, beforeMove.items.length, 'moving never draws a new stroke');
      assert.equal(moved.items.at(-1).color, 'green');
      movedPen.points.forEach((p, i) => {
        assert.ok(Math.abs(p.x - target.points[i].x - 18) < .01);
        assert.ok(Math.abs(p.y - target.points[i].y - 25) < .01);
      });
      await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items, beforeMove.items);
      if (width < 600) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 12, y: point.y + 16 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      } else {
        await page.mouse.move(point.x, point.y); await page.mouse.down();
        await page.mouse.move(point.x + 12, point.y + 16); await page.keyboard.press('Escape'); await page.mouse.up();
      }
      assert.deepEqual((await state()).items, beforeMove.items, 'cancelling a move preserves original position and color');
      await page.locator('[data-pen-color=blue]').click();
      assert.equal(await page.locator('[data-writing-tool=move]').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('[data-pen-color=blue]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-writing-tool=marker]').click(); await page.locator('[data-writing-tool=pen]').click();
      assert.equal(await page.locator('[data-pen-color=blue]').getAttribute('aria-pressed'), 'true');
      const beforeClose = await state(), undoDisabled = await page.locator('#writing-undo').isDisabled();
      await page.locator('#writing-mode').click();
      assert.equal(await page.locator('#writing-mode').getAttribute('aria-expanded'), 'false');
      assert.ok(await page.locator('#writing-toolbar').isHidden());
      assert.ok(await page.locator('#reader-actions button:not([hidden])').evaluateAll(buttons => buttons.every(b =>
        b.getBoundingClientRect().right <= innerWidth && b.scrollWidth <= b.clientWidth + 1)), 'long menu label fits narrow toolbars');
      assert.ok(await page.locator('#export-pdf').isVisible()); assert.ok(await page.locator('#measure-current').isVisible());
      assert.equal(await page.locator('#reader-stage.writing-active').count(), 0);
      assert.deepEqual(await state(), beforeClose, 'closing the menu preserves all writing');
      assert.equal(await page.locator('#writing-pen path[data-mark-id]').count(), beforeClose.items.length);
      await page.locator('#writing-mode').click();
      assert.ok(await page.locator('#writing-toolbar').isVisible());
      assert.equal(await page.locator('#writing-undo').isDisabled(), undoDisabled, 'history survives reopening');
      await page.locator('#writing-off').click();
      assert.equal(await page.locator('#writing-mode').getAttribute('aria-expanded'), 'false');
      assert.deepEqual(await state(), beforeClose, 'X uses the same closing behavior');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'writing-mode');
      const colors = async () => page.locator('#writing-pen path[data-mark-id]').evaluateAll(paths => paths.map(p => getComputedStyle(p).stroke));
      assert.deepEqual((await colors()).slice(0, 3), ['rgb(255, 107, 107)', 'rgb(96, 165, 250)', 'rgb(74, 222, 128)']);
      await page.locator('#paper-mode').click();
      assert.deepEqual((await colors()).slice(0, 3), ['rgb(197, 34, 40)', 'rgb(37, 99, 235)', 'rgb(21, 128, 61)']);
      const pdf = await page.evaluate(() => {
        const writing = ManuscriptWriting.printSnapshot(), snapshot = Reader.printSnapshot();
        const inspect = () => [...document.querySelectorAll('.manuscript-pens path')].map(p => ({
          id: Number(p.dataset.markId), page: [...document.querySelectorAll('.manuscript-page')].indexOf(p.closest('.manuscript-page')),
          color: getComputedStyle(p).stroke, d: p.getAttribute('d'), width: p.getAttribute('stroke-width') }));
        const result = ManuscriptPrint.prepare(snapshot, writing), paths = inspect();
        writing.pens.forEach(p => p.color = 'red'); ManuscriptPrint.prepare(snapshot, writing);
        const redPaths = inspect(); ManuscriptPrint.clear(); return { result, paths, redPaths };
      });
      assert.ok(new Set(pdf.paths.filter(p => p.id === 2).map(p => p.page)).size > 1, 'colored stroke spans PDF pages');
      for (const p of pdf.paths) assert.equal(p.color, ['rgb(197, 34, 40)', 'rgb(37, 99, 235)', 'rgb(21, 128, 61)'][(p.id - 1) % 3]);
      assert.deepEqual(pdf.paths.map(({ color, ...p }) => p), pdf.redPaths.map(({ color, ...p }) => p), 'color has no effect on PDF geometry');
      const downloadPromise = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
      const download = await downloadPromise, saved = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      assert.equal(saved.version, 4); assert.deepEqual(saved.marks, beforeMove.items);
      const roundTrip = await page.evaluate(saved => ManuscriptMarks.restoreManuscript(JSON.stringify(saved)).markings.items, saved);
      assert.deepEqual(roundTrip, saved.marks);
      await page.waitForFunction(() => document.getElementById('autosave-status').textContent === 'このブラウザに自動保存済み');
      await page.reload(); await page.locator('#library-list .book-open').click();
      assert.deepEqual(await page.evaluate(() => ManuscriptWriting.printSnapshot().items), saved.marks, 'all pen colors survive browser reload');
      assert.deepEqual(errors, []);
      await context.close(); console.log(width + 'px: pen submenu, mouse/touch colors, move/Undo, JSON and PDF passed');
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

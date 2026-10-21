// Pen geometry is rigid across layouts; moving rebases one confirmed stroke.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const output = process.env.READER_TEST_ARTIFACTS || path.join(directory, 'tmp', 'pen-move');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
const shape = points => points.map(p => ({ x: p.x - points[0].x, y: p.y - points[0].y }));
const sameShape = (a, b) => shape(a).forEach((p, i) => { close(p.x, shape(b)[i].x, 'shape x'); close(p.y, shape(b)[i].y, 'shape y'); });
const length = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(6000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const url = `http://127.0.0.1:${server.address().port}/`;
      await page.goto(url); await page.locator('[data-go=read-input]').click();
      const text = '黄昏の空。👩‍👩‍👧‍👦が𠮷\n\n' + Array.from({ length: 100 }, (_, i) => `章${String(i).padStart(3, '0')}：静かな森で今日の出来事をゆっくり語る。\n`).join('');
      const data = { format: 'reading-support-manuscript', version: 4, text, annotations: [{ offset: 2, text: 'そら' }], sourceRubies: [{ start: 0, end: 2, reading: 'たそがれ' }],
        marks: [{ id: 1, type: 'pen', offset: text.indexOf('章001'), layoutKey: '40:1.8:5:0', points: [{ x: 0, y: .6 }, { x: 2, y: .6 }, { x: 2, y: 2.6 }, { x: 4, y: 2.6 }], witnesses: [{ offset: text.indexOf('章001'), x: 0, y: 0 }] },
          { id: 2, type: 'pen', offset: text.indexOf('章025'), layoutKey: '40:1.8:5:0', fontSize: 22, points: [{ x: 3, y: 0 }, { x: 3, y: 90 }, { x: 4, y: 0 }], witnesses: [{ offset: text.indexOf('章025'), x: 0, y: 0 }] },
          { id: 3, type: 'memo', offset: text.indexOf('章010'), dx: .4, dy: .8, tx: .1, ty: .2, color: 'pink', text: '間をとる\n静かに読む' },
          { id: 4, type: 'marker', start: 0, end: 2, color: 'lightblue' }], memoSettings: { fontSize: 16, opacity: .7 } };
      await page.locator('#manuscript-file').setInputFiles({ name: 'pen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden);
      const state = () => page.evaluate(() => ManuscriptWriting.printSnapshot());
      const initial = await state();
      const originalShape = initial.pens.map(p => p.points);
      for (const settings of [{ width: 600 }, { columns: 24 }, { height: 2.5 }, { breaks: 2 }, { width: 900, height: 1.8, breaks: 5 }]) {
        await page.evaluate(s => Reader.configure(s), settings);
        const changed = await state(); assert.deepEqual(changed.items, initial.items, 'layout must not mutate saved data');
        changed.pens.forEach((p, i) => sameShape(p.points, originalShape[i]));
        assert.equal(await page.locator('#writing-pen path[data-mark-id]').count(), 2);
      }
      await page.evaluate(data => { const m = ReadingAnnotations.fromData(data); m.set(0, '長い読み仮名で周囲の配置を変える'); Reader.show(data.text, m); }, data);
      (await state()).pens.forEach((p, i) => sameShape(p.points, originalShape[i]));
      assert.deepEqual((await state()).items, initial.items);
      await page.evaluate(data => Reader.show(data.text, ReadingAnnotations.fromData(data)), data);

      await page.locator('#writing-mode').click(); await page.locator('#confirm-ok').click();
      await page.locator('[data-writing-tool=move]').click();
      const reveal = async () => {
        await page.evaluate(() => { const w = ManuscriptWriting.printSnapshot(), r = document.getElementById('reader').getBoundingClientRect(); scrollBy(0, r.top + w.pens[0].points[0].y - innerHeight * .55); });
        await page.waitForTimeout(150);
        return page.evaluate(() => { const w = ManuscriptWriting.printSnapshot(), r = document.getElementById('reader').getBoundingClientRect(); return { x: r.left + w.pens[0].points[0].x + 10, y: r.top + w.pens[0].points[0].y }; });
      };
      const drag = async (p, dx, dy, touch) => {
        if (touch) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
          for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + dx * i / 6, y: p.y + dy * i / 6 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
        } else {
          await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 }); await page.mouse.up();
        }
      };
      let p = await reveal();
      // Hit 7px away from the thin painted line, without changing its thickness.
      await page.mouse.click(p.x, p.y - 7);
      assert.equal(await page.locator('.pen-selection').count(), 1);
      await page.screenshot({ path: path.join(output, `pen-selection-${width}.png`) });
      const before = await state();
      p = await reveal(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 14, p.y + 35, { steps: 5 });
      const preview = await page.locator('#writing-pen path[data-mark-id="1"]').getAttribute('d');
      await page.mouse.up();
      const moved = await state();
      assert.notDeepEqual(moved.items[0], before.items[0]);
      assert.equal(await page.locator('#writing-pen path[data-mark-id="1"]').getAttribute('d'), preview, 'preview equals committed geometry');
      sameShape(moved.pens[0].points, before.pens[0].points);
      moved.pens[0].points.forEach((point, i) => { close(point.x, before.pens[0].points[i].x + 14, 'move x'); close(point.y, before.pens[0].points[i].y + 35, 'move y'); });
      await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items, before.items, 'one drag, one undo');
      await page.locator('[data-writing-tool=move]').click(); p = await reveal();
      await drag(p, 10, 45, true);
      const touched = await state(); sameShape(touched.pens[0].points, before.pens[0].points); assert.notDeepEqual(touched.items[0], before.items[0]);
      // Cancelled drags cannot alter saved coordinates or add an undo entry.
      p = await reveal(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y + 20);
      await page.keyboard.press('Escape'); await page.mouse.up(); assert.deepEqual((await state()).items, touched.items);
      p = await reveal(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y + 20);
      await page.evaluate(() => document.getElementById('reader-stage').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
      await page.mouse.up(); assert.deepEqual((await state()).items, touched.items);
      await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items, before.items);
      await page.locator('[data-writing-tool=move]').click(); p = await reveal(); await drag(p, 8, 35, width < 600);
      const startOfRepeatedMoves = await state();
      for (let i = 0; i < 3; i++) {
        p = await reveal(); await drag(p, 12, 12, false);
        p = await reveal(); await drag(p, -12, -12, false);
      }
      const final = await state();
      final.pens[0].points.forEach((point, i) => { close(point.x, startOfRepeatedMoves.pens[0].points[i].x, 'no cumulative x drift'); close(point.y, startOfRepeatedMoves.pens[0].points[i].y, 'no cumulative y drift'); });
      p = await reveal(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y + 20);
      await page.evaluate(() => Reader.configure({ height: 2 })); await page.mouse.up();
      assert.deepEqual((await state()).items, final.items, 'layout cancels an in-progress move');
      await page.evaluate(() => Reader.configure({ columns: 36, height: 2.2, breaks: 3 }));
      sameShape((await state()).pens[0].points, final.pens[0].points); assert.deepEqual((await state()).items, final.items);
      const scrollBefore = await page.evaluate(() => scrollY);
      await drag({ x: width - 24, y: 760 }, 0, -160, true); await page.waitForTimeout(300);
      assert.ok(await page.evaluate(y => scrollY > y + 30, scrollBefore), 'scroll off strokes');
      assert.deepEqual((await state()).items, final.items);
      await page.waitForTimeout(1200); // Allow native touch-scroll inertia to end.
      // A newly drawn stroke records the actual font unit, not a layout default.
      await page.locator('[data-writing-tool=pen]').click(); p = await reveal();
      await drag({ x: p.x + 80, y: p.y + 90 }, 20, 15, false);
      const drawn = await state(); assert.equal(drawn.items.at(-1).type, 'pen');
      assert.equal(drawn.items.at(-1).fontSize, await page.evaluate(() => Reader.getWritingGeometry().fontSize));
      await page.locator('#writing-undo').click();

      // Keep the existing confirm/cancel/session mechanics for display settings.
      await page.locator('#operations').click(); await page.locator('#open-settings').click();
      if (width < 600) await page.locator('#tab-line-height').click();
      const originalHeight = await page.locator('#line-height').inputValue();
      const changeHeight = value => page.locator('#line-height').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
      await changeHeight('2.4');
      await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#confirm-message').textContent(), '赤ペンの位置がずれる場合があります。変更後は移動して調整できます。');
      await page.locator('#confirm-cancel').click();
      await page.waitForFunction(value => document.getElementById('line-height').value === value, originalHeight);
      assert.equal(await page.locator('#line-height').inputValue(), originalHeight);
      await changeHeight('2.4'); await page.locator('#confirm-ok').click();
      await changeHeight('2.5'); assert.equal(await page.locator('#confirm-dialog').evaluate(el => el.open), false);
      await page.locator('[data-close=settings-dialog]').click();

      // Real manual save + load, legacy v1-v4 imports, schema rejection.
      const pending = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
      const saved = JSON.parse(fs.readFileSync(await (await pending).path(), 'utf8'));
      assert.equal(saved.version, 4); assert.deepEqual(saved.marks, final.items);
      const restored = await page.evaluate(saved => {
        const { manuscript, markings } = ManuscriptMarks.restoreManuscript(JSON.stringify(saved));
        const roundtrip = JSON.parse(ManuscriptMarks.serializeManuscript(manuscript, markings));
        for (const version of [1, 2, 3, 4]) {
          const legacy = structuredClone(saved); legacy.version = version;
          if (version < 3) legacy.marks = [];
          else { legacy.marks = legacy.marks.filter(m => m.type === 'pen'); legacy.marks.forEach(m => delete m.fontSize); }
          if (version < 2) delete legacy.sourceRubies;
          if (version < 4) delete legacy.memoSettings;
          ManuscriptMarks.restoreManuscript(JSON.stringify(legacy));
        }
        for (const fontSize of [null, 0, -1, 1001, '22']) {
          const bad = structuredClone(saved); bad.marks[0].fontSize = fontSize;
          let rejected = false; try { ManuscriptMarks.restoreManuscript(JSON.stringify(bad)); } catch { rejected = true; }
          if (!rejected) throw Error('invalid pen fontSize accepted');
        }
        Reader.show(saved.text, manuscript); ManuscriptWriting.show(markings); return roundtrip;
      }, saved);
      assert.deepEqual(restored, saved); assert.deepEqual((await state()).items, final.items);

      // The existing line-band splitter must retain the full length of a stroke
      // crossing page boundaries in both directions, with no selection controls.
      await page.evaluate(() => ManuscriptWriting.setMode(true));
      await page.locator('[data-writing-tool=move]').click(); p = await reveal();
      await page.mouse.click(p.x, p.y);
      assert.equal(await page.locator('.pen-selection').count(), 1);
      const printed = await page.evaluate(() => {
        const w = ManuscriptWriting.printSnapshot(), result = ManuscriptPrint.prepare(Reader.printSnapshot(), w);
        return { result, lengths: [...document.querySelectorAll('.manuscript-pens path')].map(el => ({ id: Number(el.dataset.markId), length: el.getTotalLength(), page: [...document.querySelectorAll('.manuscript-page')].indexOf(el.closest('.manuscript-page')) })),
          controls: document.querySelectorAll('#manuscript-print .pen-hit, #manuscript-print .pen-selection').length };
      });
      assert.equal(printed.controls, 0); assert.ok(printed.result.pages > 1);
      for (const pen of (await state()).pens) {
        const fragments = printed.lengths.filter(p => p.id === pen.id);
        assert.ok(fragments.length); assert.ok(Math.abs(fragments.reduce((sum, p) => sum + p.length, 0) / printed.result.scale - length(pen.points)) < .03, 'no vector length lost');
        if (pen.id === 2) assert.ok(new Set(fragments.map(p => p.page)).size > 1, 'cross-page stroke');
      }
      await page.evaluate(() => document.body.classList.add('manuscript-printing'));
      await page.pdf({ path: path.join(output, `pen-move-${width}.pdf`), format: 'A4', printBackground: true });
      await page.evaluate(() => { document.body.classList.remove('manuscript-printing'); ManuscriptPrint.clear(); });
      const missing = await page.evaluate(() => {
        try { const w = ManuscriptWriting.printSnapshot(); w.pens = []; ManuscriptPrint.prepare(Reader.printSnapshot(), w); return ''; } catch (e) { return e.message; }
      }); assert.match(missing, /赤ペン.*PDF/);
      const invalid = await page.evaluate(() => {
        try { const w = ManuscriptWriting.printSnapshot(); w.pens[0].points[0].x = NaN; ManuscriptPrint.prepare(Reader.printSnapshot(), w); return ''; } catch (e) { return e.message; }
      }); assert.match(invalid, /赤ペン.*PDF/);
      await page.evaluate(() => ManuscriptPrint.clear());
      await page.reload(); await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'moved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden);
      assert.deepEqual((await state()).items, saved.marks);
      (await state()).pens.forEach((pen, i) => sameShape(pen.points, final.pens[i].points));
      await page.locator('#measure-current').click();
      assert.deepEqual((await state()).items, saved.marks);
      await page.evaluate(() => { ManuscriptWriting.setMode(true); document.querySelector('[data-writing-tool=move]').click(); });
      assert.equal(await page.evaluate(() => ManuscriptWriting.enabled), false);
      assert.equal(await page.locator('.pen-hit').count(), 0); assert.deepEqual((await state()).items, saved.marks);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: rigid layouts, mouse/touch move, cancel, Undo, scroll, settings guard, v1-v4, vector PDF, read-only`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });

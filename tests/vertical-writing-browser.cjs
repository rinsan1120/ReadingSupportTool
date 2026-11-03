const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew, saveUser, loadUser } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..');
const output = path.join(directory, 'tmp', 'vertical-writing');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const text = '黄昏の空に狐が現れた。👩‍👩‍👧‍👦が𠮷。\r\n\r\n' + '静かな森で間を取り、ゆっくりと読む。\n'.repeat(45);
const legacy = { format: 'reading-support-manuscript', version: 4, text,
  annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 5, end: 6, reading: 'きつね' }],
  marks: [
    { id: 1, type: 'pen', offset: 0, layoutKey: '40:1.8:5:0', points: [{ x: 0, y: .5 }, { x: 2, y: .5 }], witnesses: [{ offset: 0, x: 0, y: 0 }], color: 'blue' },
    { id: 2, type: 'marker', start: 0, end: 100, color: 'lightblue' },
    { id: 3, type: 'memo', offset: 6, dx: .6, dy: 1, tx: 0, ty: 0, color: 'pink', text: 'ゆっくり読む' }
  ], memoSettings: { fontSize: 16, opacity: .9 } };
const items = page => page.evaluate(() => ManuscriptWriting.printSnapshot().items);
const glyph = async (page, offset) => {
  await page.evaluate(offset => {
    const root = document.getElementById('reader'), g = Reader.getWritingGeometry().byOffset.get(offset);
    const y = root.getBoundingClientRect().top + g.y;
    const edge = document.querySelector('.reader-controls').getBoundingClientRect().bottom;
    if (y < edge + 20 || y > innerHeight - 100) scrollBy(0, y - edge - 60);
  }, offset);
  return page.evaluate(offset => {
    const r = document.getElementById('reader').getBoundingClientRect(), g = Reader.getWritingGeometry().byOffset.get(offset);
    return { x: r.left + g.x + g.width / 2, y: r.top + g.y + g.height / 2 };
  }, offset);
};
const switchDirection = async (page, value) => {
  await page.locator('#toolbar-settings').click();
  await page.locator('#writing-direction').selectOption(value);
  await page.locator('[data-close=settings-dialog]').click();
  assert.equal(await page.evaluate(() => Reader.direction), value);
};
const modelTests = page => page.evaluate(() => {
  const m = new ManuscriptMarks('本文です');
  const pen = { type: 'pen', direction: 'horizontal' };
  m.add(pen); m.direction = 'vertical'; m.add({ ...pen, direction: 'vertical' });
  m.direction = 'horizontal'; m.undo();
  if (m.items.length !== 1 || m.items[0].direction !== 'vertical') throw Error('Undo altered opposite pen');
  m.direction = 'vertical'; m.undo(); if (m.items.length) throw Error('Vertical undo failed');
  m.add({ type: 'memo', offset: 0, text: 'memo', color: 'yellow', dx: 1, dy: 2, tx: 0, ty: 0 });
  m.direction = 'horizontal'; m.updateMemo(3, { dx: 4 });
  m.direction = 'vertical'; m.updateMemo(3, { verticalPosition: { dx: -2, dy: 3, tx: 0, ty: 0 } });
  m.direction = 'horizontal'; m.undo();
  if (m.items[0].dx !== 1 || m.items[0].verticalPosition.dx !== -2) throw Error('Memo undo mixed placements');
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(10000);
      const url = `http://127.0.0.1:${server.address().port}/`;
      await page.goto(url); await startNew(page); await modelTests(page);
      await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
      await page.locator('#reader').waitFor();
      assert.equal(await page.evaluate(() => Reader.direction), 'horizontal');
      const initial = await items(page);
      await switchDirection(page, 'vertical');
      assert.deepEqual(await items(page), initial, 'switch must not mutate marks');
      assert.equal(await page.locator('#writing-pen path[data-mark-id]').count(), 0);
      const layout = await page.evaluate(() => {
        const r = document.getElementById('reader'), g = Reader.getWritingGeometry().glyphs;
        const clone = r.cloneNode(true); clone.querySelectorAll('rt,.reading-annotation').forEach(el => el.remove());
        return { text: clone.textContent, count: g.length, right: g[0].x, second: g[1], first: g[0],
          width: r.clientWidth, outside: g.filter(p => p.x < -1 || p.x + p.width > r.clientWidth + 2),
          pages: r.querySelectorAll('.vertical-page').length, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.text, text); assert.ok(layout.pages > 1); assert.equal(layout.overflow, false);
      assert.equal(layout.outside.length, 0, JSON.stringify(layout.outside.slice(0, 4)));
      assert.ok(layout.second.y > layout.first.y, 'characters run down');
      assert.ok(await page.locator('#writing-markers rect').count() > 3, 'markers track multiple columns');
      const cdp = width < 600 ? await context.newCDPSession(page) : null;
      const drag = async (from, to) => {
        if (cdp) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
          for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up(); }
      };
      const tap = p => cdp ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y);
      await page.locator('#writing-mode').click();
      await page.locator('[data-writing-tool=ruby]').click();
      await tap(await glyph(page, 0));
      await page.locator('#ruby-input').fill('はじめ'); await page.locator('#ruby-save').click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => !document.getElementById('ruby-dialog').open && !document.getElementById('confirm-dialog').open && !document.querySelector('.annotation-draft'));
      const addedReading = page.locator('.reading-annotation[data-offset="1"],.reading-annotation[data-offset="0"]').first();
      await addedReading.click(); await page.locator('#ruby-input').fill('編集した読み');
      await page.locator('#ruby-save').click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => !document.getElementById('ruby-dialog').open && !document.getElementById('confirm-dialog').open && !document.querySelector('.annotation-draft'));
      assert.ok((await page.locator('.reading-annotation').allTextContents()).some(t => t.includes('編集した読み')));
      await addedReading.click(); await page.locator('#ruby-delete').click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => !document.getElementById('ruby-dialog').open && !document.getElementById('confirm-dialog').open && !document.querySelector('.annotation-draft'));
      assert.deepEqual([...new Set(await page.locator('.reading-annotation').allTextContents())].join(''), '【たそがれ】'); assert.equal(await page.locator('#reader rt').textContent(), 'きつね');
      await page.locator('[data-writing-tool=pen]').click();
      // Memo create/edit/delete share content while retaining separate positions.
      await page.locator('[data-writing-tool=memo]').click();
      await tap(await glyph(page, 0));
      await page.locator('#writing-memo-input').fill('縦書きのメモ'); await page.locator('#writing-memo-save').click();
      const createdMemo = (await items(page)).find(i => i.type === 'memo' && i.id !== 3); assert.ok(createdMemo.verticalPosition);
      const createdBody = page.locator(`.writing-memo[data-mark-id="${createdMemo.id}"] .memo-body`);
      await createdBody.click(); await createdBody.click();
      await page.locator('#writing-memo-input').fill('編集済みメモ'); await page.locator('#writing-memo-save').click();
      assert.equal((await items(page)).find(i => i.id === createdMemo.id).text, '編集済みメモ');
      await createdBody.click(); page.once('dialog', dialog => dialog.accept());
      await page.locator(`.writing-memo[data-mark-id="${createdMemo.id}"] .memo-remove`).click();
      assert.ok(!(await items(page)).some(i => i.id === createdMemo.id));
      await page.locator('[data-writing-tool=pen]').click();
      const p = await glyph(page, 0); await drag({ x: p.x - 5, y: p.y }, { x: p.x - 5, y: p.y + 40 });
      assert.equal((await items(page)).filter(i => i.type === 'pen').length, 2);
      const verticalPen = (await items(page)).find(i => i.type === 'pen' && i.direction === 'vertical'); assert.ok(verticalPen);
      await page.locator('[data-writing-tool=move]').click();
      await drag({ x: p.x - 5, y: p.y + 10 }, { x: p.x - 20, y: p.y + 20 });
      assert.notDeepEqual((await items(page)).find(i => i.id === verticalPen.id), verticalPen);
      await page.locator('#writing-undo').click();
      assert.deepEqual((await items(page)).find(i => i.id === verticalPen.id), verticalPen);
      await page.locator('[data-writing-tool=memo]').click();
      const note = page.locator('.writing-memo .memo-body').first();
      await note.evaluate(el => scrollBy(0, el.getBoundingClientRect().top - document.querySelector('.reader-controls').getBoundingClientRect().bottom - 80));
      const box = await note.boundingBox();
      await drag({ x: box.x + 40, y: box.y + 15 }, { x: box.x + 30, y: box.y + 55 });
      const positioned = (await items(page)).find(i => i.id === 3);
      assert.ok(positioned.verticalPosition); assert.equal(positioned.dx, initial.find(i => i.id === 3).dx);
      await page.locator('[data-writing-tool=marker]').click();
      await page.locator('[data-marker-color=pink]').click();
      const a = await glyph(page, 0), b = await glyph(page, 5); await drag(a, b);
      assert.ok((await items(page)).some(i => i.type === 'marker' && i.color === 'pink'));
      await page.locator('#writing-undo').click();
      await page.locator('[data-writing-tool=eraser]').click();
      const eraseAt = await glyph(page, 0);
      await tap({ x: eraseAt.x - 5, y: eraseAt.y + 20 });
      assert.ok(!(await items(page)).some(i => i.id === verticalPen.id));
      assert.ok((await items(page)).some(i => i.id === 1));
      await page.locator('#writing-undo').click();
      await page.locator('#writing-mode').click();
      const stored = await items(page);
      for (const settings of [{ columns: 12, height: 2.5, breaks: 2 }, { columns: 40, height: 1.4, breaks: 0 }]) {
        await page.evaluate(s => Reader.configure(s), settings);
        assert.deepEqual(await items(page), stored);
        assert.equal(await page.evaluate(() => {
          const r = document.getElementById('reader'); return Reader.getWritingGeometry().glyphs.some(g => g.x < -1 || g.x + g.width > r.clientWidth + 2);
        }), false, 'large/small type must fit the vertical sections');
      }
      await page.evaluate(() => { Reader.configure({ columns: document.getElementById('reader').clientWidth / 22, height: 1.8, breaks: 5 }); });
      await glyph(page, 200);
      const anchor = await page.evaluate(() => Reader.capture());
      await switchDirection(page, 'horizontal');
      const nearby = await page.evaluate(offset => { const r = document.getElementById('reader').getBoundingClientRect(), g = Reader.getWritingGeometry().byOffset.get(offset); return r.top + g.y; }, anchor.offset);
      assert.ok(nearby >= 0 && nearby <= 900, 'switch retains the visible source position');
      await switchDirection(page, 'vertical');
      for (let i = 0; i < 3; i++) { await switchDirection(page, 'horizontal'); await switchDirection(page, 'vertical'); }
      assert.deepEqual(await items(page), stored);
      await page.screenshot({ path: path.join(output, `vertical-${width}.png`) });
      await page.locator('#export-pdf').click();
      await page.waitForFunction(() => document.getElementById('pdf-dialog').open);
      assert.equal(await page.locator('#pdf-dialog').evaluate(el => el.open), true, await page.locator('#notice').textContent());
      assert.equal(await page.evaluate(() => Reader.direction), 'vertical');
      assert.deepEqual(await items(page), stored);
      const pdf = await page.evaluate(() => ({ pages: document.querySelectorAll('.manuscript-page').length,
        blue: document.querySelectorAll('.manuscript-pens path[data-color=blue]').length,
        red: document.querySelectorAll('.manuscript-pens path[data-color=red]').length }));
      assert.ok(pdf.pages > 0 && pdf.red > 0, JSON.stringify(pdf)); assert.equal(pdf.blue, 0);
      await page.locator('#pdf-cancel').click();
      const saved = await saveUser(page);
      const manuscript = saved.manuscripts.find(m => m.id === saved.activeId).manuscript;
      assert.equal(manuscript.version, 5); assert.equal(manuscript.writingDirection, 'vertical');
      assert.deepEqual(manuscript.marks, stored); assert.equal(manuscript.text, text);
      await page.locator('#measure-current').click();
      assert.equal(await page.evaluate(() => Reader.direction), 'vertical');
      assert.equal(await page.locator('#writing-mode').isVisible(), false);
      assert.deepEqual(await items(page), stored);
      const before = await items(page), q = await glyph(page, 0); await drag(q, { x: q.x - 20, y: q.y + 30 }); assert.deepEqual(await items(page), before);
      await page.reload(); await startNew(page); await page.locator('[data-go=read-input]').click(); await page.locator('#open-read').click();
      assert.equal(await page.evaluate(() => Reader.direction), 'vertical'); assert.deepEqual(await items(page), stored);
      // A fresh browser restores the same extended data through the public file loader.
      const fresh = await browser.newContext({ viewport: { width, height: 900 } }); const restored = await fresh.newPage();
      await restored.goto(url); await loadUser(restored, saved);
      await restored.locator('[data-go=read-input]').click(); await restored.locator('#open-read').click();
      assert.equal(await restored.evaluate(() => Reader.direction), 'vertical'); assert.deepEqual(await items(restored), stored);
      await fresh.close(); assert.deepEqual(errors, []); await context.close();
      console.log(`vertical writing ${width}px: layout, touch, independent pens/memos, Undo, PDF, storage, file, measurement passed`);
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

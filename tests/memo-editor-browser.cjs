// Unified memo workflow and legacy display compatibility.
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
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const text = '本文を読みます。次の文です。\n'.repeat(60);
      const old = { id: 1, type: 'memo', offset: 100, dx: .6, dy: 1, tx: .2, ty: .3, color: 'yellow', text: '旧メモ', verticalPosition: { dx: -3, dy: 1, tx: .1, ty: .2 } };
      const direct = { ...old, id: 2, offset: 200, style: 'direct', fontSize: 28.5, color: 'pink', text: '旧追記' };
      const fixture = { format: 'reading-support-manuscript', version: 6, text, annotations: [], sourceRubies: [], marks: [old, direct], memoSettings: { fontSize: 22.5, opacity: .9 } };
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page);
      await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
      await page.locator('#reader').waitFor();
      await page.locator('#notice').waitFor({ state: 'hidden' });
      const state = () => page.evaluate(() => JSON.parse(JSON.stringify(ManuscriptWriting.printSnapshot())));
      const oldNote = page.locator('.writing-memo[data-mark-id="1"]');
      assert.equal(await oldNote.evaluate(el => getComputedStyle(el).fontSize), '22.5px');
      assert.deepEqual((await state()).items, fixture.marks);
      await page.locator('#writing-mode').click(); await page.locator('[data-writing-tool=memo]').click();
      const tapText = async locator => { await locator.scrollIntoViewIfNeeded(); await locator.tap(); };
      await tapText(oldNote.locator('.memo-body'));
      assert.equal(await page.locator('.memo-edit').count(), 1);
      const toolbarHeight = await page.locator('#writing-toolbar').evaluate(el => el.offsetHeight);
      assert.equal(await page.locator('#marker-colors').isVisible(), false);
      if (process.env.READER_TEST_ARTIFACTS) { fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `memo-actions-${width}.png`) }); }
      await page.locator('.memo-edit').click();
      if (process.env.READER_TEST_ARTIFACTS) await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `memo-dialog-${width}.png`) });
      assert.equal(await page.locator('#writing-memo-font-size').inputValue(), '22.5');
      await page.locator('#writing-memo-font-size').fill('31'); await page.locator('[data-memo-color=lightblue]').click();
      await page.locator('#writing-memo-cancel').click(); assert.deepEqual((await state()).items, fixture.marks);
      await page.locator('.memo-edit').click(); await page.locator('#writing-memo-save').click();
      assert.deepEqual((await state()).items[0], { ...old, fontSize: 22.5 });
      await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items, fixture.marks);
      await tapText(oldNote.locator('.memo-body')); await page.locator('.memo-edit').click();
      await page.locator('#writing-memo-input').fill('編集したメモ'); await page.locator('#writing-memo-font-size').fill('26');
      await page.locator('[data-memo-color=lightblue]').click(); await page.locator('#writing-memo-save').click();
      assert.deepEqual((await state()).items[0], { ...old, text: '編集したメモ', fontSize: 26, color: 'lightblue' });
      assert.deepEqual((await state()).items[1], direct, 'other memo untouched');
      const create = async () => {
        // Place within a visible source glyph, avoiding sticky controls and existing notes.
        await page.locator('#reader').evaluate(el => el.scrollIntoView({ block: 'end' }));
        const point = await glyphPoint(page, text.length - 10); await page.mouse.click(point.x, point.y);
        await page.locator('#writing-memo-dialog').waitFor();
      };
      await create();
      assert.equal(await page.locator('#writing-memo-font-size').inputValue(), '26');
      assert.equal(await page.locator('[data-memo-color=lightblue]').getAttribute('aria-pressed'), 'true');
      await page.locator('#memo-style-direct').click(); await page.locator('#writing-memo-font-size').fill('34');
      await page.locator('[data-memo-color=pink]').click(); await page.locator('#writing-memo-cancel').click();
      await create(); assert.equal(await page.locator('#memo-style-bubble').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#writing-memo-font-size').inputValue(), '26');
      await page.locator('#memo-style-direct').click(); assert.equal(await page.locator('#writing-memo-font-size').inputValue(), '22.5');
      await page.locator('#writing-memo-font-size').fill('34'); await page.locator('[data-memo-color=pink]').click();
      await page.locator('#writing-memo-input').fill('新しい追記'); await page.locator('#writing-memo-save').click();
      await create(); assert.equal(await page.locator('#writing-memo-font-size').inputValue(), '34');
      await page.locator('#memo-style-bubble').click(); assert.equal(await page.locator('#writing-memo-font-size').inputValue(), '26');
      await page.locator('#writing-memo-input').fill('新しい吹き出し'); await page.locator('#writing-memo-save').click();
      await tapText(oldNote.locator('.memo-body'));
      assert.equal(await page.locator('#writing-toolbar').evaluate(el => el.offsetHeight), toolbarHeight);
      const actions = await page.locator('.memo-actions').boundingBox(); assert.ok(actions.x >= 0 && actions.x + actions.width <= width);
      for (const button of await page.locator('.memo-actions button').all()) assert.ok((await button.boundingBox()).height >= 44);
      const drag = async locator => {
        await locator.evaluate(el => { const r = el.getBoundingClientRect(), edge = document.querySelector('.reader-controls').getBoundingClientRect().bottom; if (r.top < edge + 24) scrollBy(0, r.top - edge - 24); });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const box = await locator.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
        if (width < 600) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 10 * step / 6, y: y + 35 * step / 6 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
        } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 10, y + 35, { steps: 6 }); await page.mouse.up(); }
      };
      const beforeDrag = (await state()).items;
      await drag(oldNote.locator('.memo-body')); assert.notDeepEqual((await state()).items, beforeDrag);
      await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items, beforeDrag);
      await tapText(oldNote.locator('.memo-body'));
      await drag(oldNote.locator('.memo-tip'));
      assert.notDeepEqual((await state()).items, beforeDrag); await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items, beforeDrag);
      await tapText(oldNote.locator('.memo-body')); page.once('dialog', d => d.dismiss()); await page.locator('.memo-remove').click();
      assert.deepEqual((await state()).items, beforeDrag);
      page.once('dialog', d => d.accept()); await page.locator('.memo-remove').click(); assert.equal((await state()).items.length, 3);
      await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items, beforeDrag);
      await page.locator('#writing-off').click(); await page.locator('#toolbar-settings').click();
      await page.locator('#memo-opacity').fill('0.6');
      assert.equal((await state()).memoSettings.opacity, .6); assert.equal((await state()).memoSettings.fontSize, 22.5);
      for (const note of await page.locator('#writing-memos .writing-memo').all()) assert.equal(await note.evaluate(el => getComputedStyle(el).opacity), '0.6');
      await page.locator('[data-close=settings-dialog]').click();
      const snapshot = await saved(page); assert.deepEqual(snapshot.marks, (await state()).items); assert.equal(snapshot.text, text);
      await page.locator('#export-pdf').click(); await page.waitForFunction(() => document.getElementById('pdf-dialog').open);
      const print = await page.evaluate(() => [...document.querySelectorAll('#manuscript-print .writing-memo')].map(el => ({ id: +el.dataset.markId, size: parseFloat(getComputedStyle(el).fontSize), scale: +getComputedStyle(el.parentElement).getPropertyValue('--memo-print-scale'), opacity: getComputedStyle(el).opacity })));
      for (const memo of snapshot.marks) {
        const rendered = print.find(el => el.id === memo.id); assert.ok(rendered); assert.ok(Math.abs(rendered.size - (memo.fontSize ?? 22.5) * rendered.scale) < .02); assert.equal(rendered.opacity, '0.6');
      }
      await page.locator('#pdf-cancel').click();
      // Browser autosave retains individual sizes and compatibility settings.
      await page.waitForTimeout(700); await page.reload();
      await startNew(page); await page.locator('#library-list .book-open').click();
      await page.locator('#reader').waitFor();
      assert.deepEqual((await state()).items, snapshot.marks); assert.deepEqual((await state()).memoSettings, snapshot.memoSettings);
      const output = process.env.READER_TEST_ARTIFACTS;
      if (output) { fs.mkdirSync(output, { recursive: true }); await page.screenshot({ path: path.join(output, `memo-reader-${width}.png`) }); }
      assert.deepEqual(errors, []); console.log(`PASS ${width}: legacy, per-memo edit, defaults/cancel, actions, drag/tip/undo, opacity, PDF, autosave`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

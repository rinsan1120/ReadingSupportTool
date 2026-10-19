// Three-colour UI/JSON/PDF and independently retained, read-only timing marks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..'), output = path.join(directory, 'tmp/pdfs');
const files = ['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'app.js'];
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!files.includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const choose = (page, data) => page.locator('#manuscript-file').setInputFiles({ name: 'markings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
const complete = page => page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
const save = async page => {
  await page.locator('#operations').click(); const pending = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
  return JSON.parse(fs.readFileSync(await (await pending).path(), 'utf8'));
};
const writing = async page => { await page.locator('#operations').click(); await page.locator('#writing-mode').click(); };
const home = async page => { await page.locator('#operations').click(); await page.locator('#home-from-menu').click(); };
const draft = (page, text) => page.locator('#time-text').evaluate((el, text) => { el.value = text; el.dispatchEvent(new Event('input')); }, text);
const current = page => page.evaluate(() => window.ManuscriptWriting.printSnapshot());
const point = async (page, offset) => {
  const get = () => page.evaluate(offset => {
    const root = document.getElementById('reader').getBoundingClientRect(), g = window.Reader.getWritingGeometry().byOffset.get(offset);
    return { x: root.left + g.x + g.width / 2, y: root.top + g.y + g.height / 2 };
  }, offset);
  const p = await get(); await page.evaluate(y => {
    const edge = document.querySelector('.reader-controls').getBoundingClientRect().bottom;
    if (y < edge + 30 || y > innerHeight - 90) scrollBy(0, y - edge - 80);
  }, p.y); return get();
};
const readonly = async (page, expected) => {
  await page.waitForFunction(() => !document.getElementById('reading').hidden && document.getElementById('reading-title').textContent === '朗読速度の計測');
  assert.deepEqual((await current(page)).items, expected);
  assert.equal(await page.locator('#writing-toolbar').isVisible(), false);
  assert.equal(await page.locator('#writing-mode').isVisible(), false);
  assert.equal(await page.locator('.writing-memo').evaluate(el => el.tagName), 'DIV');
  assert.equal(await page.locator('.writing-memo small').count(), 0);
  assert.equal(await page.locator('.writing-memo').textContent(), expected.find(m => m.type === 'memo').text);
  await page.evaluate(() => {
    window.ManuscriptWriting.setMode(true);
    for (const id of ['writing-undo', 'writing-memo-delete']) document.getElementById(id).onclick();
    document.querySelector('[data-writing-tool=marker]').click(); document.querySelector('[data-marker-color=yellow]').click();
    document.querySelector('.writing-memo').click();
    document.getElementById('writing-memo-input').value = '編集してはいけない';
    document.getElementById('writing-memo-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(await page.evaluate(() => window.ManuscriptWriting.enabled), false);
  assert.equal(await page.locator('#writing-memo-dialog').evaluate(el => el.open), false);
  assert.equal(await page.locator('#reader-stage').evaluate(el => el.classList.contains('writing-drag')), false);
  assert.deepEqual((await current(page)).items, expected, 'handlers themselves enforce read-only');
};
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
      const url = `http://127.0.0.1:${server.address().port}/`; await page.goto(url);
      const text = '黄昏に狐が現れた。\r\n\r\n👩‍👩‍👧‍👦とが。\n' + Array.from({ length: 36 }, (_, i) => `章${String(i).padStart(3, '0')}：風の音を聞いて、静かに今日のことを語る。\n`).join('');
      const data = { format: 'reading-support-manuscript', version: 3, text, annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 3, end: 4, reading: 'きつね' }],
        marks: [{ id: 1, type: 'marker', start: 0, end: 2 }, { id: 2, type: 'memo', offset: 3, dx: .4, dy: 0, text: '<b>少し大</b>' }] };
      await page.locator('[data-go=read-input]').click(); await choose(page, data); await complete(page);
      assert.equal(await page.locator('.writing-memo').textContent(), '<b>少し大</b>'); assert.equal(await page.locator('.writing-memo b, .writing-memo small').count(), 0);
      assert.equal(await page.locator('#writing-markers rect').first().getAttribute('data-color'), 'yellow');
      await writing(page); assert.equal(await page.locator('#marker-colors').isVisible(), false);
      const p = await point(page, 3); await page.mouse.move(p.x - 5, p.y - 5); await page.mouse.down(); await page.mouse.move(p.x + 5, p.y + 5, { steps: 5 }); await page.mouse.up();
      await page.locator('[data-writing-tool=marker]').click(); assert.equal(await page.locator('#marker-colors').isVisible(), true);
      for (const [i, color] of ['yellow', 'lightblue', 'pink'].entries()) {
        await page.locator(`[data-marker-color=${color}]`).click();
        assert.equal(await page.locator(`[data-marker-color=${color}]`).getAttribute('aria-pressed'), 'true');
        const offset = text.indexOf(`章00${i}`), start = await point(page, offset + 3), end = await point(page, offset);
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
        const fit = await page.locator('#writing-toolbar').evaluate(el => el.scrollWidth <= el.clientWidth); assert.ok(fit, 'palette fits narrow toolbar');
      }
      const saved = await save(page); assert.equal(saved.version, 3);
      assert.deepEqual(saved.marks.filter(m => m.type === 'marker').map(m => m.color), [undefined, 'yellow', 'lightblue', 'pink']);
      await page.locator('[data-writing-tool=eraser]').click(); assert.equal(await page.locator('#marker-colors').isVisible(), false);
      const blue = await point(page, text.indexOf('章001')); await page.mouse.click(blue.x, blue.y);
      assert.equal((await current(page)).items.some(m => m.type === 'marker' && m.color === 'lightblue'), false);
      await page.locator('#writing-undo').click(); assert.deepEqual(await save(page), saved, 'erase/undo restores the individual marker colour');
      // Unsupported colours reject the entire file, leaving the current model.
      await page.locator('#reader-back').click();
      for (const color of [null, 'red', 'Yellow', '', 42, false, {}, []]) {
        await choose(page, { ...saved, marks: [...saved.marks, { id: 999, type: 'marker', start: 0, end: 1, color }] }); await complete(page);
        assert.match(await page.locator('#notice').textContent(), /マーカーの色/); assert.equal(await page.locator('#confirm-dialog').evaluate(el => el.open), false);
      }
      await page.locator('#open-read').click(); assert.deepEqual(await save(page), saved);
      await page.reload(); await page.locator('[data-go=read-input]').click(); await choose(page, saved); await complete(page);
      assert.deepEqual(await save(page), saved, 'v3 round trips both legacy yellow and explicit colours');
      await writing(page); await page.locator('[data-writing-tool=marker]').click(); await page.locator('[data-marker-color=pink]').click();
      const family = await point(page, text.indexOf('👩')); await page.mouse.click(family.x, family.y);
      const full = await save(page), before = await current(page); assert.equal(await page.locator('#writing-undo').isDisabled(), false);
      // Independent PDF layout contains text-only memos and three marker colours.
      await page.locator('#operations').click(); await page.locator('#export-pdf').click(); await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
      assert.deepEqual(await page.locator('.manuscript-memo').allTextContents(), ['<b>少し大</b>']); assert.equal(await page.locator('.manuscript-memo small, .manuscript-memo b').count(), 0);
      const colors = await page.locator('.manuscript-markers rect').evaluateAll(els => Object.fromEntries(els.map(el => [el.dataset.color, getComputedStyle(el).fill])));
      assert.deepEqual(colors, { yellow: 'rgb(255, 229, 136)', lightblue: 'rgb(189, 233, 250)', pink: 'rgb(255, 208, 223)' });
      await page.locator('#pdf-cancel').click(); assert.deepEqual(await current(page), before);
      await page.locator('#operations').click(); await page.locator('#export-pdf').click(); await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
      await page.evaluate(() => { window.print = () => {}; }); await page.locator('#pdf-print').click(); await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(output, `marking-features-${width}.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.deepEqual(await current(page), before);
      // A different existing timing draft requires confirmation; cancel is inert.
      await draft(page, '計測側の別原稿'); await page.locator('#operations').click(); await page.locator('#measure-current').click(); await page.locator('#confirm-cancel').click();
      await page.locator('#operation-dialog').waitFor({ state: 'visible' }); assert.deepEqual(await current(page), before);
      await page.locator('#measure-current').click(); await page.locator('#confirm-ok').click(); await readonly(page, full.marks);
      assert.deepEqual((await current(page)).pens, before.pens); assert.equal(await page.locator('#time-text').inputValue(), text.replace(/\r\n?/g, '\n'));
      assert.equal(await page.locator('#preparation-target').inputValue(), String(await page.evaluate(text => window.countReadingCharacters(text), text)));
      if (width < 600) {
        await page.evaluate(() => scrollTo(0, 0)); const cdp = await context.newCDPSession(page);
        const note = await page.locator('.writing-memo').boundingBox(), y = Math.min(740, Math.max(450, note.y + 10));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: note.x + 10, y }] });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: note.x + 10, y: y - i * 20 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.ok(await page.evaluate(() => scrollY) > 20, 'read-only notes do not block touch scrolling');
      }
      await page.locator('#start').click(); assert.equal(await page.locator('#countdown').textContent(), '3'); await readonly(page, full.marks);
      await page.waitForFunction(() => document.getElementById('countdown').textContent === '2'); await readonly(page, full.marks);
      await page.waitForFunction(() => document.getElementById('countdown').hidden && !document.getElementById('finish').disabled); await readonly(page, full.marks);
      await page.locator('#finish').click(); await page.locator('#results').waitFor({ state: 'visible' });
      const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reading-support-results-v1')));
      assert.equal(stored.history[0].characters, await page.evaluate(text => window.countReadingCharacters(text), text)); assert.equal(stored.history[0].type, 'custom');
      assert.deepEqual(Object.keys(stored.history[0]).sort(), ['characters', 'seconds', 'type']);
      await page.locator('#again').click(); await page.locator('#prepare-time').click(); await readonly(page, full.marks);
      await page.locator('#reader-back').click(); await page.locator('[name=source][value=sample]').check(); await page.locator('#prepare-time').click();
      assert.deepEqual((await current(page)).items, []);
      await page.locator('#reader-back').click(); await page.locator('[name=source][value=custom]').check(); await page.locator('#prepare-time').click(); await readonly(page, full.marks);
      // Reading-side undo/memo changes cannot mutate the timing snapshot.
      await home(page); await page.locator('[data-go=read-input]').click(); await page.locator('#open-read').click(); assert.deepEqual(await save(page), full);
      await writing(page); await page.locator('#writing-undo').click();
      assert.deepEqual((await current(page)).items, full.marks.slice(0, -1), 'original undo stack survives handoff/results');
      await page.locator('[data-writing-tool=memo]').click(); await page.locator('.writing-memo').click(); await page.locator('#writing-memo-input').fill('読み側だけ編集'); await page.locator('#writing-memo-save').click();
      const readChanged = await save(page);
      await home(page); await page.locator('[data-go=time-input]').click(); await page.locator('#prepare-time').click(); await readonly(page, full.marks);
      await page.locator('#reader-back').click(); await draft(page, text + '変更'); await page.locator('#prepare-time').click();
      assert.match(await page.locator('#confirm-message').textContent(), /書き込み/); await page.locator('#confirm-cancel').click();
      await draft(page, text); await page.locator('#prepare-time').click(); await readonly(page, full.marks);
      await page.locator('#reader-back').click(); await draft(page, text + '変更'); await page.locator('#prepare-time').click(); await page.locator('#confirm-ok').click();
      await page.locator('#reading').waitFor({ state: 'visible' });
      assert.deepEqual((await current(page)).items, []); assert.equal(await page.locator('#reader rt, #reader .reading-annotation').count(), 0);
      await home(page); await page.locator('[data-go=read-input]').click(); await page.locator('#open-read').click(); assert.deepEqual(await save(page), readChanged);
      // The protection also applies when there are marks but NO readings.
      const marksOnly = { ...full, annotations: [], sourceRubies: [], marks: full.marks.filter(m => m.type !== 'pen') };
      await page.locator('#reader-back').click(); await choose(page, marksOnly); await page.locator('#confirm-ok').click(); await complete(page);
      await page.locator('#operations').click(); await page.locator('#measure-current').click(); await page.locator('#confirm-ok').click(); await readonly(page, marksOnly.marks);
      await page.locator('#reader-back').click();
      const originalInput = await page.locator('#time-text').inputValue();
      const pasteRuby = whole => page.locator('#time-text').evaluate((el, whole) => {
        el.focus(); el.setSelectionRange(0, whole ? el.value.length : 0);
        const data = new DataTransfer(); data.setData('text/html', '<ruby>森<rt>もり</rt></ruby>');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, whole);
      await pasteRuby(false); assert.match(await page.locator('#notice').textContent(), /途中にはHTMLルビを貼り付けできません/);
      assert.equal(await page.locator('#time-text').inputValue(), originalInput);
      await pasteRuby(true); await page.locator('#confirm-dialog').waitFor({ state: 'visible' }); assert.match(await page.locator('#confirm-message').textContent(), /書き込み/);
      await page.locator('#confirm-cancel').click(); assert.equal(await page.locator('#time-text').inputValue(), originalInput);
      await draft(page, text + '再変更'); await page.locator('#prepare-time').click(); await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
      await page.locator('#confirm-cancel').click(); await draft(page, text); await page.locator('#prepare-time').click(); await readonly(page, marksOnly.marks);
      assert.deepEqual(errors, []); assert.equal(requests.filter(r => !r.startsWith(url)).length, 0);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
      console.log(`PASS ${width}px: 3 colours, legacy/invalid JSON, text-only memos/PDF, independent timing/results, read-only handlers/touch, sample and replacement protection`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

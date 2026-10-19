// Run with Playwright available on NODE_PATH and Chrome installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'app.js'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const manuscript = (text, annotations = []) => ({ format: 'reading-support-manuscript', version: 1, text, annotations });

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600, acceptDownloads: true });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      // A pre-existing timing result must survive every manuscript operation.
      const results = JSON.stringify({ version: 1, history: [{ characters: 200, seconds: 30, type: 'custom' }], target: 4000 });
      await page.evaluate(value => sessionStorage.setItem('reading-support-results-v1', value), results);
      await page.reload();
      await page.locator('[data-go="read-input"]').click();
      const storage = () => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      const beforeStorage = await storage(), initialRequests = requests.length;
      if (process.env.READER_TEST_ARTIFACTS) {
        fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
        await page.locator('#import-manuscript').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `manuscript-input-${width}.png`) });
      }
      const source = '\r\n黄昏の空を見上げた。\r\n \t\r\n👩‍👩‍👧‍👦、か\u3099、𠮷【元の括弧】。\r原文<img src=x onerror=alert(1)>\n' + '日本語の本文と句読点。'.repeat(70) + '\r\n\r\n';
      const annotations = [
        { offset: 0, text: '先頭' }, { offset: 4, text: 'たそがれ' },
        { offset: source.indexOf(' \t') + 1, text: '空行の中' },
        { offset: source.indexOf('👩') + '👩‍👩‍👧‍👦'.length, text: ' <b>かぞく</b> ' },
        { offset: source.indexOf('か\u3099') + 2, text: 'が' },
        { offset: source.length, text: '末尾' }
      ];
      const original = manuscript(source, annotations);
      const choose = async (data, raw = false) => {
        const chooserPromise = page.waitForEvent('filechooser');
        await page.locator('#import-manuscript').click();
        const chooser = await chooserPromise;
        await chooser.setFiles({ name: 'manuscript.json', mimeType: 'application/json', buffer: Buffer.isBuffer(data) ? data : Buffer.from(raw ? data : JSON.stringify(data), 'utf8') });
      };
      const complete = () => page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
      let capturedMenu = false;
      const save = async () => {
        const n = requests.length;
        await page.locator('#operations').click();
        if (process.env.READER_TEST_ARTIFACTS && !capturedMenu) {
          await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `manuscript-menu-${width}.png`) });
          capturedMenu = true;
        }
        const promise = page.waitForEvent('download');
        await page.locator('#export-manuscript').click();
        const download = await promise;
        assert.equal(download.suggestedFilename(), 'reading-manuscript.json');
        const content = fs.readFileSync(await download.path(), 'utf8');
        assert.equal(requests.length, n, 'export performs no HTTP request');
        return JSON.parse(content);
      };
      const renderedSource = () => page.locator('#reader').evaluate(root => {
        const copy = root.cloneNode(true); copy.querySelectorAll('.reading-annotation').forEach(n => n.remove()); return copy.textContent;
      });
      const readings = () => page.locator('.reading-annotation').evaluateAll(nodes => {
        const values = {};
        nodes.forEach(n => values[n.dataset.offset] = (values[n.dataset.offset] || '') + n.textContent);
        return values;
      });
      await choose(original); await complete();
      assert.equal(await page.locator('#reading').isVisible(), true);
      assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'false');
      assert.equal(await renderedSource(), source);
      assert.equal(await page.locator('#read-text').inputValue(), source.replace(/\r\n?/g, '\n'));
      assert.equal(await page.locator('#read-count').textContent(), `${await page.evaluate(text => window.countReadingCharacters(text), source)}文字`);
      assert.deepEqual(await readings(), Object.fromEntries(annotations.map(a => [a.offset, `【${a.text}】`])));
      assert.equal(await page.locator('#reader img, #reader b').count(), 0, 'imported strings stay text');
      assert.equal(await page.locator('.reading-annotation').first().evaluate(el => getComputedStyle(el).color), 'rgb(252, 213, 138)');
      assert.deepEqual(await save(), { ...original, version: 3, sourceRubies: [], marks: [] });
      // Reopening through the textarea must not normalize the model's CRLF or CR.
      await page.locator('#reader-back').click(); await page.locator('#open-read').click();
      assert.equal(await page.locator('#reading').isVisible(), true);
      assert.deepEqual(await save(), { ...original, version: 3, sourceRubies: [], marks: [] });
      // The existing reader is used for configuration and reading edits.
      await page.evaluate(() => { window.scrollTo(0, 500); window.Reader.configure({ width: 520, columns: 18, height: 2.1, breaks: 2 }); });
      assert.equal(await renderedSource(), source);
      assert.deepEqual(await readings(), Object.fromEntries(annotations.map(a => [a.offset, `【${a.text}】`])));
      await page.locator('#ruby-mode').click();
      await page.locator('.reading-annotation[data-offset="4"]').first().click();
      await page.locator('#ruby-input').fill('ゆうぐれ'); await page.locator('#ruby-save').click();
      const deletedOffset = annotations[3].offset;
      await page.locator(`.reading-annotation[data-offset="${deletedOffset}"]`).first().click();
      await page.locator('#ruby-delete').click();
      const edited = manuscript(source, annotations.filter(a => a.offset !== deletedOffset).map(a => a.offset === 4 ? { ...a, text: 'ゆうぐれ' } : a));
      assert.deepEqual(await save(), { ...edited, version: 3, sourceRubies: [], marks: [] });
      await page.locator('#reader-back').click();
      // Failed imports are all-or-nothing, including a late invalid entry.
      const invalid = [
        ['{', /JSON/],
        [{ ...original, format: 'other' }, /format/],
        [{ ...original, version: 9 }, /version/],
        [{ ...original, text: [] }, /本文/],
        [{ ...original, annotations: null }, /配列/],
        [manuscript(source, [...annotations, { offset: source.indexOf('👩') + 2, text: '不正' }]), /境界/],
        [manuscript(source, [...annotations, { ...annotations[0] }]), /重複/],
        [manuscript(source, [{ offset: 0, text: 'a\nb' }]), /改行/],
        [Buffer.from([0xff, 0xfe, 0x7b]), /UTF-8/]
      ];
      for (const [data, reason] of invalid) {
        await choose(data, typeof data === 'string'); await complete();
        assert.equal(await page.locator('#read-input').isVisible(), true);
        assert.match(await page.locator('#notice').textContent(), reason);
        assert.equal(await page.locator('#confirm-dialog').evaluate(d => d.open), false, 'invalid file does not ask to replace');
        assert.equal(await page.locator('#read-text').inputValue(), source.replace(/\r\n?/g, '\n'));
      }
      await page.evaluate(() => { window.originalArrayBuffer = File.prototype.arrayBuffer; File.prototype.arrayBuffer = () => Promise.reject(new Error('read failed')); });
      await choose(original); await complete();
      assert.match(await page.locator('#notice').textContent(), /読み取れません/);
      await page.evaluate(() => { File.prototype.arrayBuffer = window.originalArrayBuffer; });
      await page.locator('#open-read').click(); assert.deepEqual(await save(), { ...edited, version: 3, sourceRubies: [], marks: [] });
      await page.locator('#reader-back').click();
      // Protect both an edited textarea draft and retained annotations on cancel.
      const draft = '入力途中の変更';
      await page.locator('#read-text').evaluate((el, text) => { el.value = text; el.dispatchEvent(new Event('input')); }, draft);
      await choose(original);
      await page.waitForFunction(() => document.getElementById('confirm-dialog').open);
      assert.match(await page.locator('#confirm-message').textContent(), /現在の本文と読み仮名/);
      await page.locator('#confirm-cancel').click(); await complete();
      assert.equal(await page.locator('#read-text').inputValue(), draft);
      await page.locator('#open-read').click();
      await page.waitForFunction(() => document.getElementById('confirm-dialog').open);
      assert.match(await page.locator('#confirm-message').textContent(), /読み仮名.*削除/);
      await page.locator('#confirm-cancel').click();
      await page.locator('#read-text').evaluate((el, text) => { el.value = text; el.dispatchEvent(new Event('input')); }, source);
      await page.locator('#open-read').click(); assert.deepEqual(await save(), { ...edited, version: 3, sourceRubies: [], marks: [] });
      await page.locator('#reader-back').click();
      // Selecting nothing and selecting the same file again do not get stuck.
      await page.locator('#manuscript-file').setInputFiles([]);
      assert.equal(await page.locator('#import-manuscript').isEnabled(), true);
      await choose(original); await page.waitForFunction(() => document.getElementById('confirm-dialog').open);
      await page.locator('#confirm-ok').click(); await complete();
      assert.deepEqual(await save(), { ...original, version: 3, sourceRubies: [], marks: [] });
      assert.equal(await storage(), beforeStorage);
      assert.equal(requests.length, initialRequests, 'import/export do not send manuscript data');
      // A new page load restores from a file, with no manuscript in Storage.
      await page.reload(); await page.locator('[data-go="read-input"]').click();
      await page.locator('#read-text').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input')); });
      await choose(Buffer.from('\ufeff' + JSON.stringify(edited))); await complete();
      assert.deepEqual(await save(), { ...edited, version: 3, sourceRubies: [], marks: [] });
      // Export a source with no annotations, then empty/blank-line manuscripts.
      for (const data of [manuscript('本文だけ【元からの括弧】'), manuscript(''), manuscript('\r\n\r\n', [{ offset: 0, text: '先頭' }, { offset: 2, text: '空行' }, { offset: 4, text: '末尾' }])]) {
        await page.locator('#reader-back').click(); await choose(data);
        await page.waitForFunction(() => document.getElementById('confirm-dialog').open || !document.getElementById('import-manuscript').disabled);
        if (await page.locator('#confirm-dialog').evaluate(d => d.open)) await page.locator('#confirm-ok').click();
        await complete();
        assert.equal(await renderedSource(), data.text);
        assert.deepEqual(await save(), { ...data, version: 3, sourceRubies: [], marks: [] });
        await page.locator('#reader-back').click(); await page.locator('#open-read').click();
        assert.deepEqual(await save(), { ...data, version: 3, sourceRubies: [], marks: [] });
      }
      // Saving remains confined to read mode; timing results are unaffected.
      await page.locator('#operations').click(); await page.locator('#home-from-menu').click();
      await page.locator('[data-go="time-input"]').click(); await page.locator('#prepare-time').click();
      await page.locator('#operations').click(); assert.equal(await page.locator('#export-manuscript').isVisible(), false);
      assert.equal(await storage(), beforeStorage);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: JSON downloads/imports, exact Unicode/newlines, safe rendering, edits, cancellation/errors, no Storage/network writes`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());

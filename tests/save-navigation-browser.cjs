// Focused browser checks for manual manuscript saving and replacement guards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, name)));
});
const original = { format: 'reading-support-manuscript', version: 3, text: '黄昏の空。\n' + '静かな森で読む。'.repeat(150),
  annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [], marks: [
    { id: 1, type: 'marker', start: 0, end: 2, color: 'yellow' },
    { id: 2, type: 'memo', offset: 0, dx: .4, dy: 0, text: 'ゆっくり' },
    { id: 3, type: 'pen', offset: 0, layoutKey: '30:1.8:0:0', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], witnesses: [{ offset: 0, x: 0, y: 0 }] }
  ] };
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1100, height: 800 } });
    page.setDefaultTimeout(6000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const click = id => page.locator('#' + id).click();
    const draftText = text => page.locator('#read-text').evaluate((el, text) => { el.value = text; el.dispatchEvent(new Event('input')); }, text);
    const invoke = id => page.locator('#' + id).evaluate(el => el.click());
    const visible = (id, expected = true) => page.waitForFunction(({ id, expected }) => !document.getElementById(id).hidden === expected, { id, expected });
    const opened = (id, expected = true) => page.waitForFunction(({ id, expected }) => document.getElementById(id).open === expected, { id, expected });
    const getSave = async (id = 'export-manuscript') => {
      const pending = page.waitForEvent('download'); await click(id);
      return JSON.parse(fs.readFileSync(await (await pending).path(), 'utf8'));
    };
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('[data-go=read-input]').click();
    await page.locator('#manuscript-file').setInputFiles({ name: 'manuscript.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
    await visible('reading');
    assert.equal(await page.evaluate(() => ManuscriptWriting.enabled), false);

    // Autosave replaces the former navigation/edit warnings.
    await click('writing-mode'); await page.waitForFunction(() => ManuscriptWriting.enabled);
    assert.equal(await page.locator('#confirm-dialog').isVisible(), false);
    await click('writing-off');
    const canonical = await page.evaluate(data => {
      const { manuscript, markings } = ManuscriptMarks.restoreManuscript(JSON.stringify(data));
      return JSON.parse(ManuscriptMarks.serializeManuscript(manuscript, markings));
    }, original);
    assert.deepEqual(await getSave(), canonical);
    for (const route of ['reader-back', 'brand']) {
      if (route === 'brand') await page.locator('.brand').click(); else await invoke(route);
      await opened('save-navigation-dialog', false);
      if (route === 'brand') await page.locator('#library-list .book-open').click();
      else { await visible('read-input'); await click('open-read'); }
      await visible('reading');
    }
    // A durable-write failure offers the existing manuscript download fallback.
    await page.evaluate(() => { window.realSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw Error('quota test'); }; });
    await invoke('reader-back'); await opened('save-navigation-dialog');
    await click('save-navigation-cancel'); await page.waitForTimeout(50); await visible('reading');
    await invoke('reader-back');
    await page.evaluate(() => { window.originalCreateURL = URL.createObjectURL; URL.createObjectURL = () => { throw Error('download test'); }; });
    await click('save-navigation-download');
    assert.match(await page.locator('#save-navigation-error').textContent(), /download test/);
    await page.evaluate(() => { URL.createObjectURL = window.originalCreateURL; });
    assert.deepEqual(await getSave('save-navigation-download'), canonical);
    await click('save-navigation-return'); await page.waitForTimeout(50); await visible('reading');
    await page.evaluate(() => { Storage.prototype.setItem = window.realSetItem; });
    await click('retry-save');
    // Unconfirmed memo edits still block navigation and manual download.
    await click('writing-mode'); await page.locator('[data-writing-tool=memo]').click();
    await page.locator('.writing-memo').click(); await page.locator('.writing-memo').click(); await page.locator('#writing-memo-input').fill('未確定メモ');
    await invoke('reader-back'); await invoke('export-manuscript');
    assert.equal(await page.locator('#writing-memo-input').inputValue(), '未確定メモ');
    await opened('save-navigation-dialog', false); await click('writing-memo-cancel');
    // Text replacement still waits for explicit confirmation before deleting marks.
    await invoke('reader-back'); await visible('read-input');
    await draftText('変更した本文'); await click('open-read');
    assert.equal(await page.locator('#confirm-ok').textContent(), '開く'); await click('confirm-cancel');
    await draftText(original.text); await click('open-read'); assert.deepEqual(await getSave(), canonical);
    await invoke('reader-back'); await draftText('新しい本文'); await click('open-read'); await click('confirm-ok');
    await visible('reading'); assert.equal(await page.locator('.writing-memo').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: autosaved navigation, failed save/download fallback, pending memo and deferred replacement guards');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });

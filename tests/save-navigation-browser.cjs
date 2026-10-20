// Focused browser checks for manual manuscript saving and replacement guards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'app.js']);
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
    assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => ManuscriptWriting.enabled), false);

    // Import warning is shared by both modes; cancellation keeps modes off.
    await click('ruby-mode'); await opened('confirm-dialog'); await click('confirm-cancel');
    assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'false');
    await click('writing-mode'); await click('confirm-ok');
    await page.waitForFunction(() => ManuscriptWriting.enabled);
    await click('writing-off');
    await click('ruby-mode'); await opened('confirm-dialog', false);
    assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await getSave(), original);
    assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => ManuscriptWriting.enabled), false);

    // Each departure uses the same prompt and retains its initial destination.
    for (const route of ['reader-back', 'brand', 'home-from-menu']) {
      await page.evaluate(() => scrollTo(0, 300));
      const before = await page.evaluate(() => scrollY);
      const navigate = async () => {
        if (route === 'brand') await page.locator('.brand').evaluate(el => el.click());
        else { if (route === 'home-from-menu') await invoke('operations'); await invoke(route); }
      };
      await navigate(); await opened('save-navigation-dialog');
      assert.equal(await page.locator('#save-navigation-prompt p').innerText(), '文章は仮保存状態です。読み仮名・赤ペンなどの書き込み情報は、\n文章を編集した場合削除されます。');
      await click('save-navigation-cancel'); await opened('save-navigation-dialog', false);
      assert.equal(await page.evaluate(() => scrollY), before);
      if (route === 'home-from-menu') await click('operation-dialog [data-close]').catch(() => {});
      await navigate(); await opened('save-navigation-dialog');
      await invoke(route === 'reader-back' ? 'home-from-menu' : 'reader-back');
      assert.deepEqual(await getSave('save-navigation-download'), original);
      await visible('save-navigation-started'); await visible('reading');
      assert.match(await page.locator('#save-navigation-started').innerText(), /端末に保存されたことをご確認ください。/);
      await click('save-navigation-move');
      if (route !== 'reader-back') { await visible('home'); await page.locator('[data-go=read-input]').click(); }
      await visible('read-input'); await click('open-read'); await visible('reading');
    }

    // Save failures preserve the active mode, and permit retry in the same prompt.
    await click('writing-mode'); await click('confirm-ok'); await page.waitForFunction(() => ManuscriptWriting.enabled);
    await page.evaluate(() => { window.originalCreateURL = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('test failure'); }; });
    await invoke('reader-back'); await click('save-navigation-download');
    assert.equal(await page.evaluate(() => ManuscriptWriting.enabled), true);
    assert.match(await page.locator('#save-navigation-error').textContent(), /test failure/);
    await visible('reading'); await visible('save-navigation-prompt');
    await page.evaluate(() => { URL.createObjectURL = window.originalCreateURL; });
    assert.deepEqual(await getSave('save-navigation-download'), original);
    await click('save-navigation-return'); await opened('save-navigation-dialog', false);
    await click('ruby-mode'); await click('confirm-cancel');
    await click('ruby-mode'); await click('confirm-ok');
    await page.locator('.reading-annotation').first().click();
    await page.locator('#ruby-input').fill('未確定');
    await invoke('reader-back'); await invoke('export-manuscript');
    assert.equal(await page.locator('#ruby-input').inputValue(), '未確定');
    await opened('save-navigation-dialog', false);
    // Ruby-position confirmation replaces the editor temporarily, keeping its draft on cancel.
    await click('ruby-save'); await opened('confirm-dialog');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await click('confirm-cancel'); await opened('ruby-dialog');
    assert.equal(await page.locator('#ruby-input').inputValue(), '未確定');
    await click('ruby-cancel'); await click('writing-mode');
    await page.locator('[data-writing-tool=memo]').click(); await page.locator('.writing-memo').click();
    await page.locator('#writing-memo-input').fill('未確定メモ');
    await invoke('reader-back'); await invoke('export-manuscript');
    assert.equal(await page.locator('#writing-memo-input').inputValue(), '未確定メモ');
    await opened('save-navigation-dialog', false); await click('writing-memo-cancel');

    // Text and HTML paste changes wait until opening; cancellation preserves the old manuscript.
    await invoke('reader-back'); await click('save-navigation-discard'); await visible('read-input');
    await draftText('変更した本文'); await click('open-read');
    assert.equal(await page.locator('#confirm-ok').textContent(), '開く'); await click('confirm-cancel');
    await draftText(original.text); await click('open-read');
    assert.deepEqual(await getSave(), original);
    await invoke('reader-back'); await click('save-navigation-discard'); await visible('read-input');
    await page.locator('#read-text').evaluate(el => {
      el.select(); const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', '<ruby>猫<rt>ねこ</rt></ruby>の話。');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await click('confirm-ok'); await page.waitForFunction(() => document.getElementById('read-text').value === '猫の話。');
    await click('open-read'); await click('confirm-cancel');
    await draftText(original.text); await click('open-read'); assert.deepEqual(await getSave(), original);
    await invoke('reader-back'); await click('save-navigation-discard'); await visible('read-input');
    await draftText('新しい本文'); await click('open-read'); await click('confirm-ok');
    await visible('reading'); await click('writing-mode'); await opened('confirm-dialog', false);
    await invoke('reader-back'); await visible('read-input'); await opened('save-navigation-dialog', false);
    await click('open-read'); await click('measure-current');
    await visible('reading'); await opened('save-navigation-dialog', false);
    await click('reader-back'); await visible('time-input');
    await opened('save-navigation-dialog', false);
    assert.deepEqual(errors, []);
    console.log('PASS: departure destinations, save success/failure, edit warning, pending drafts, and deferred text/HTML replacement');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });

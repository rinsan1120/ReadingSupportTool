// Run with Playwright on NODE_PATH and Chrome installed. No production dependencies.
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
const choose = (page, data, name = 'user.json') => page.locator('#user-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
const loaded = page => page.waitForFunction(() => !document.getElementById('startup-dialog').open && !document.getElementById('import-user').disabled);
const bookJSON = { format: 'reading-support-manuscript', version: 4, text: '黄昏の空。\r\n狐が歩く。', annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 7, end: 8, reading: 'きつね' }],
  marks: [{ id: 1, type: 'memo', offset: 0, text: 'ゆっくり', dx: 1, dy: 1, tx: 0, ty: 0, color: 'yellow' }, { id: 2, type: 'marker', start: 0, end: 2, color: 'pink' }], memoSettings: { fontSize: 18, opacity: .8 } };
const downloadUser = async (page, button = 'export-user', confirmed = true) => {
  const pending = page.waitForEvent('download'); await page.locator('#' + button).click();
  const file = await pending, data = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
  assert.equal(await page.locator('#download-confirm-dialog').isVisible(), true);
  assert.match(await page.locator('#download-filename').textContent(), /^(?:user|yomijitaku-user-\d{4}-\d{2}-\d{2})\.json$/);
  await page.locator(confirmed ? '#download-saved' : '#download-not-saved').click();
  await page.waitForTimeout(50); return data;
};
const installPicker = async page => page.evaluate(() => {
  window.pickerMode = 'ok'; window.savedFileJSON = ''; window.abortCalls = 0;
  window.showSaveFilePicker = async options => {
    window.pickerOptions = options;
    if (window.pickerMode === 'cancel') throw new DOMException('cancel', 'AbortError');
    if (window.pickerMode === 'picker-error') throw Error('picker failed');
    return { name: 'chosen-user.json', createWritable: async () => {
      if (window.pickerMode === 'create-error') throw Error('create failed');
      return { write: async json => { if (window.pickerMode === 'write-error') throw Error('write failed'); window.savedFileJSON = json; },
        close: async () => { if (window.pickerMode === 'close-error') throw Error('close failed'); if (window.pickerMode === 'delay') await new Promise(resolve => { window.finishClose = resolve; }); },
        abort: async () => { window.abortCalls++; } };
    } };
  };
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const url = `http://127.0.0.1:${server.address().port}`;
  const key = 'yomijitaku-user-v1';
  const raw = page => page.evaluate(key => localStorage.getItem(key), key);
  const resume = async page => { await page.locator('#start-browser').click(); await loaded(page); };
  const settle = page => page.waitForFunction(() => document.getElementById('user-save-status').dataset.unsaved === 'false');
  const fixture = {
    format: 'yomijitaku-user', version: 1, profile: { name: '以前の利用者' },
    manuscripts: ['one', 'two'].map(id => ({ id, title: id, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', draft: bookJSON.text.replace(/\r\n/g, '\n'), manuscript: bookJSON, pending: null })),
    activeId: 'two', history: [{ characters: 200, seconds: 40, type: 'custom', measuredAt: null, title: '計測記録' }], target: '300', plannedMinutes: '10'
  };
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, acceptDownloads: true });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
      await page.goto(url);
      assert.deepEqual(await page.locator('.startup-choice span').allTextContents(), ['はじめる', '保存したデータを開く']);
      for (const text of [
        '原稿や書き込み、朗読速度の記録は、このブラウザに自動保存されます。次回も続きから利用できます。',
        '大切なデータの保存について',
        'ブラウザに自動保存されたデータは、ブラウザ上のデータ削除などにより、予期せず消える場合があります。',
        '定期的にデータをファイルに保存することをおすすめします。',
        '保存したデータは別の端末でよみじたくを利用する際にも利用可能です。'
      ]) assert.ok((await page.locator('#startup-dialog').textContent()).includes(text));
      assert.ok(await page.locator('#startup-dialog').evaluate(d => d.scrollWidth <= d.clientWidth));
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#startup-dialog').isVisible(), true);
      await page.screenshot({ path: `tmp/startup-${width}.png` });
      await resume(page);
      assert.equal((JSON.parse(await raw(page))).manuscripts.length, 0);
      await page.locator('.user-settings summary').click();
      await page.locator('#profile-name').fill('自動保存の利用者'); await settle(page);
      await page.reload(); await resume(page);
      assert.equal(await page.locator('#profile-name').inputValue(), '自動保存の利用者');
      // Startup restore must ask before changing an existing browser library.
      await page.reload(); const before = await raw(page);
      await choose(page, fixture); await page.locator('#confirm-cancel').click();
      await page.waitForFunction(() => !document.getElementById('import-user').disabled);
      assert.equal(await raw(page), before);
      assert.equal(await page.locator('#startup-dialog').isVisible(), true);
      await choose(page, fixture); await page.locator('#confirm-ok').click(); await loaded(page);
      const restored = JSON.parse(await raw(page));
      assert.deepEqual(restored.history, fixture.history);
      assert.deepEqual(restored.manuscripts.map(b => b.manuscript), fixture.manuscripts.map(b => b.manuscript));
      assert.equal(restored.activeId, 'two');
      await page.getByRole('button', { name: 'oneを開く', exact: true }).click(); await settle(page);
      assert.equal(JSON.parse(await raw(page)).activeId, 'one');
      await page.locator('.brand').click();
      await page.getByRole('button', { name: 'twoを開く', exact: true }).click(); await settle(page);
      assert.equal(JSON.parse(await raw(page)).activeId, 'two');
      await page.locator('.brand').click();
      await page.locator('.user-settings summary').click();
      await page.locator('#profile-name').fill('復元後の編集'); await settle(page);
      const backup = await downloadUser(page);
      assert.equal(backup.profile.name, '復元後の編集');
      await page.locator('#profile-name').fill('バックアップ後の編集'); await settle(page);
      await page.reload(); await resume(page);
      assert.equal(await page.locator('#profile-name').inputValue(), 'バックアップ後の編集');
      // Import failure and cancellation keep the complete current library.
      const current = await raw(page);
      await choose(page, '{broken');
      await page.waitForFunction(() => !document.getElementById('import-user').disabled);
      assert.equal(await raw(page), current);
      await choose(page, fixture); await page.locator('#confirm-cancel').click();
      await page.waitForFunction(() => !document.getElementById('import-user').disabled);
      assert.equal(await raw(page), current);
      // Quota failure retains durable data and keeps export/retry usable.
      await page.evaluate(() => { window.originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw Error('容量不足テスト'); }; });
      await page.locator('.user-settings summary').click();
      await page.locator('#profile-name').fill('保存失敗中の編集');
      await page.waitForFunction(() => document.getElementById('user-save-status').textContent.includes('容量不足テスト'));
      assert.equal(await raw(page), current);
      const failedBackup = await downloadUser(page);
      assert.equal(failedBackup.profile.name, '保存失敗中の編集');
      assert.match(await page.locator('#user-save-status').textContent(), /自動保存できません/);
      await page.evaluate(() => { Storage.prototype.setItem = window.originalSet; });
      await page.locator('#retry-browser-save').click(); await settle(page);
      assert.equal(JSON.parse(await raw(page)).profile.name, '保存失敗中の編集');
      // Native file save failures never stop autosave or discard edits.
      await installPicker(page);
      for (const mode of ['cancel', 'picker-error', 'create-error', 'write-error', 'close-error', 'ok']) {
        await page.evaluate(mode => window.pickerMode = mode, mode);
        await page.locator('#save-user-status').click();
        await page.waitForFunction(() => !document.getElementById('save-user-status').disabled);
        assert.equal(JSON.parse(await raw(page)).profile.name, '保存失敗中の編集');
      }
      assert.equal(JSON.parse(await page.evaluate(() => window.savedFileJSON)).profile.name, '保存失敗中の編集');
      await page.screenshot({ path: `tmp/startup-complete-${width}.png` });
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px: startup, existing files/marks/history, replacement cancel, reload, backup, quota/retry, native picker`);
    }
    // First import needs no replacement prompt when no browser data exists.
    const context = await browser.newContext(); const page = await context.newPage(); await page.goto(url);
    await choose(page, fixture); await loaded(page);
    assert.equal(JSON.parse(await raw(page)).profile.name, fixture.profile.name);
    // Corrupt browser data is never reset by Start, and can be explicitly restored.
    await page.evaluate(key => localStorage.setItem(key, '{broken'), key); await page.reload();
    await page.locator('#start-browser').click();
    assert.match(await page.locator('#startup-error').textContent(), /上書きしません/);
    assert.equal(await raw(page), '{broken');
    await choose(page, fixture); await page.locator('#confirm-cancel').click();
    await page.waitForFunction(() => !document.getElementById('import-user').disabled);
    assert.equal(await raw(page), '{broken');
    await choose(page, fixture); await page.locator('#confirm-ok').click(); await loaded(page);
    assert.equal(JSON.parse(await raw(page)).profile.name, fixture.profile.name);
    await context.close();
    // Denied browser access still permits editing and file backup, with a clear error.
    const denied = await browser.newContext(); const p = await denied.newPage();
    await p.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw Error('アクセス拒否テスト'); } }));
    await p.goto(url); await resume(p);
    assert.match(await p.locator('#user-save-status').textContent(), /アクセス拒否テスト/);
    await installPicker(p); await p.locator('#save-user-status').click();
    await p.waitForFunction(() => !!window.savedFileJSON);
    assert.equal(JSON.parse(await p.evaluate(() => window.savedFileJSON)).format, 'yomijitaku-user');
    await denied.close();
    console.log('PASS first import, corrupt data protection, denied access and backup');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

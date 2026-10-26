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
const dirty = page => page.locator('#user-save-status').getAttribute('data-unsaved');
const unloadBlocked = page => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });
const bookJSON = { format: 'reading-support-manuscript', version: 4, text: '黄昏の空。\r\n狐が歩く。', annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 7, end: 8, reading: 'きつね' }],
  marks: [{ id: 1, type: 'memo', offset: 0, text: 'ゆっくり', dx: 1, dy: 1, tx: 0, ty: 0, color: 'yellow' }, { id: 2, type: 'marker', start: 0, end: 2, color: 'pink' }], memoSettings: { fontSize: 18, opacity: .8 } };
const downloadUser = async (page, button = 'export-user', confirmed = true) => {
  const pending = page.waitForEvent('download'); await page.locator('#' + button).click();
  const file = await pending, data = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
  assert.equal(await page.locator('#download-confirm-dialog').isVisible(), true);
  assert.match(await page.locator('#download-filename').textContent(), /^yomijitaku-user-\d{4}-\d{2}-\d{2}\.json$/);
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
  try {
    const url = `http://127.0.0.1:${server.address().port}/`; let portable;
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(8000); const errors = [];
      await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
      page.on('pageerror', e => errors.push(e.message)); await page.goto(url);
      assert.equal(await page.locator('#startup-dialog').isVisible(), true);
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#startup-dialog').isVisible(), true);
      assert.equal(await unloadBlocked(page), false);
      await choose(page, '{broken'); await page.waitForFunction(() => document.getElementById('startup-error').textContent.includes('読み込めません'));
      assert.equal(await page.locator('#startup-dialog').isVisible(), true);
      await page.locator('#start-new').click(); await loaded(page);
      assert.equal(await dirty(page), 'false', 'a fresh start has no unsaved changes yet');
      assert.equal(await unloadBlocked(page), false);
      assert.match(await page.locator('#user-save-status').textContent(), /保存先ファイルはまだありません/);
      await page.locator('.user-settings summary').click(); await page.locator('#profile-name').fill('朗読さん');
      await page.waitForFunction(() => document.getElementById('user-save-status').dataset.unsaved === 'true', null, { timeout: 3000 });
      await page.locator('#new-manuscript').click(); await page.locator('#manuscript-title').fill('第一冊');
      await page.locator('#manuscript-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bookJSON)) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden && !document.getElementById('import-manuscript').disabled);
      assert.equal(await page.locator('.writing-memo').count(), 1);
      assert.equal(await page.locator('#export-manuscript').getAttribute('aria-label'), '保存');
      assert.equal(await page.locator('#reader-save-state').isHidden(), false, 'unsaved edits stay visible on the reader');
      const unconfirmed = await downloadUser(page, 'export-manuscript', false);
      assert.deepEqual(unconfirmed.manuscripts[0].manuscript, bookJSON); assert.equal(await dirty(page), 'true');
      await page.locator('.brand').click(); await page.locator('#new-manuscript').click();
      await page.locator('#manuscript-title').fill('<b>第二冊</b>'); await page.locator('#read-text').fill('新しい原稿。'); await page.locator('#open-read').click();
      portable = await downloadUser(page, 'export-manuscript');
      assert.equal(portable.manuscripts.length, 2); assert.equal(portable.profile.name, '朗読さん'); assert.equal(await dirty(page), 'false');
      assert.equal(await unloadBlocked(page), false);
      await page.locator('.brand').click(); await page.locator('#library-list .book-open', { hasText: '第一冊' }).click();
      assert.equal(await page.locator('.writing-memo').count(), 1); assert.equal(await dirty(page), 'false', 'switching books alone is not an edit');
      await page.locator('#reader-back').click();
      await page.locator('#read-text').evaluate(el => { el.value = '変更途中の原稿。'; el.dispatchEvent(new Event('input')); });
      assert.equal(await dirty(page), 'true');
      const draftFile = await downloadUser(page, 'save-user-status');
      assert.equal(draftFile.manuscripts[0].draft, '変更途中の原稿。'); assert.deepEqual(draftFile.manuscripts[0].manuscript, bookJSON);
      await page.reload(); assert.equal(await page.locator('#startup-dialog').isVisible(), true);
      assert.equal(await page.locator('#library-list li').count(), 0, 'reload never reads user data automatically');
      await choose(page, draftFile); await loaded(page); assert.equal(await dirty(page), 'false');
      await page.locator('#library-list .book-open', { hasText: '第一冊' }).click(); assert.equal(await page.locator('#read-text').inputValue(), '変更途中の原稿。');
      await page.locator('.brand').click(); await page.locator('.user-settings summary').click(); await page.locator('#profile-name').fill('未保存の名前');
      await choose(page, portable); await page.locator('#confirm-cancel').click(); await page.waitForFunction(() => !document.getElementById('import-user').disabled);
      assert.equal(await page.locator('#profile-name').inputValue(), '未保存の名前'); assert.equal(await dirty(page), 'true');
      for (const bad of [bookJSON, { ...portable, version: 999 }, { ...portable, manuscripts: [...portable.manuscripts, portable.manuscripts[0]] }]) {
        await choose(page, bad); await page.waitForFunction(() => !document.getElementById('import-user').disabled);
        assert.equal(await page.locator('#library-list li').count(), 2); assert.equal(await page.locator('#profile-name').inputValue(), '未保存の名前');
      }
      await choose(page, portable); await page.locator('#confirm-ok').click(); await loaded(page); assert.equal(await dirty(page), 'false');
      assert.match(await page.locator('#library-list li').first().textContent(), /第二冊/, 'most recently updated book comes first');
      assert.match(await page.locator('#library-list li').first().textContent(), /開いている原稿/);
      assert.equal(await page.locator('#library-list li').first().locator('.book-preview').textContent(), '新しい原稿。');
      await page.locator('#library-list li').first().getByRole('button', { name: /の名前を変更/ }).click();
      await page.locator('.library-rename-input').fill('改題した第二冊');
      await page.locator('#library-list li').first().getByRole('button', { name: '保存', exact: true }).click();
      assert.match(await page.locator('#library-list li').first().textContent(), /改題した第二冊/);
      assert.equal(await dirty(page), 'true', 'renaming is an unsaved change');
      await page.locator('#library-list li').first().getByRole('button', { name: /を削除/ }).click(); await page.locator('#confirm-cancel').click(); await page.waitForTimeout(50);
      assert.equal(await dirty(page), 'true', 'cancelling a deletion keeps the unsaved rename');
      await page.locator('#library-list li').first().getByRole('button', { name: /を削除/ }).click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => document.querySelectorAll('#library-list li').length === 1); assert.equal(await dirty(page), 'true');
      assert.match(await page.locator('#notice').textContent(), /ファイルに反映するには「保存」を押してください/);
      assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), {}, 'no browser writes');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'home fits');
      await page.locator('#library-list .book-open').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#reader-actions button')].filter(e => !e.hidden).every(e => e.getBoundingClientRect().right <= innerWidth)), 'save button fits on mobile');
      await page.locator('#reader-back').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'user.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) });
      await page.waitForFunction(() => document.getElementById('notice').textContent.includes('保存したファイルを開く'), null, { timeout: 3000 });
      if (process.env.READER_TEST_ARTIFACTS) { fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `file-reader-${width}.png`) }); }
      assert.deepEqual(errors, []); await context.close(); console.log(`file sessions ${width}: PASS`);
    }
    // Native picker cancellation, write failures, overwrite choice and concurrent edits.
    const context = await browser.newContext(); const page = await context.newPage(); await page.goto(url); await choose(page, portable, 'existing.json'); await loaded(page); await installPicker(page);
    await page.locator('.user-settings summary').click(); await page.locator('#profile-name').fill('編集後');
    let downloads = 0; page.on('download', () => downloads++);
    for (const mode of ['cancel', 'picker-error', 'create-error', 'write-error', 'close-error']) {
      await page.evaluate(mode => { window.pickerMode = mode; }, mode); await page.locator('#export-user').click();
      await page.waitForFunction(() => !document.getElementById('export-user').disabled); assert.equal(await dirty(page), 'true');
      assert.equal(await page.evaluate(() => window.pickerOptions.suggestedName), 'existing.json');
    }
    assert.equal(downloads, 0, 'cancel/error never triggers a fallback download');
    assert.equal(await page.evaluate(() => window.abortCalls), 2);
    await page.evaluate(() => { window.pickerMode = 'ok'; }); await page.locator('#export-user').click();
    await page.waitForFunction(() => !document.getElementById('export-user').disabled); assert.equal(await dirty(page), 'false');
    assert.equal(JSON.parse(await page.evaluate(() => window.savedFileJSON)).profile.name, '編集後');
    await page.evaluate(() => { window.pickerMode = 'cancel'; }); await page.locator('#export-user').click();
    await page.waitForFunction(() => !document.getElementById('export-user').disabled); assert.equal(await dirty(page), 'false', 'cancel also preserves a clean baseline');
    await page.evaluate(() => { window.pickerMode = 'delay'; }); await page.locator('#export-user').click(); await page.waitForFunction(() => !!window.finishClose);
    await page.locator('#profile-name').fill('保存中に変更'); await page.evaluate(() => window.finishClose());
    await page.waitForFunction(() => !document.getElementById('export-user').disabled); assert.equal(await dirty(page), 'true');
    assert.equal(JSON.parse(await page.evaluate(() => window.savedFileJSON)).profile.name, '編集後');
    assert.equal(await page.evaluate(() => window.pickerOptions.suggestedName), 'chosen-user.json');
    // Real beforeunload warns when leaving, cancellation keeps the edited session.
    const warning = page.waitForEvent('dialog'); const reload = page.reload().catch(() => {}); await (await warning).dismiss(); await reload;
    assert.equal(await page.locator('#profile-name').inputValue(), '保存中に変更');
    // Completion appends a timestamped history record; the 100-result cap is retained.
    const historyFile = { ...portable, history: Array.from({ length: 100 }, () => ({ characters: 100, seconds: 20, type: 'custom', title: '作品', measuredAt: '2026-10-25T00:00:00.000Z' })) };
    await choose(page, historyFile); await page.locator('#confirm-ok').click(); await loaded(page);
    await page.locator('#library-list .book-open', { hasText: '第一冊' }).click(); await page.locator('#measure-current').click();
    await page.clock.install(); await page.locator('#start').click(); await page.clock.runFor(3100); await page.clock.runFor(1500); await page.locator('#finish').click();
    assert.equal(await page.locator('#history li').count(), 100); assert.equal(await dirty(page), 'true');
    await page.evaluate(() => { window.pickerMode = 'ok'; }); await page.locator('#save-user-status').click();
    await page.waitForFunction(() => !document.getElementById('save-user-status').disabled);
    const measured = JSON.parse(await page.evaluate(() => window.savedFileJSON)); assert.equal(measured.history.length, 100); assert.equal(measured.history.at(-1).title, '第一冊'); assert.ok(measured.history.at(-1).measuredAt);
    assert.equal(await dirty(page), 'false'); await page.clock.resume();
    await page.locator('.brand').click();
    assert.match(await page.locator('#library-list li').first().textContent(), /朗読目安 約/, 'shelf shows an estimated reading time once history exists');
    await page.locator('#home [data-go=estimate]').click();
    await page.locator('#estimate-book').selectOption({ index: 1 });
    assert.notEqual(await page.locator('#estimate-target').inputValue(), '', 'choosing a book fills its character count');
    assert.match(await page.locator('#estimate-time').textContent(), /約.*分/, 'choosing a book shows its estimated time directly');
    assert.match(await page.locator('#estimate-book-info').textContent(), /推定時間を表示しています/);
    await context.close();
    // Legacy migration is opt-in, leaves source unchanged even after a successful save.
    for (const raw of [JSON.stringify(portable), '{broken']) {
      const legacy = await browser.newContext(); const p = await legacy.newPage();
      await p.addInitScript(raw => localStorage.setItem('yomijitaku-user-v1', raw), raw); await p.goto(url);
      assert.equal(await p.locator('#legacy-user-data').isVisible(), true); assert.equal(await p.locator('#library-list li').count(), 0);
      await p.locator('#start-legacy').click();
      if (raw === '{broken') {
        await p.waitForFunction(() => document.getElementById('startup-error').textContent.includes('引き継げません'));
        const d = p.waitForEvent('download'); await p.locator('#export-legacy').click(); assert.equal(fs.readFileSync(await (await d).path(), 'utf8'), raw);
        await p.locator('#start-new').click(); assert.equal(await p.locator('#library-list li').count(), 0);
      } else {
        await loaded(p); assert.equal(await dirty(p), 'false', 'migrated data starts clean; it simply has no file yet');
        assert.match(await p.locator('#user-save-status').textContent(), /保存先ファイルはまだありません/);
        await installPicker(p);
        await p.locator('#save-user-status').click(); await p.waitForFunction(() => !document.getElementById('save-user-status').disabled);
        assert.equal(await dirty(p), 'false'); assert.deepEqual(JSON.parse(await p.evaluate(() => window.savedFileJSON)).manuscripts, portable.manuscripts);
      }
      assert.equal(await p.evaluate(() => localStorage.getItem('yomijitaku-user-v1')), raw); await legacy.close();
    }
    // Storage access denial does not block the new file workflow.
    const denied = await browser.newContext(); const p = await denied.newPage();
    await p.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
    await p.goto(url); await p.locator('#start-new').click(); await loaded(p); await installPicker(p);
    await p.locator('#save-user-status').click(); await p.waitForFunction(() => !document.getElementById('save-user-status').disabled); assert.equal(await dirty(p), 'false');
    // Pasted HTML ruby and an unopened draft must also survive a full-file round trip.
    await p.locator('#new-manuscript').click(); await p.locator('#read-text').evaluate(el => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/html', '<ruby>猫<rt>ねこ</rt></ruby>が歩く。');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await p.waitForFunction(() => document.getElementById('read-text').value === '猫が歩く。');
    await p.locator('#save-user-status').click(); await p.waitForFunction(() => !document.getElementById('save-user-status').disabled);
    const pastedFile = JSON.parse(await p.evaluate(() => window.savedFileJSON)); assert.equal(pastedFile.manuscripts[0].pending.sourceRubies[0].reading, 'ねこ');
    await p.reload(); await choose(p, pastedFile); await loaded(p); await p.locator('#library-list .book-open').click(); await p.locator('#open-read').click();
    assert.equal(await p.locator('.source-ruby-unit rt').textContent(), 'ねこ');
    await denied.close(); console.log('native picker, failed saves, unload warning, migration and denied storage: PASS');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

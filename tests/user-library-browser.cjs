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
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('yomijitaku-user-v1')));
const settled = page => page.waitForFunction(() => document.getElementById('autosave-status').textContent === 'このブラウザに自動保存済み');
const upload = (page, data) => page.locator('#user-file').setInputFiles({ name: 'user.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
const bookJSON = { format: 'reading-support-manuscript', version: 4, text: '黄昏の空。\r\n狐が歩く。', annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 7, end: 8, reading: 'きつね' }],
  marks: [{ id: 1, type: 'memo', offset: 0, text: 'ゆっくり', dx: 1, dy: 1, tx: 0, ty: 0, color: 'yellow' }], memoSettings: { fontSize: 18, opacity: .8 } };
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    let portable;
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url); await settled(page);
      await page.locator('.user-settings summary').click();
      await page.locator('#profile-name').fill('朗読さん'); await settled(page);
      await page.locator('#new-manuscript').click();
      await page.locator('#manuscript-title').fill('第一冊');
      await page.locator('#manuscript-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bookJSON)) });
      await page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
      await settled(page);
      assert.equal(await page.locator('#reading').isVisible(), true);
      assert.equal(await page.locator('.writing-memo').count(), 1);
      const first = (await stored(page)).manuscripts[0];
      assert.deepEqual(first.manuscript, bookJSON);
      await page.locator('#reader-back').click();
      assert.equal(await page.locator('#save-navigation-dialog').isVisible(), false);
      await page.locator('#read-text').fill('未確定の本文。'); await page.locator('#confirm-ok').click(); await page.waitForFunction(() => !document.getElementById('import-user').disabled); await settled(page);
      await page.reload(); await settled(page);
      await page.locator('#library-list .book-open').click();
      assert.equal(await page.locator('#read-text').inputValue(), '未確定の本文。');
      assert.deepEqual((await stored(page)).manuscripts[0].manuscript, bookJSON, 'draft preserves prior annotations until explicit replacement');
      await page.locator('#read-text').fill(bookJSON.text.replace(/\r\n?/g, '\n')); await page.locator('#confirm-ok').click(); await page.waitForFunction(() => !document.getElementById('import-user').disabled); await settled(page);
      await page.locator('[data-go=home]').first().click();
      await page.locator('#new-manuscript').click();
      await page.locator('#manuscript-title').fill('<b>第二冊</b>');
      await page.locator('#read-text').fill('新しい原稿。'); await page.locator('#open-read').click(); await settled(page);
      await page.locator('[data-go=home]').first().click();
      assert.equal(await page.locator('#library-list li').count(), 2);
      assert.equal(await page.locator('#library-list b').count(), 0);
      await page.locator('#library-list .book-open', { hasText: '第一冊' }).click();
      assert.equal(await page.locator('.writing-memo').count(), 1);
      assert.deepEqual((await stored(page)).manuscripts[0].manuscript, bookJSON);
      await page.locator('[data-go=home]').first().click();
      await page.locator('#library-list li').first().getByRole('button', { name: /を削除/ }).click();
      await page.locator('#confirm-cancel').click();
      assert.equal(await page.locator('#library-list li').count(), 2);
      await page.locator('.user-settings summary').click();
      const pending = page.waitForEvent('download'); await page.locator('#export-user').click();
      const download = await pending; portable = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      assert.equal(portable.profile.name, '朗読さん');
      const before = await stored(page);
      for (const bad of [bookJSON, { ...before, version: 999 }, { ...before, manuscripts: [...before.manuscripts, before.manuscripts[0]] },
        { ...before, manuscripts: [{ ...before.manuscripts[0], manuscript: { ...bookJSON, annotations: [{ offset: 999, text: 'x' }] } }] }]) {
        await upload(page, bad); await page.waitForFunction(() => !document.getElementById('import-user').disabled);
        assert.deepEqual(await stored(page), before);
      }
      const replacement = { ...before, profile: { name: '移行後' }, history: Array.from({ length: 100 }, (_, i) => ({ characters: 100, seconds: 20, type: 'custom', title: '作品', measuredAt: new Date(1700000000000 + i * 1000).toISOString() })) };
      await upload(page, replacement); await page.locator('#confirm-cancel').click();
      await page.waitForFunction(() => !document.getElementById('import-user').disabled); assert.deepEqual(await stored(page), before);
      await upload(page, replacement); await page.locator('#confirm-ok').click(); await page.waitForFunction(() => !document.getElementById('import-user').disabled); await settled(page);
      assert.equal((await stored(page)).profile.name, '移行後');
      await page.locator('#home [data-go=time-input]').click(); await page.locator('#prepare-time').click();
      await page.clock.install(); await page.locator('#start').click(); await page.clock.runFor(3100);
      await page.clock.runFor(1500); await page.locator('#finish').click(); await page.clock.runFor(300);
      assert.equal((await stored(page)).history.length, 100);
      assert.ok((await stored(page)).history.at(-1).measuredAt);
      assert.match(await page.locator('#history li').last().textContent(), /文字\/分/);
      await page.clock.resume();
      await page.locator('[data-go=home]').first().click();
      // Failed atomic restore and autosave retain the previously durable value.
      await page.evaluate(() => { window.realSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('容量不足', 'QuotaExceededError'); }; });
      const durable = await stored(page);
      await upload(page, before); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => !document.getElementById('import-user').disabled);
      assert.deepEqual(await stored(page), durable);
      await page.locator('#profile-name').fill('未保存');
      await page.waitForFunction(() => document.getElementById('autosave-status').textContent.startsWith('未保存：'));
      assert.deepEqual(await stored(page), durable);
      await page.evaluate(() => { Storage.prototype.setItem = window.realSetItem; }); await page.locator('#retry-save').click(); await settled(page);
      assert.equal((await stored(page)).profile.name, '未保存');
      await page.locator('#library-list li').first().getByRole('button', { name: /を削除/ }).click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => document.querySelectorAll('#library-list li').length === 1);
      assert.equal((await stored(page)).manuscripts.length, 1);
      await page.locator('#notice').evaluate(el => { el.hidden = true; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow');
      if (process.env.READER_TEST_ARTIFACTS) { fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `library-${width}.png`), fullPage: true }); }
      assert.deepEqual(errors, []);
      await context.close(); console.log(`library ${width}: PASS`);
    }
    const context = await browser.newContext(); const page = await context.newPage(); await page.goto(url);
    await upload(page, portable); await page.locator('#confirm-ok').click(); await page.waitForFunction(() => !document.getElementById('import-user').disabled); await settled(page);
    assert.deepEqual((await stored(page)).manuscripts, portable.manuscripts, 'portable restore into clean browser');
    const other = await context.newPage(); await other.goto(url); await settled(other);
    await page.locator('.user-settings summary').click(); await page.locator('#profile-name').fill('別タブの更新'); await settled(page);
    await other.waitForFunction(() => document.getElementById('autosave-status').textContent.includes('別のタブ'));
    await other.locator('#retry-save').click(); assert.equal((await stored(other)).profile.name, '別タブの更新');
    await page.locator('#library-list .book-open', { hasText: '第一冊' }).locator('..').getByRole('button', { name: /を削除/ }).click();
    await page.locator('#confirm-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#library-list li').length === 1);
    assert.equal((await stored(page)).activeId, null);
    assert.equal(await page.locator('#read-text').inputValue(), '');
    await context.close();
    // Corrupt durable storage must never be overwritten by startup or editing.
    const broken = await browser.newContext(); const p = await broken.newPage();
    await p.addInitScript(() => localStorage.setItem('yomijitaku-user-v1', '{broken'));
    await p.goto(url); assert.equal(await p.evaluate(() => localStorage.getItem('yomijitaku-user-v1')), '{broken');
    assert.match(await p.locator('#autosave-status').textContent(), /未保存/);
    await upload(p, portable); await p.locator('#confirm-ok').click(); await p.waitForFunction(() => !document.getElementById('import-user').disabled); await settled(p);
    assert.deepEqual((await stored(p)).manuscripts, portable.manuscripts);
    await broken.close();
    const legacy = await browser.newContext(); const lp = await legacy.newPage();
    await lp.addInitScript(() => sessionStorage.setItem('reading-support-results-v1', JSON.stringify({ version: 1, history: [{ characters: 200, seconds: 40, type: 'custom' }], target: 500, plannedMinutes: 10 })));
    await lp.goto(url); await settled(lp);
    assert.equal((await stored(lp)).history[0].measuredAt, null);
    assert.equal((await stored(lp)).target, '500');
    await lp.locator('#new-manuscript').click(); await lp.locator('#manuscript-title').fill('HTML原稿');
    await lp.locator('#read-text').evaluate(el => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/html', '<ruby>猫<rt>ねこ</rt></ruby>が歩く。');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await lp.waitForFunction(() => document.getElementById('read-text').value === '猫が歩く。'); await settled(lp);
    await lp.reload(); await lp.locator('#library-list .book-open').click(); await lp.locator('#open-read').click(); await settled(lp);
    assert.deepEqual((await stored(lp)).manuscripts[0].manuscript.sourceRubies, [{ start: 0, end: 1, reading: 'ねこ' }]);
    await lp.locator('.brand').click(); await lp.locator('#home [data-go=estimate]').click();
    await lp.locator('#estimate-target').fill('1e50'); await lp.locator('#estimate-minutes').fill('-1');
    await settled(lp); assert.equal((await stored(lp)).target, ''); assert.equal((await stored(lp)).plannedMinutes, '20');
    await lp.reload(); await settled(lp); assert.equal((await stored(lp)).manuscripts.length, 1, 'invalid numeric drafts cannot poison stored user data');
    await legacy.close();
    console.log('portable restore, conflict and corruption: PASS');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

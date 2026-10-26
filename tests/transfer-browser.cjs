// Run with Playwright on NODE_PATH and Chrome installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const seed = { version: 1, history: [{ characters: 200, seconds: 30, type: 'sample' }], target: 9876 };
const stored = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('reading-support-results-v1')));
const originalText = page => page.locator('#reader').evaluate(root => {
  const copy = root.cloneNode(true); copy.querySelectorAll('.reading-annotation').forEach(n => n.remove()); return copy.textContent;
});
const readings = page => page.locator('.reading-annotation').evaluateAll(nodes => {
  const values = {};
  nodes.forEach(n => values[n.dataset.offset] = (values[n.dataset.offset] || '') + n.textContent);
  return values;
});
const setDraft = (page, id, text) => page.locator(id).evaluate((el, text) => { el.value = text; el.dispatchEvent(new Event('input')); }, text);
const home = async page => {
  await page.locator('#operations').click(); await page.locator('#home-from-menu').click();
};
const transfer = async page => {
  await page.locator('#operations').click(); await page.locator('#measure-current').click();
};
const save = async page => {
  await page.locator('#operations').click();
  const promise = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
  return JSON.parse(fs.readFileSync(await (await promise).path(), 'utf8'));
};
const readonly = async page => {
  assert.equal(await page.locator('#ruby-mode').isVisible(), false);
  assert.equal(await page.locator('.reading-annotation[role="button"]').count(), 0);
  await page.locator('.reading-annotation').first().click();
  assert.equal(await page.locator('#ruby-dialog').evaluate(d => d.open), false);
  // The renderer itself enforces read-only, independently of button visibility.
  await page.locator('#ruby-mode').evaluate(b => b.click());
  assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'false');
};

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
      const url = `http://127.0.0.1:${server.address().port}/`;
      await page.goto(url);
      await page.evaluate(value => sessionStorage.setItem('reading-support-results-v1', JSON.stringify(value)), seed);
      await page.reload();
      const requestCount = requests.length;
      await page.locator('[data-go="time-input"]').click();
      await page.locator('[name=source][value=custom]').check();
      await page.locator('#time-text').fill('計測用に入力済みの別の文章');
      await page.locator('#time-input [data-go="home"]').click();
      await page.locator('[data-go="read-input"]').click();
      const source = '黄昏の空を見上げた。\n\n👩‍👩‍👧‍👦とか\u3099、𠮷【元の括弧】。\n' + '日本語の本文と句読点。'.repeat(75);
      await page.locator('#read-text').fill(source); await page.locator('#open-read').click();
      await page.locator('#ruby-mode').click();
      const point = await page.locator('#reader').evaluate(el => {
        const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
        const r = document.createRange(); r.setStart(node, 1); r.setEnd(node, 2);
        const box = r.getBoundingClientRect(); return { x: box.left + box.width * .8, y: box.top + box.height / 2 };
      });
      if (width < 600) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
      await page.locator('#ruby-input').fill('たそがれ'); await page.locator('#ruby-save').click();
      const count = await page.evaluate(text => window.countReadingCharacters(text), source);
      const data = { format: 'reading-support-manuscript', version: 1, text: source, annotations: [{ offset: 2, text: 'たそがれ' }] };
      await transfer(page);
      await page.waitForFunction(() => document.getElementById('confirm-dialog').open);
      await page.locator('#confirm-cancel').click();
      await page.waitForFunction(() => document.getElementById('operation-dialog').open);
      assert.equal(await page.locator('#reading-title').textContent(), '文章を読む');
      assert.equal(await originalText(page), source);
      assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#time-text').inputValue(), '計測用に入力済みの別の文章');
      assert.equal(await page.locator('#target-count').inputValue(), '9876');
      assert.deepEqual(await stored(page), seed);
      await page.locator('#measure-current').click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => !document.getElementById('preparation').hidden);
      assert.equal(await page.locator('#reading-title').textContent(), '朗読速度の計測');
      assert.equal(await originalText(page), source);
      assert.deepEqual(await readings(page), { 2: '【たそがれ】' });
      assert.equal(await page.locator('#time-text').inputValue(), source);
      assert.equal(await page.locator('[name=source][value=custom]').isChecked(), true);
      assert.equal(await page.locator('#preparation-target').inputValue(), String(count));
      assert.equal(await page.locator('#target-count').inputValue(), String(count));
      assert.match(await page.locator('#preparation-info').textContent(), new RegExp(`計測する本文：${count}文字`));
      assert.equal(await page.locator('#countdown').isVisible(), false);
      assert.equal(await page.locator('#measurement-bar').isVisible(), false);
      assert.deepEqual(await stored(page), seed, 'handoff does not persist manuscript or results');
      await readonly(page);
      await page.locator('#before-settings').click();
      if (width > 600) await page.locator('#reader-width').evaluate(el => { el.value = 520; el.dispatchEvent(new Event('input')); });
      await page.locator('#columns').evaluate(el => { el.value = Number(el.min) + 2; el.dispatchEvent(new Event('input')); });
      if (width < 600) await page.locator('#tab-line-height').click();
      await page.locator('#line-height').evaluate(el => { el.value = 2.1; el.dispatchEvent(new Event('input')); });
      if (width < 600) await page.locator('#tab-break-lines').click();
      await page.locator('#break-lines').evaluate(el => { el.value = 2; el.dispatchEvent(new Event('input')); });
      await page.locator('[data-close="settings-dialog"]').click();
      assert.equal(await originalText(page), source);
      assert.deepEqual(await readings(page), { 2: '【たそがれ】' });
      if (process.env.READER_TEST_ARTIFACTS) {
        fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `transfer-preparation-${width}.png`) });
      }
      // Changing the estimate never changes the measured source count.
      await page.locator('#preparation-target').fill(''); await page.locator('#start').click();
      assert.equal(await page.locator('#countdown').textContent(), '3');
      await page.locator('#reader-back').click(); await page.locator('#prepare-time').click();
      await page.locator('#preparation-target').fill(String(count * 3));
      assert.equal(await page.locator('#target-count').inputValue(), String(count * 3));
      await page.evaluate(() => window.scrollTo(0, 700));
      await page.locator('#start').click();
      assert.equal(await page.locator('#countdown').textContent(), '3');
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      assert.equal(await page.locator('#finish').isDisabled(), true);
      await page.waitForFunction(() => document.getElementById('countdown').textContent === '2');
      await page.waitForFunction(() => document.getElementById('countdown').textContent === '1');
      await page.waitForFunction(() => document.getElementById('countdown').hidden && !document.getElementById('finish').disabled);
      await readonly(page);
      await page.waitForFunction(() => document.getElementById('elapsed').textContent !== '0:00');
      await page.locator('#finish').click(); await page.locator('#results').waitFor({ state: 'visible' });
      const result = await stored(page);
      assert.deepEqual(result.history[0], seed.history[0]);
      assert.equal(result.history.length, 2);
      assert.equal(result.history[1].characters, count);
      assert.equal(result.history[1].type, 'custom');
      assert.ok(result.history[1].seconds >= 1);
      assert.equal(result.target, count * 3);
      const speed = (200 + count) / (30 + result.history[1].seconds) * 60;
      assert.match(await page.locator('#result-summary').textContent(), new RegExp(`平均${Math.round(speed).toLocaleString()}文字/分`));
      await page.locator('#result-target').fill('');
      assert.equal(await page.locator('#estimate').textContent(), `平均${Math.round(speed).toLocaleString()}文字/分`);
      await page.locator('#result-target').fill(String(count * 3));
      assert.match(await page.locator('#estimate').textContent(), /分$/);
      assert.deepEqual(Object.keys(result.history[1]).sort(), ['characters', 'seconds', 'type']);
      await page.locator('#again').click();
      assert.equal(await page.locator('#time-text').inputValue(), source);
      await page.locator('#prepare-time').click();
      assert.deepEqual(await readings(page), { 2: '【たそがれ】' });
      await home(page); await page.locator('[data-go="read-input"]').click(); await page.locator('#open-read').click();
      assert.deepEqual(await save(page), { ...data, version: 3, sourceRubies: [], marks: [] });
      // Reading-mode edits cannot change the independent timing snapshot.
      await page.locator('#ruby-mode').click(); await page.locator('.reading-annotation').first().click();
      await page.locator('#ruby-input').fill('ゆうぐれ'); await page.locator('#ruby-save').click();
      await home(page); await page.locator('[data-go="time-input"]').click(); await page.locator('#prepare-time').click();
      assert.deepEqual(await readings(page), { 2: '【たそがれ】' });
      await page.locator('#reader-back').click();
      await page.locator('[name=source][value=sample]').check(); await page.locator('#prepare-time').click();
      assert.equal(await page.locator('.reading-annotation').count(), 0);
      await page.locator('#reader-back').click(); await page.locator('[name=source][value=custom]').check();
      await page.locator('#prepare-time').click(); assert.deepEqual(await readings(page), { 2: '【たそがれ】' });
      await page.locator('#reader-back').click();
      await setDraft(page, '#time-text', source + '変更'); await page.locator('#prepare-time').click();
      await page.waitForFunction(() => document.getElementById('confirm-dialog').open);
      await page.locator('#confirm-cancel').click();
      assert.equal(await page.locator('#time-text').inputValue(), source + '変更');
      await setDraft(page, '#time-text', source); await page.locator('#prepare-time').click();
      assert.deepEqual(await readings(page), { 2: '【たそがれ】' });
      await page.locator('#reader-back').click(); await setDraft(page, '#time-text', source + '変更');
      await page.locator('#prepare-time').click(); await page.locator('#confirm-ok').click();
      await page.locator('#reading').waitFor({ state: 'visible' });
      assert.equal(await originalText(page), source + '変更');
      assert.equal(await page.locator('.reading-annotation').count(), 0);
      await home(page); await page.locator('[data-go="read-input"]').click(); await page.locator('#open-read').click();
      data.annotations[0].text = 'ゆうぐれ'; assert.deepEqual(await save(page), { ...data, version: 3, sourceRubies: [], marks: [] });
      // Equal existing timing text needs no confirmation and resets old targets.
      await home(page); await page.locator('[data-go="time-input"]').click();
      await setDraft(page, '#time-text', source);
      await homeFromInput(page);
      await page.locator('[data-go="read-input"]').click(); await page.locator('#open-read').click();
      await transfer(page);
      assert.equal(await page.locator('#confirm-dialog').evaluate(d => d.open), false);
      assert.equal(await page.locator('#preparation-target').inputValue(), String(count));
      assert.deepEqual(await readings(page), { 2: '【ゆうぐれ】' });
      assert.equal(requests.length, requestCount);
      assert.deepEqual(errors, []);
      await context.close();
      // JSON manuscripts preserve CRLF, emoji and annotations after input round trips.
      const jsonContext = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600, acceptDownloads: true });
      const jp = await jsonContext.newPage(); jp.setDefaultTimeout(8000);
      await jp.goto(url); await jp.locator('[data-go="read-input"]').click();
      const jsonSource = '黄昏\r\n\r\n👩‍👩‍👧‍👦か\u3099𠮷【括弧】\r次の行。';
      const manuscript = { format: data.format, version: 1, text: jsonSource, annotations: [{ offset: 2, text: 'たそがれ' }, { offset: jsonSource.indexOf('か'), text: 'かぞく' }] };
      await jp.locator('#manuscript-file').setInputFiles({ name: 'reading-manuscript.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manuscript)) });
      await jp.locator('#reading').waitFor({ state: 'visible' });
      const expected = await readings(jp);
      await transfer(jp); await jp.locator('#preparation').waitFor({ state: 'visible' });
      assert.equal(await originalText(jp), jsonSource); assert.deepEqual(await readings(jp), expected);
      await readonly(jp);
      await jp.locator('#reader-back').click();
      assert.equal(await jp.locator('#time-text').inputValue(), jsonSource.replace(/\r\n?/g, '\n'));
      await jp.locator('#prepare-time').click();
      assert.equal(await originalText(jp), jsonSource); assert.deepEqual(await readings(jp), expected);
      await home(jp); await jp.locator('[data-go="read-input"]').click(); await jp.locator('#open-read').click();
      assert.deepEqual(await save(jp), { ...manuscript, version: 3, sourceRubies: [], marks: [] });
      // Plain text follows the same handoff, without inventing annotations.
      await jp.locator('#reader-back').click();
      const plain = { format: data.format, version: 1, text: '本文だけの原稿。', annotations: [] };
      await jp.locator('#manuscript-file').setInputFiles({ name: 'plain.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plain)) });
      await jp.locator('#confirm-ok').click(); await jp.locator('#reading').waitFor({ state: 'visible' });
      await transfer(jp); await jp.locator('#confirm-ok').click();
      await jp.locator('#preparation').waitFor({ state: 'visible' });
      assert.equal(await originalText(jp), plain.text);
      assert.equal(await jp.locator('.reading-annotation').count(), 0);
      // An empty imported source cannot initialize a zero-character measurement.
      await home(jp); await jp.locator('[data-go="read-input"]').click();
      const empty = { ...plain, text: '' };
      await jp.locator('#manuscript-file').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty)) });
      await jp.locator('#confirm-ok').click(); await jp.locator('#reading').waitFor({ state: 'visible' });
      await transfer(jp);
      assert.equal(await jp.locator('#reading-title').textContent(), '文章を読む');
      assert.equal(await jp.locator('#time-text').inputValue(), plain.text);
      assert.equal(await jp.locator('#countdown').isVisible(), false);
      await jsonContext.close();
      console.log(`PASS ${width}px: handoff, overwrite protection, read-only annotations, countdown/results, independent originals, JSON/CRLF round trips`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());

async function homeFromInput(page) { await page.locator('#time-input [data-go="home"]').click(); }

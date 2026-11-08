// Run with Playwright on NODE_PATH and Chrome installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew } = require('./file-session.cjs');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, name)));
});
const key = 'yomijitaku-user-v1';
const fixture = {
  format: 'yomijitaku-user', version: 1, profile: { name: '朗読する人' },
  manuscripts: [{ id: 'book', title: '大切な原稿', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    draft: '黄昏の空。', manuscript: { format: 'reading-support-manuscript', version: 3, text: '黄昏の空。',
      annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [], marks: [{ id: 1, type: 'marker', start: 0, end: 2, color: 'pink' }] }, pending: null }],
  activeId: 'book', history: [{ characters: 200, seconds: 30, type: 'sample', measuredAt: null, title: '一回目' },
    { characters: 400, seconds: 90, type: 'custom', measuredAt: null, title: '二回目' }], target: '4500', plannedMinutes: '20'
};
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const text = (page, id) => page.locator('#' + id).textContent();
const contextIs = async (page, completed) => {
  assert.equal(await text(page, 'result-title'), completed ? '計測結果' : 'あなたの朗読記録');
  for (const id of ['result-steps', 'again', 'retry-measurement']) assert.equal(await page.locator('#' + id).isVisible(), completed, id);
  assert.equal(await page.locator('#results').getByRole('button', { name: '朗読速度を測る', exact: true }).count(), completed ? 0 : 1);
  if (completed) {
    assert.equal(await page.locator('#result-steps li').count(), 4);
    assert.match(await page.locator('#result-steps [aria-current=step]').textContent(), /4\/4結果現在/);
  }
  for (const id of ['average-speed', 'speed-estimate', 'time-estimate', 'history-count']) assert.equal(await page.locator('#' + id).isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
};
const measure = async page => {
  await page.locator('#prepare-time').click();
  await page.locator('#start').click();
  await page.waitForFunction(() => !document.getElementById('finish').disabled);
  await page.waitForTimeout(120);
  await page.locator('#finish').click();
  await contextIs(page, true);
};
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 768, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ key, fixture }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(fixture)); }, { key, fixture });
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page);
      const manuscript = await page.evaluate(key => window.UserLibrary.parse(localStorage.getItem(key)).manuscripts, key);
      assert.equal(await text(page, 'home-average-speed'), '約300文字 / 分');
      await page.getByRole('button', { name: '朗読記録を見る →', exact: true }).click();
      await contextIs(page, false);
      assert.equal(await text(page, 'average-speed'), '約300文字 / 分');
      assert.equal(await text(page, 'speed-estimate'), '約6,000文字');
      assert.equal(await text(page, 'time-estimate'), '約15分');
      await page.locator('#planned-minutes').fill('10'); await page.locator('#result-target').fill('9000');
      await page.locator('#records-measure').click();
      await page.locator('[name=source][value=custom]').check();
      await page.locator('#time-text').fill('あいうえお。かきくけこ。');
      await measure(page);
      // Completion still uses all records, including the two unequal-duration fixtures.
      const records = (await stored(page)).history;
      assert.equal(records.length, 3);
      const speed = records.reduce((sum, r) => sum + r.characters, 0) / records.reduce((sum, r) => sum + r.seconds, 0) * 60;
      assert.equal(await text(page, 'average-speed'), `約${Math.round(speed).toLocaleString()}文字 / 分`);
      await page.locator('#planned-minutes').fill('15'); await contextIs(page, true);
      assert.equal(await page.locator('#result-target').inputValue(), '9000');
      await page.locator('#again').click();
      assert.equal(await page.locator('#time-text').inputValue(), 'あいうえお。かきくけこ。');
      await page.locator('#existing-results').click(); await contextIs(page, false);
      await page.locator('#records-measure').click(); await measure(page);
      await page.locator('#retry-measurement').click();
      assert.equal(await page.locator('#preparation').isVisible(), true);
      await page.locator('#start').click(); await page.waitForFunction(() => !document.getElementById('finish').disabled);
      await page.locator('#finish').click(); await contextIs(page, true);
      await page.locator('#results [data-go=home]').click();
      await page.locator('#home-results [data-go=results]').click(); await contextIs(page, false);
      await page.locator('#results [data-go=estimate]').click();
      await page.locator('#estimate-results').click(); await contextIs(page, false);
      assert.equal(await page.locator('#result-target').inputValue(), '9000');
      assert.equal(await page.locator('#planned-minutes').inputValue(), '15');
      await page.locator('.history-section summary').click();
      await page.locator('#history button').first().click(); await contextIs(page, false);
      assert.equal((await stored(page)).history.length, 4);
      await page.reload(); await startNew(page);
      await page.locator('#home-results [data-go=results]').click(); await contextIs(page, false);
      assert.equal(await page.locator('#result-target').inputValue(), '9000');
      assert.equal(await page.locator('#planned-minutes').inputValue(), '15');
      assert.deepEqual((await stored(page)).manuscripts, manuscript, 'manuscript, ruby and marks survive');
      if (process.env.READER_TEST_ARTIFACTS) {
        fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `records-${width}.png`), fullPage: true });
      }
      await page.locator('.history-section summary').click();
      await page.locator('#reset-history').click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => document.getElementById('average-speed').textContent === '未計測');
      assert.equal(await page.locator('#result-steps').isVisible(), false);
      assert.equal(await page.locator('#result-empty').isVisible(), true);
      assert.equal(await page.locator('#results').getByRole('button', { name: '朗読速度を測る', exact: true }).count(), 1);
      assert.deepEqual(errors, []); await context.close();
      console.log(`result context ${width}px passed`);
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

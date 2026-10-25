// Run with Playwright on NODE_PATH and Chrome installed; no production dependency.
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
const storageKey = 'reading-support-results-v1';
const stored = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey);
const textOf = (page, id) => page.locator('#' + id).textContent();
const completeMeasurement = async page => {
  await page.locator('#start').click();
  assert.equal(await textOf(page, 'countdown'), '3');
  await page.waitForFunction(() => !document.getElementById('finish').disabled);
  await page.waitForTimeout(120);
  await page.locator('#finish').click();
  assert.equal(await page.locator('#results').isVisible(), true);
};
const fits = async page => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
const shot = async (page, name) => {
  if (!process.env.READER_TEST_ARTIFACTS) return;
  fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, name + '.png'), fullPage: true });
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const widths = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1200, 768, 390, 320];
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600, acceptDownloads: true });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors = [], external = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (!r.url().startsWith(`http://127.0.0.1:${server.address().port}/`)) external.push(r.url()); });
      const url = `http://127.0.0.1:${server.address().port}/`;
      await page.goto(url);
      assert.equal(await page.locator('#home .entry').count(), 3);
      await fits(page); await shot(page, `home-${width}`);

      // First visit: no invented speed; an estimate draft survives measuring custom text.
      await page.locator('#home [data-go=estimate]').click();
      assert.equal(await textOf(page, 'estimate-average-speed'), '未計測');
      assert.equal(await page.locator('#estimate-empty').isVisible(), true);
      await page.locator('#estimate-target').fill('4500');
      await fits(page); await shot(page, `estimate-empty-${width}`);
      await page.locator('#estimate-empty [data-go=time-input]').click();
      await page.locator('[name=source][value=custom]').check();
      const customText = 'あいうえお。かきくけこ。さしすせそ。';
      await page.locator('#time-text').fill(customText);
      assert.equal(await page.locator('#sample-options').isVisible(), false);
      assert.equal(await page.locator('#target-count').count(), 0);
      await page.locator('#prepare-time').click();
      await page.locator('#preparation-partial-enabled').check();
      await page.locator('#preparation-partial-limit').fill('5');
      assert.match(await textOf(page, 'preparation-info'), /実際に読む文字数：6文字/);
      await page.locator('#preparation-partial-limit').fill('0');
      assert.equal(await page.locator('#start').isDisabled(), true);
      await page.locator('#preparation-partial-limit').fill('5');
      await completeMeasurement(page);
      assert.equal((await stored(page)).history[0].characters, 6);
      assert.equal(await page.locator('#result-target').inputValue(), '4500');
      for (const id of ['average-speed', 'speed-estimate', 'time-estimate']) assert.equal(await page.locator('#' + id).isVisible(), true);
      assert.equal(await page.locator('#results [role=tab]').count(), 0);
      await page.locator('#again').click();
      assert.equal(await page.locator('#time-text').inputValue(), customText);
      // Retry uses the retained manuscript, and cancellation saves no record.
      await page.locator('#existing-results').click();
      await page.locator('#retry-measurement').click();
      await page.locator('#start').click();
      await page.locator('#reader-back').click();
      assert.equal((await stored(page)).history.length, 1);
      assert.equal(await page.locator('#time-text').inputValue(), customText);
      await page.locator('#time-input [data-go=home]').click();
      // Fresh sample path, with no work-count input, reaches results directly.
      await page.locator('#home [data-go=time-input]').click();
      await page.locator('[name=source][value=sample]').check();
      await page.locator('#sample-level').selectOption('200');
      await page.locator('#sample-mood').selectOption('ゆったり');
      await fits(page);
      await page.locator('#prepare-time').click();
      await completeMeasurement(page);
      assert.equal((await stored(page)).history.at(-1).type, 'sample');

      // Known unequal-duration records prove weighted averaging and shared calculations.
      await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), {
        key: storageKey, value: { version: 1, history: [{ characters: 200, seconds: 30, type: 'sample' }, { characters: 400, seconds: 90, type: 'custom' }], target: null, plannedMinutes: 20 }
      });
      await page.reload();
      await page.locator('#home [data-go=estimate]').click();
      assert.equal(await textOf(page, 'estimate-average-speed'), '約300文字 / 分');
      assert.equal(await textOf(page, 'estimate-capacity'), '約6,000文字');
      assert.equal(await textOf(page, 'estimate-time'), '作品の文字数を入力してください');
      await page.locator('#estimate-target').fill('4500');
      assert.equal(await textOf(page, 'estimate-time'), '約15分');
      await page.locator('#estimate-minutes').fill('10.5');
      assert.equal(await textOf(page, 'estimate-capacity'), '約3,150文字');
      await fits(page); await shot(page, `estimate-${width}`);
      await page.locator('#estimate-results').click();
      assert.equal(await page.locator('#result-target').inputValue(), '4500');
      assert.equal(await page.locator('#planned-minutes').inputValue(), '10.5');
      await page.locator('#result-target').fill('9000');
      assert.equal(await textOf(page, 'time-estimate'), '約30分');
      await page.locator('#result-target').fill('-1');
      assert.equal(await textOf(page, 'time-estimate'), '作品の文字数を正しく入力してください');
      await page.locator('#result-target').fill('4500');
      await page.locator('#planned-minutes').fill('0');
      assert.equal(await textOf(page, 'speed-estimate'), '予定時間を正しく入力してください');
      await page.locator('#planned-minutes').fill('20');
      await fits(page); await shot(page, `results-${width}`);
      await page.locator('.history-section summary').click();
      await page.locator('#history button').first().click();
      assert.equal(await textOf(page, 'average-speed'), '約267文字 / 分');
      assert.equal(await textOf(page, 'speed-estimate'), '約5,333文字');
      await page.locator('#reset-history').click(); await page.locator('#confirm-cancel').click();
      await page.waitForTimeout(100); // The native dialog close event resolves the confirmation asynchronously.
      assert.equal((await stored(page)).history.length, 1);
      await page.locator('#reset-history').click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => document.getElementById('average-speed').textContent === '未計測');
      assert.equal(await textOf(page, 'average-speed'), '未計測');
      assert.equal(await page.locator('#result-empty').isVisible(), true);
      await page.locator('#results [data-go=estimate]').click();
      assert.equal(await page.locator('#estimate-empty').isVisible(), true);
      assert.equal(await page.locator('#estimate-target').inputValue(), '4500');
      await page.reload(); await page.locator('#home [data-go=estimate]').click();
      assert.equal(await page.locator('#estimate-target').inputValue(), '4500');

      // A marked manuscript returns intact through results, estimate, and deletion.
      await page.locator('#estimate [data-go=home]').click();
      await page.locator('#home [data-go=read-input]').click();
      const manuscript = { format: 'reading-support-manuscript', version: 3,
        text: '黄昏に狐が現れた。\r\n' + '静かな森で読む。'.repeat(150),
        annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 3, end: 4, reading: 'きつね' }], marks: [
          { id: 1, type: 'marker', start: 0, end: 2, color: 'pink' },
          { id: 2, type: 'memo', offset: 3, dx: .4, dy: 0, text: 'ゆっくり' },
          { id: 3, type: 'pen', offset: 0, layoutKey: '30:1.8:0:0', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], witnesses: [{ offset: 0, x: 0, y: 0 }] }
        ] };
      await page.locator('#manuscript-file').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manuscript)) });
      await page.locator('#reading').waitFor({ state: 'visible' });
      await page.locator('#paper-mode').click();
      await page.locator('#toolbar-settings').click();
      await page.locator('#columns').evaluate(el => { el.value = Number(el.min) + 1; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
      await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => !document.getElementById('confirm-dialog').open);
      await page.locator('[data-close=settings-dialog]').click();
      const originalColumns = await page.locator('#columns').inputValue();
      const marksBefore = await page.evaluate(() => window.ManuscriptWriting.printSnapshot());
      const baselineDownload = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
      const baseline = JSON.parse(fs.readFileSync(await (await baselineDownload).path(), 'utf8'));
      await page.evaluate(() => scrollTo(0, 600));
      const scrollBefore = await page.evaluate(() => scrollY);
      await page.locator('#measure-current').evaluate(el => el.click());
      assert.equal(await page.locator('#writing-mode').isVisible(), false);
      assert.equal(await page.locator('#export-pdf').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => window.ManuscriptWriting.printSnapshot()), marksBefore);
      await completeMeasurement(page);
      const count = await page.evaluate(t => window.countReadingCharacters(t), manuscript.text);
      assert.equal(await page.locator('#result-target').inputValue(), String(count));
      assert.equal(await textOf(page, 'again'), '原稿に戻る');
      await page.locator('#retry-measurement').click();
      await completeMeasurement(page);
      await page.locator('.history-section summary').click();
      await page.locator('#reset-history').click(); await page.locator('#confirm-ok').click();
      await page.waitForFunction(() => document.getElementById('average-speed').textContent === '未計測');
      assert.equal(await textOf(page, 'again'), '原稿に戻る');
      await page.locator('#results [data-go=estimate]').click();
      await page.locator('#estimate-return').click();
      await page.waitForTimeout(150);
      assert.deepEqual(await page.evaluate(() => window.ManuscriptWriting.printSnapshot()), marksBefore);
      assert.equal(await page.locator('#columns').inputValue(), originalColumns);
      assert.equal(await page.locator('#paper-mode').getAttribute('aria-pressed'), 'true');
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - scrollBefore) < 120, 'scroll position restored');
      const download = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
      const saved = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
      assert.deepEqual(saved, baseline, 'JSON, source rubies, annotations and all marks survive measurement');
      await page.locator('#export-pdf').click(); await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
      assert.ok(await page.locator('#manuscript-print').textContent());
      if (process.env.READER_TEST_ARTIFACTS && width === 1200) {
        await page.evaluate(() => { window.print = () => {}; });
        await page.locator('#pdf-print').click();
        await page.pdf({ path: path.join(process.env.READER_TEST_ARTIFACTS, 'restored-manuscript.pdf'), preferCSSPageSize: true, printBackground: true });
        await page.evaluate(() => dispatchEvent(new Event('afterprint')));
      } else await page.locator('#pdf-cancel').click();
      await page.locator('.brand').click();
      assert.equal(await page.locator('#save-navigation-dialog').isVisible(), true);
      await page.locator('#save-navigation-cancel').click();
      assert.equal(await page.locator('#reading').isVisible(), true);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), {});
      assert.ok(!JSON.stringify(await stored(page)).includes('黄昏'), 'source text is never stored');
      await context.close();
      console.log(`purpose flow ${width}px passed`);
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

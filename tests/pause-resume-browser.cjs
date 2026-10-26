// Chrome + Playwright on NODE_PATH. A controlled browser clock verifies exact active time.
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
const records = page => page.evaluate(() => JSON.parse(localStorage.getItem('yomijitaku-user-v1'))?.history || []);
const text = (page, id) => page.locator('#' + id).textContent();
const invoke = (page, id) => page.locator('#' + id).evaluate(el => el.onclick());
const snapshot = page => page.evaluate(() => window.ManuscriptWriting.printSnapshot());
const state = async (page, expected) => {
  assert.equal(await text(page, 'reader-state'), expected);
  assert.equal(await text(page, 'measurement-status'), expected);
  assert.match(await page.locator('#reader-steps [aria-current=step]').textContent(), /3\/4.*測る/);
};
const paused = async page => {
  await page.locator('#pause-measurement').click();
  await state(page, '一時停止中');
  assert.equal(await text(page, 'pause-measurement'), '再開');
  assert.equal(await page.locator('#finish').isDisabled(), true);
  assert.equal(await page.locator('#countdown').isVisible(), false);
};
const resume = async (page, frozen) => {
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.locator('#pause-measurement').click();
  await state(page, '再開準備中');
  assert.equal(await page.locator('#finish').isDisabled(), true);
  assert.equal(await page.locator('#pause-measurement').isDisabled(), true);
  // Even bypassing disabled DOM controls cannot start duplicate timers or finish.
  await invoke(page, 'pause-measurement'); await invoke(page, 'start'); await invoke(page, 'finish');
  for (const count of ['3', '2', '1']) {
    assert.equal(await text(page, 'countdown'), count);
    assert.equal(await text(page, 'elapsed'), frozen);
    await page.clock.runFor(1000);
  }
  await state(page, '計測中');
  assert.equal(await text(page, 'elapsed'), frozen);
  assert.equal(await text(page, 'pause-measurement'), '一時停止');
  assert.equal(await page.locator('#finish').isDisabled(), false);
  assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'resuming keeps the reading position');
};
const start = async page => {
  await page.locator('#start').click();
  for (const count of ['3', '2', '1']) {
    assert.equal(await text(page, 'countdown'), count);
    assert.equal(await page.locator('#finish').isDisabled(), true);
    assert.equal(await page.locator('#pause-measurement').isDisabled(), true);
    await page.clock.runFor(1000);
  }
  await state(page, '計測中');
  assert.equal(await text(page, 'elapsed'), '0:00');
};
const screenshot = async (page, name) => {
  if (!process.env.READER_TEST_ARTIFACTS) return;
  fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, name + '.png') });
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 768, 390, 320]) {
      for (const partial of [false, true]) {
        const context = await browser.newContext({ viewport: { width, height: 850 }, isMobile: width < 600, hasTouch: width < 600 });
        const page = await context.newPage(); page.setDefaultTimeout(8000);
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date('2026-10-26T00:00:00Z') });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.clock.pauseAt(new Date('2026-10-26T00:01:00Z'));
        await page.locator('#home [data-go=read-input]').click();
        const manuscript = { format: 'reading-support-manuscript', version: 3,
          text: '黄昏の空。' + 'あいうえお。'.repeat(120),
          sourceRubies: [{ start: 0, end: 2, reading: 'たそがれ' }], annotations: [{ offset: 3, text: 'そら' }],
          marks: [{ id: 1, type: 'marker', start: 0, end: 2, color: 'pink' }, { id: 2, type: 'memo', offset: 3, dx: .4, dy: 0, text: 'ゆっくり' }] };
        await page.locator('#manuscript-file').setInputFiles({ name: 'pause.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manuscript)) });
        await page.clock.runFor(50);
        const before = await snapshot(page);
        await page.locator('#measure-current').click();
        await page.clock.runFor(50);
        if (partial) {
          await page.locator('#preparation-partial-enabled').check();
          await page.locator('#preparation-partial-limit').fill('4');
          assert.match(await text(page, 'preparation-info'), /実際に読む文字数：5文字/);
        }
        const expectedCount = partial ? 5 : await page.evaluate(t => window.countReadingCharacters(t), manuscript.text);
        await start(page);
        await page.clock.runFor(1250);
        await paused(page);
        assert.equal(await text(page, 'elapsed'), '0:01');
        await page.clock.runFor(5000);
        await invoke(page, 'finish');
        assert.equal(await text(page, 'elapsed'), '0:01');
        assert.equal((await records(page)).length, 0);
        const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight);
        await page.evaluate(() => scrollTo(0, 400)); await page.clock.runFor(50);
        if (scrollable) assert.ok(await page.evaluate(() => scrollY > 0), 'paused manuscript remains scrollable');
        await screenshot(page, `paused-${width}-${partial ? 'partial' : 'full'}`);
        await resume(page, '0:01');
        await page.clock.runFor(750);
        await paused(page);
        assert.equal(await text(page, 'elapsed'), '0:02');
        await page.clock.runFor(10000);
        await resume(page, '0:02');
        await page.clock.runFor(2000);
        assert.equal(await text(page, 'elapsed'), '0:04');
        assert.equal(await text(page, 'finish'), partial ? '計測終了' : '読了');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
        for (const id of ['pause-measurement', 'finish']) {
          const box = await page.locator('#' + id).boundingBox();
          assert.ok(box.height >= 44 && box.width >= 44, 'touch targets remain usable');
        }
        await page.locator('#finish').click();
        const record = (await records(page))[0];
        assert.equal(record.characters, expectedCount);
        assert.equal(record.seconds, 4, 'only 1.25 + .75 + 2 active seconds are saved');
        assert.equal(await text(page, 'average-speed'), `約${(expectedCount / 4 * 60).toLocaleString()}文字 / 分`);
        await page.locator('#again').click(); await page.clock.runFor(50);
        assert.deepEqual(await snapshot(page), before, 'original annotations and marks survive paused measurement');
        assert.equal(await page.locator('#read-text').inputValue(), manuscript.text);
        assert.equal(await text(page, 'reader-state'), '原稿編集中');

        // Paused visibility loss and resuming page departure both discard all elapsed time.
        await page.locator('#measure-current').click(); await page.clock.runFor(50);
        for (const interruption of ['paused', 'resuming']) {
          await start(page); await page.clock.runFor(750); await paused(page);
          if (interruption === 'resuming') {
            await page.locator('#pause-measurement').click(); await page.clock.runFor(1000);
            await page.evaluate(() => dispatchEvent(new Event('pagehide')));
          } else {
            await page.evaluate(() => {
              Object.defineProperty(document, 'hidden', { configurable: true, value: true });
              document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;
            });
          }
          await page.clock.runFor(10000);
          assert.equal(await text(page, 'reader-state'), '計測準備');
          assert.equal(await page.locator('#measurement-bar').isVisible(), false);
          assert.equal(await page.locator('#countdown').isVisible(), false);
          assert.equal((await records(page)).length, 1);
          await invoke(page, 'pause-measurement'); await invoke(page, 'finish');
          assert.equal((await records(page)).length, 1, 'a discarded measurement cannot resume or finish');
        }
        await start(page); await page.clock.runFor(1000); await page.locator('#finish').click();
        assert.equal((await records(page)).at(-1).seconds, 1, 'the next measurement starts with no accumulated time');
        assert.equal(await text(page, 'again'), '原稿に戻る');
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`pause/resume ${width}px ${partial ? 'partial' : 'full'} passed`);
      }
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

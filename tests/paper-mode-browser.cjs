// Paper colours must never become a new layout, manuscript field or global theme.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..'), output = path.join(directory, 'tmp/pdfs');
const files = ['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'app.js'];
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!files.includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const choose = (page, data) => page.locator('#manuscript-file').setInputFiles({ name: 'paper-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
const complete = page => page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
const home = async page => { await page.locator('#operations').click(); await page.locator('#home-from-menu').click(); };
const save = async page => {
  await page.locator('#operations').click(); const pending = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
  return JSON.parse(fs.readFileSync(await (await pending).path(), 'utf8'));
};
const openPaper = async (page, width) => {
  await page.locator('#operations').click(); await page.locator('#open-settings').click();
  if (width < 600) await page.locator('#tab-paper').click();
  await settle(page);
};
const paper = page => page.locator('#reader-stage').evaluate(el => el.classList.contains('paper-mode'));
const toggle = async (page, width) => { await openPaper(page, width); await page.locator('#paper-mode').click(); await page.locator('[data-close=settings-dialog]').click(); await settle(page); };
const snapshot = page => page.evaluate(() => {
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  return { html: document.getElementById('reader').innerHTML, style: document.getElementById('reader').getAttribute('style'),
    reader: rect(document.getElementById('reader')), stage: rect(document.getElementById('reader-stage')),
    printed: window.Reader.printSnapshot(), writing: window.ManuscriptWriting.printSnapshot(),
    pen: document.getElementById('writing-pen').innerHTML, markers: document.getElementById('writing-markers').innerHTML,
    memos: [...document.querySelectorAll('.writing-memo')].map(el => ({ text: el.textContent, rect: rect(el) })),
    scroll: scrollY, anchor: window.Reader.capture(), enabled: window.ManuscriptWriting.enabled,
    undo: document.getElementById('writing-undo').disabled,
    storage: JSON.stringify([{ ...localStorage }, { ...sessionStorage }]) };
});
const colours = page => page.evaluate(() => {
  const style = (selector, name) => getComputedStyle(document.querySelector(selector))[name];
  return { stage: style('#reader-stage', 'backgroundColor'), text: style('#reader', 'color'),
    readerBackground: style('#reader', 'backgroundColor'), rt: style('#reader rt', 'color'),
    annotation: style('#reader .reading-annotation', 'color'), pen: style('#writing-pen path', 'stroke'),
    markers: [...document.querySelectorAll('#writing-markers rect')].map(el => getComputedStyle(el).fill),
    memo: style('.writing-memo', 'color'), memoBackground: style('.writing-memo', 'backgroundColor'),
    site: style('html', 'backgroundColor'), toolbar: style('.reader-toolbar', 'backgroundColor') };
});
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
      const url = `http://127.0.0.1:${server.address().port}/`; await page.goto(url); await page.locator('[data-go=read-input]').click();
      const text = '黄昏に狐が現れた。\r\n\r\n👩‍👩‍👧‍👦とが、𠮷【原文】。\n' + Array.from({ length: 44 }, (_, i) => `章${i}：風の音を聞いて、静かに今日のことを語る。\n`).join('');
      const data = { format: 'reading-support-manuscript', version: 3, text, annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 3, end: 4, reading: 'きつね' }],
        marks: [{ id: 1, type: 'marker', start: 0, end: 2 },
          { id: 2, type: 'marker', start: text.indexOf('章0'), end: text.indexOf('章1'), color: 'lightblue' },
          { id: 3, type: 'marker', start: text.indexOf('章1'), end: text.indexOf('章2'), color: 'pink' },
          { id: 4, type: 'memo', offset: 3, dx: .4, dy: 0, text: '少し大きく' }] };
      await choose(page, data); await complete(page);
      const pen = await page.evaluate(() => ({ id: 5, type: 'pen', offset: 3, layoutKey: window.Reader.getWritingGeometry().layoutKey,
        points: [{ x: -1, y: .5 }, { x: 2, y: -.5 }, { x: 3, y: .4 }], witnesses: [{ offset: 3, x: 0, y: 0 }] }));
      data.marks.push(pen);
      await page.locator('#reader-back').click(); await choose(page, data); await page.locator('#confirm-ok').click(); await complete(page);
      await page.locator('#operations').click(); await page.locator('#writing-mode').click(); await page.locator('[data-writing-tool=memo]').click();
      await page.locator('.writing-memo').click(); await page.locator('#writing-memo-input').fill('少し大きく！'); await page.locator('#writing-memo-save').click();
      const original = await save(page); assert.equal(original.version, 3); assert.equal(await paper(page), false);
      await page.evaluate(() => scrollTo(0, 450)); const anchor = await page.evaluate(() => window.Reader.capture());
      await openPaper(page, width);
      if (width < 600) {
        const panel = await page.locator('#settings-dialog').evaluate(el => ({ height: el.getBoundingClientRect().height, width: el.clientWidth, scroll: el.scrollWidth, tabs: [...el.querySelectorAll('[role=tab]')].map(b => b.getBoundingClientRect().height) }));
        assert.ok(panel.height <= 260 && panel.width === panel.scroll); assert.ok(panel.tabs.every(h => h <= 42), 'four compact tabs fit');
      }
      const before = await snapshot(page), dark = await colours(page);
      await page.evaluate(() => { window.paperGeometry = window.Reader.getWritingGeometry(); window.paperLayouts = 0; document.getElementById('reader').addEventListener('reader-layout', () => window.paperLayouts++); });
      await page.locator('#paper-mode').click(); await settle(page);
      assert.equal(await page.locator('#paper-mode').textContent(), '原稿表示：ON'); assert.equal(await page.locator('#paper-mode').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await snapshot(page), before, 'paint-only switch preserves DOM, every glyph/vector, offsets, scroll, history, Storage');
      assert.equal(await page.evaluate(() => window.Reader.getWritingGeometry() === window.paperGeometry && window.paperLayouts === 0), true);
      const white = await colours(page);
      assert.equal(white.stage, 'rgb(255, 255, 255)'); assert.equal(white.text, 'rgb(23, 25, 29)'); assert.equal(white.rt, white.text);
      assert.equal(white.annotation, 'rgb(23, 54, 93)'); assert.equal(white.pen, 'rgb(197, 34, 40)');
      assert.equal(white.memo, 'rgb(139, 30, 36)'); assert.equal(white.memoBackground, 'rgb(255, 255, 255)');
      assert.equal(white.readerBackground, 'rgba(0, 0, 0, 0)', 'white is below markers, not on the text overlay');
      assert.equal(white.site, dark.site); assert.equal(white.toolbar, dark.toolbar);
      for (const fill of ['rgb(255, 229, 136)', 'rgb(189, 233, 250)', 'rgb(255, 208, 223)']) assert.ok(white.markers.includes(fill));
      await page.locator('#paper-mode').click(); await settle(page); assert.deepEqual(await colours(page), dark); assert.deepEqual(await snapshot(page), before);
      await page.locator('#paper-mode').click(); await page.locator('[data-close=settings-dialog]').click(); await settle(page);
      const returned = await page.evaluate(() => window.Reader.capture()); assert.equal(returned.offset, anchor.offset); assert.ok(Math.abs(returned.y - anchor.y) < 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, `paper-screen-${width}.png`) });
      // The independent print tree must be identical in both screen themes.
      let frozen;
      for (const name of ['on', 'off']) {
        if (name === 'off') await toggle(page, width);
        const state = await snapshot(page);
        await page.locator('#operations').click(); await page.locator('#export-pdf').click(); await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
        const html = await page.locator('#manuscript-print').innerHTML();
        if (name === 'on') frozen = html; else assert.equal(html, frozen, 'theme never enters PDF coordinates, fonts or colours');
        await page.locator('#pdf-cancel').click(); assert.equal(await paper(page), name === 'on'); assert.deepEqual(await snapshot(page), state);
        await page.locator('#operations').click(); await page.locator('#export-pdf').click(); await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
        await page.evaluate(() => { window.print = () => {}; }); await page.locator('#pdf-print').click(); await page.emulateMedia({ media: 'print' });
        await page.pdf({ path: path.join(output, `paper-${width}-${name}.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
        await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => dispatchEvent(new Event('afterprint'))); await settle(page);
        assert.equal(await paper(page), name === 'on'); assert.deepEqual(await snapshot(page), state);
        assert.deepEqual(await save(page), original);
      }
      await toggle(page, width); assert.equal(await paper(page), true);
      await page.locator('#operations').click(); await page.locator('#measure-current').click(); await page.locator('#preparation').waitFor({ state: 'visible' });
      assert.equal(await paper(page), true); assert.deepEqual((await page.evaluate(() => window.ManuscriptWriting.printSnapshot())).items, original.marks);
      assert.equal(await page.locator('.writing-memo').evaluate(el => el.tagName), 'DIV');
      assert.equal(await page.locator('.writing-memo').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
      await toggle(page, width); assert.equal(await paper(page), false); await toggle(page, width); assert.equal(await paper(page), true);
      await page.locator('#start').click(); assert.equal(await paper(page), true);
      await page.locator('#paper-mode').evaluate(el => el.click()); assert.equal(await paper(page), true, 'cannot change while counting');
      await page.waitForFunction(() => !document.getElementById('finish').disabled && document.getElementById('countdown').hidden);
      await page.locator('#paper-mode').evaluate(el => el.click()); assert.equal(await paper(page), true, 'cannot change while measuring');
      assert.equal(await page.locator('#open-settings').isDisabled(), true);
      await page.locator('#finish').click(); await page.locator('#results').waitFor({ state: 'visible' }); await page.locator('#again').click(); await page.locator('#prepare-time').click(); assert.equal(await paper(page), true);
      await page.locator('#reader-back').click(); await page.locator('[name=source][value=sample]').check(); await page.locator('#prepare-time').click(); assert.equal(await paper(page), false, 'no forced white example');
      await page.locator('#reader-back').click(); await page.locator('[name=source][value=custom]').check(); await page.locator('#prepare-time').click(); assert.equal(await paper(page), true);
      await page.locator('#reader-back').click(); await page.locator('#time-text').evaluate(el => { el.value += '別の文章'; el.dispatchEvent(new Event('input')); });
      await page.locator('#prepare-time').click(); await page.locator('#confirm-cancel').click();
      await page.locator('#time-text').evaluate((el, text) => { el.value = text; el.dispatchEvent(new Event('input')); }, text);
      await page.locator('#prepare-time').click(); assert.equal(await paper(page), true, 'cancel preserves original theme');
      await page.locator('#reader-back').click(); await page.locator('#time-text').evaluate(el => { el.value += '別の文章'; el.dispatchEvent(new Event('input')); });
      await page.locator('#prepare-time').click(); await page.locator('#confirm-ok').click(); await page.locator('#reading').waitFor({ state: 'visible' }); assert.equal(await paper(page), false, 'different custom manuscript starts dark');
      await home(page); await page.locator('[data-go=read-input]').click(); await page.locator('#open-read').click(); assert.equal(await paper(page), true);
      await toggle(page, width); await page.locator('#operations').click(); await page.locator('#measure-current').click(); await page.locator('#confirm-ok').click(); await page.locator('#reading').waitFor({ state: 'visible' }); assert.equal(await paper(page), false, 'OFF also hands off');
      await page.reload(); await page.locator('[data-go=read-input]').click(); await choose(page, original); await complete(page); assert.equal(await paper(page), false, 'reload and JSON do not restore a theme');
      assert.deepEqual(await save(page), original); assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
      assert.deepEqual(errors, []); assert.equal(requests.filter(r => !r.startsWith(url)).length, 0);
      console.log(`PASS ${width}px: paint-only geometry/cache/scroll, 3 colours/rubies/memo, compact settings, isolated timing/retest theme, unchanged JSON/PDF, refresh reset`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

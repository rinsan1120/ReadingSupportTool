// Playwright on NODE_PATH, Chrome installed. ClipboardEvent supplies the same
// HTML/plain MIME payloads as browser paste without using the system clipboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/aozora-ruby.html'), 'utf8');
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const paste = (page, html, start = 0, end = null, id = 'read-text') => page.locator(`#${id}`).evaluate((el, { html, start, end }) => {
  el.focus(); el.setSelectionRange(start, end ?? el.value.length);
  const data = new DataTransfer(); data.setData('text/html', html); data.setData('text/plain', '狐（きつね）');
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}, { html, start, end });
const source = page => page.locator('#reader').evaluate(root => {
  const copy = root.cloneNode(true); copy.querySelectorAll('rt,.reading-annotation').forEach(n => n.remove()); return copy.textContent;
});
const readings = page => page.locator('#reader rt').allTextContents();
const save = async page => {
  await page.locator('#operations').click();
  const pending = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
  const download = await pending; return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
};
const choose = async (page, data, confirm = false) => {
  await page.locator('#manuscript-file').setInputFiles({ name: 'ruby.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  if (confirm) await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
};
const verifyLayout = async (page, breaks) => {
  const result = await page.locator('#reader').evaluate((root, breaks) => {
    const range = document.createRange();
    let overlaps = 0, example = null;
    const counts = [...root.querySelectorAll('.line-segment')].map(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), centers = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest('rt')) continue;
        for (const s of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(node.data)) {
          if (!s.segment.trim()) continue;
          range.setStart(node, s.index); range.setEnd(node, s.index + s.segment.length);
          const r = range.getBoundingClientRect(), center = r.top + r.height / 2;
          if (!centers.some(y => Math.abs(y - center) < 8)) centers.push(center);
        }
      }
      return centers.length;
    });
    const bases = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest('rt') || !node.data.trim()) continue;
      range.selectNodeContents(node); bases.push(...[...range.getClientRects()].filter(r => r.width));
    }
    for (const rt of root.querySelectorAll('rt')) {
      const reading = rt.getBoundingClientRect();
      range.selectNodeContents(rt.parentElement.firstChild);
      const ownBase = range.getBoundingClientRect(), center = ownBase.top + ownBase.height / 2;
      for (const base of bases) {
        // Native ruby glyph boxes include font ascent/descent whitespace and
        // may intersect their OWN base box. Check adjacent display lines.
        if (Math.abs(base.top + base.height / 2 - center) < 8) continue;
        if (Math.min(reading.right, base.right) - Math.max(reading.left, base.left) > 1 &&
          Math.min(reading.bottom, base.bottom) - Math.max(reading.top, base.top) > 1) { overlaps++; example ||= { rt: rt.textContent, reading: reading.toJSON(), base: base.toJSON() }; }
      }
    }
    return { counts, overlaps, example, overflow: root.scrollWidth > root.clientWidth + 1, status: document.getElementById('layout-status').textContent };
  }, breaks);
  assert.equal(result.status, '', 'ruby retains auto-spacing rather than triggering fallback');
  assert.ok(result.counts.length > 1);
  assert.ok(result.counts.every(n => n <= breaks), `visual base lines per group: ${result.counts}`);
  if (result.overlaps && process.env.READER_TEST_ARTIFACTS) await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, 'source-ruby-overlap.png') });
  assert.equal(result.overlaps, 0, `readings never intersect adjacent body lines: ${JSON.stringify(result.example)}`);
  assert.equal(result.overflow, false);
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const storage = () => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      const initialStorage = await storage(), initialRequests = requests.length;
      if (process.env.SOURCE_RUBY_REFERENCE) {
        const reference = fs.readFileSync(process.env.SOURCE_RUBY_REFERENCE, 'utf8');
        const result = await page.evaluate(html => {
          const template = document.createElement('template'); template.innerHTML = html;
          const original = [...template.content.querySelectorAll('ruby')].map(r => ({ base: r.querySelector('rb').textContent, reading: r.querySelector('rt').textContent }));
          const model = window.HTMLRubyImporter.parse(html);
          return { original, imported: model.sourceRubies.map(r => ({ base: model.source.slice(r.start, r.end), reading: r.reading })) };
        }, reference);
        assert.deepEqual(result.imported, result.original);
        assert.ok(result.imported.length > 50);
        console.log(`Reference page: all ${result.imported.length} ruby ranges/readings match`);
      }
      const parsed = await page.evaluate(html => window.HTMLRubyImporter.parse(html).toJSON(), fixture);
      const words = ['狐', '棲', '或朝', '洞穴', '眼', '抑'];
      assert.deepEqual(parsed.sourceRubies.map(r => parsed.text.slice(r.start, r.end)), words);
      assert.deepEqual(parsed.sourceRubies.map(r => r.reading), ['きつね', 'す', 'あるあさ', 'ほらあな', 'め', 'おさ']);
      assert.equal(parsed.text, '　寒い冬が北方から、狐の親子の棲んでいる森へもやって来ました。\n　或朝洞穴から子供の狐が出ようとしましたが、\n「あっ」と叫んで眼を抑えながら母さん狐のところへころげて来ました。');
      // Formatting whitespace is collapsed like HTML; br/empty blocks/pre retain
      // explicit line breaks, and offsets always refer to that extracted source.
      const cases = [
        ['前<ruby>狐<rt>きつね</rt></ruby>後<br><br>　末', '前狐後\n\n　末', ['狐']],
        ['<p>親<ruby>東<rt>とう</rt>京<rt>きょう</rt></ruby></p><p></p><p>末</p>', '親東京\n\n末', ['東', '京']],
        ['<ruby><rb>東</rb><rb>京</rb><rt>とう</rt><rt>きょう</rt></ruby>', '東京', ['東', '京']],
        ['<pre> \t👩‍👩‍👧‍👦\n\n<ruby>が<rt>が</rt></ruby>  𠮷</pre>', ' \t👩‍👩‍👧‍👦\n\nが  𠮷', ['が']],
        ['<div> a   <ruby><span>狐</span><rt><b>きつね</b></rt></ruby> b </div>', 'a 狐 b ', ['狐']]
      ];
      for (const [html, text, targets] of cases) {
        const data = await page.evaluate(html => window.HTMLRubyImporter.parse(html).toJSON(), html);
        assert.equal(data.text, text); assert.deepEqual(data.sourceRubies.map(r => data.text.slice(r.start, r.end)), targets);
      }
      await page.locator('[data-go="read-input"]').click();
      await paste(page, fixture);
      assert.equal(await page.locator('#read-text').inputValue(), parsed.text);
      assert.equal(await page.locator('#notice').textContent(), '元の読み仮名を6件取り込みました');
      await page.locator('#open-read').click();
      assert.equal(await source(page), parsed.text); assert.deepEqual(await readings(page), parsed.sourceRubies.map(r => r.reading));
      const count = await page.evaluate(text => window.countReadingCharacters(text), parsed.text);
      assert.equal(await page.locator('#read-count').textContent(), `${count}文字`);
      assert.deepEqual(await save(page), { ...parsed, version: 3, marks: [] });
      // The original manual edit UI works inside a multi-character ruby base.
      await page.locator('#ruby-mode').click();
      const at = await page.locator('#reader ruby').filter({ hasText: '或朝' }).evaluate(el => {
        const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 1);
        const rect = r.getBoundingClientRect(); return { x: rect.left + rect.width * .8, y: rect.top + rect.height / 2 };
      });
      if (width < 600) await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y);
      await page.locator('#ruby-input').fill('手動'); await page.locator('#ruby-save').click();
      let edited = await save(page);
      assert.equal(edited.annotations[0].offset, parsed.text.indexOf('或朝') + 1);
      assert.deepEqual(edited.sourceRubies, parsed.sourceRubies);
      assert.equal(await source(page), parsed.text);
      assert.match(await page.locator('#reader').textContent(), /或朝あるあさ【手動】/);
      await page.locator('.reading-annotation').click(); await page.locator('#ruby-input').fill('追記'); await page.locator('#ruby-save').click();
      edited = await save(page);
      assert.equal(edited.annotations[0].text, '追記');
      const endPoint = await page.locator('#reader ruby').filter({ hasText: '或朝' }).evaluate(el => {
        const r = document.createRange(); r.setStart(el.firstChild, 1); r.setEnd(el.firstChild, 2);
        const rect = r.getBoundingClientRect(); return { x: rect.left + rect.width * .8, y: rect.top + rect.height / 2 };
      });
      if (width < 600) await page.touchscreen.tap(endPoint.x, endPoint.y); else await page.mouse.click(endPoint.x, endPoint.y);
      const pendingEndOffset = await page.locator('.annotation-draft').getAttribute('data-offset');
      assert.equal(Number(pendingEndOffset), parsed.text.indexOf('或朝') + 2, `word end tap ${width}px at ${JSON.stringify(endPoint)}`);
      await page.locator('#ruby-input').fill('語末'); await page.locator('#ruby-save').click();
      const withEnd = await save(page);
      assert.deepEqual(withEnd.annotations.map(a => a.offset), [parsed.text.indexOf('或朝') + 1, parsed.text.indexOf('或朝') + 2]);
      await page.locator(`.reading-annotation[data-offset="${parsed.text.indexOf('或朝') + 2}"]`).click();
      await page.locator('#ruby-delete').click(); assert.deepEqual(await save(page), edited);
      // Partial rich paste refuses to detach or shift retained annotations.
      await page.locator('#reader-back').click(); await paste(page, '<ruby>森<rt>もり</rt></ruby>', 1, 2);
      assert.match(await page.locator('#notice').textContent(), /途中にはHTMLルビ/);
      assert.equal(await page.locator('#read-text').inputValue(), parsed.text);
      await paste(page, fixture); await page.locator('#confirm-cancel').click();
      await page.locator('#open-read').click(); assert.deepEqual(await save(page), edited);
      // A late invalid range must leave both the model and input untouched.
      await page.locator('#reader-back').click();
      await choose(page, { ...edited, sourceRubies: [...edited.sourceRubies, { start: 0, end: edited.text.length, reading: '不正' }] });
      assert.match(await page.locator('#notice').textContent(), /原稿を読み込めません/);
      await page.locator('#open-read').click(); assert.deepEqual(await save(page), edited);
      // JSON v2 restores both kinds and produces an independent timing copy.
      await page.reload(); await page.locator('[data-go="read-input"]').click(); await choose(page, edited);
      assert.deepEqual(await save(page), edited);
      await page.locator('#operations').click(); await page.locator('#measure-current').click();
      assert.equal(await source(page), parsed.text); assert.deepEqual(await readings(page), parsed.sourceRubies.map(r => r.reading));
      assert.equal(await page.locator('#time-text').inputValue(), parsed.text);
      assert.equal(await page.locator('#preparation-target').inputValue(), String(count));
      assert.match(await page.locator('#preparation-info').textContent(), new RegExp(`本文：${count}文字`));
      assert.equal(await page.locator('#ruby-mode').isVisible(), false);
      await page.locator('#reader rt').first().click(); await page.locator('.reading-annotation').click();
      assert.equal(await page.locator('#ruby-dialog').evaluate(el => el.open), false);
      assert.equal(await page.locator('#countdown').isVisible(), false);
      await page.locator('#reader-back').click(); await page.locator('#prepare-time').click();
      assert.deepEqual(await readings(page), parsed.sourceRubies.map(r => r.reading));
      await page.locator('#reader-back').click();
      await page.locator('#time-text').evaluate(el => { el.value += '変更'; el.dispatchEvent(new Event('input')); });
      await page.locator('#prepare-time').click(); await page.locator('#confirm-ok').click();
      await page.locator('#reading').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#reader rt').count(), 0);
      await page.locator('#operations').click(); await page.locator('#home-from-menu').click();
      await page.locator('[data-go="read-input"]').click(); await page.locator('#open-read').click();
      assert.deepEqual(await save(page), edited, 'timing changes do not mutate reading manuscript');
      // Long source ruby text exercises wrapping, grouping, gaps and restoration.
      const fragment = fixture.split('<!--StartFragment-->')[1].split('<!--EndFragment-->')[0];
      const longHTML = (fragment + '<br><br>').repeat(12);
      await page.locator('#reader-back').click(); await paste(page, longHTML); await page.locator('#confirm-ok').click();
      await page.locator('#open-read').click();
      const long = await save(page); assert.equal(long.sourceRubies.length, 72);
      for (const height of [1.2, 1.8, 2.2]) {
        await page.evaluate(height => window.Reader.configure({ width: 520, height, breaks: 2, columns: 18 }), height);
        assert.equal(await source(page), long.text); await verifyLayout(page, 2);
      }
      await page.evaluate(() => window.scrollTo(0, 750));
      const anchor = await page.evaluate(() => window.Reader.capture());
      await page.evaluate(() => window.Reader.configure({ width: 600, columns: 22, height: 1.5, breaks: 3 }));
      const restored = await page.evaluate(anchor => {
        const r = document.getElementById('reader'), walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT), range = document.createRange();
        let n, offset = 0;
        while ((n = walker.nextNode())) {
          if (n.parentElement.closest('rt,.reading-annotation')) continue;
          if (offset <= anchor.offset && anchor.offset < offset + n.length) {
            range.setStart(n, anchor.offset - offset); range.setEnd(n, anchor.offset - offset + 1); return range.getBoundingClientRect().top;
          }
          offset += n.length;
        }
      }, anchor);
      assert.ok(Math.abs(restored - anchor.y) < 80, 'configuration restores original source anchor');
      await verifyLayout(page, 3);
      if (process.env.READER_TEST_ARTIFACTS) {
        fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `source-ruby-${width}.png`) });
      }
      // Unsafe elements never execute or fetch; unsupported ruby leaves state intact.
      await page.locator('#reader-back').click();
      await paste(page, '<ruby>森<rt>もり</rt></ruby><script>window.pasteExecuted=1</script><img src="https://invalid.example/track" onerror="window.pasteExecuted=1"><iframe src="https://invalid.example/frame"></iframe>');
      await page.locator('#confirm-ok').click(); await page.locator('#open-read').click();
      assert.equal(await source(page), '森'); assert.deepEqual(await readings(page), ['もり']);
      assert.equal(await page.evaluate(() => window.pasteExecuted), undefined);
      const safe = await save(page); await page.locator('#reader-back').click();
      for (const html of ['<ruby>親<ruby>子<rt>こ</rt></ruby><rt>おやこ</rt></ruby>', '<ruby>狐<rtc><rt>きつね</rt></rtc></ruby>', '<ruby>狐<rt></rt></ruby>']) {
        await paste(page, html); assert.match(await page.locator('#notice').textContent(), /取り込めません/);
        assert.equal(await page.locator('#read-text').inputValue(), '森');
        assert.equal(await page.locator('#confirm-dialog').evaluate(d => d.open), false);
      }
      await page.locator('#open-read').click(); assert.deepEqual(await save(page), safe);
      await page.locator('#reader-back').click();
      await page.locator('#read-text').evaluate(el => { el.value += '変更'; el.dispatchEvent(new Event('input')); });
      await page.locator('#open-read').click(); await page.locator('#confirm-cancel').click();
      await page.locator('#read-text').evaluate(el => { el.value = '森'; el.dispatchEvent(new Event('input')); });
      await page.locator('#open-read').click(); assert.deepEqual(await save(page), safe, 'source-only ruby survives canceled plain-text change');
      // Partial import into unannotated text adjusts UTF-16 offsets, including
      // emoji before the inserted ruby. Direct timing input supports it too.
      await page.reload(); await page.locator('[data-go="read-input"]').click();
      await page.locator('#read-text').fill('👩‍👩‍👧‍👦前後');
      const insertion = '👩‍👩‍👧‍👦前'.length;
      await paste(page, '<ruby>狐<rt>きつね</rt></ruby>', insertion, insertion);
      await page.locator('#open-read').click();
      const partial = await save(page);
      assert.equal(partial.text, '👩‍👩‍👧‍👦前狐後');
      assert.deepEqual(partial.sourceRubies, [{ start: insertion, end: insertion + 1, reading: 'きつね' }]);
      await page.locator('#operations').click(); await page.locator('#home-from-menu').click();
      await page.locator('[data-go="time-input"]').click();
      await page.locator('[name=source][value=custom]').check();
      await paste(page, '<ruby>森<rt>もり</rt></ruby>', 0, null, 'time-text');
      await page.locator('#prepare-time').click();
      assert.equal(await source(page), '森'); assert.deepEqual(await readings(page), ['もり']);
      assert.equal(await page.locator('#ruby-mode').isVisible(), false);
      assert.equal(await storage(), initialStorage);
      // Reload requested static files once more; no pasted URLs or requests with manuscript data.
      assert.equal(requests.filter(url => !url.startsWith(`http://127.0.0.1:${server.address().port}/`)).length, 0);
      assert.ok(requests.length >= initialRequests); assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: Aozora HTML, ruby ranges, manual overlap/editing, JSON v2, timing, line layout, safe paste and manuscript protection`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());

// Run with Playwright available on NODE_PATH (no production dependency).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-print.js', 'app.js'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('[data-go="read-input"]').click();
      const source = '黄昏の空を見上げた。\n\nもとの【括弧】と👩‍👩‍👧‍👦、か\u3099、𠮷。\n' + '日本語の本文と「句読点」、表示行を確認します。'.repeat(65);
      await page.locator('#read-text').fill(source);
      const replaceInput = async text => {
        // Set an edited draft directly: Playwright fill emits beforeinput with
        // null data, which the pre-existing full-replacement handler cancels.
        await page.locator('#read-text').evaluate((el, value) => {
          el.value = value; el.dispatchEvent(new Event('input'));
        }, text);
      };
      const originalCount = await page.locator('#read-count').textContent();
      await page.locator('#open-read').click();
      const dialogOpen = () => page.locator('#ruby-dialog').evaluate(d => d.open);
      const sourceRect = async offset => page.evaluate(offset => {
        const root = document.getElementById('reader');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n, count = 0;
        while ((n = walker.nextNode())) {
          if (n.parentElement.closest('.reading-annotation')) continue;
          if (count < offset && count + n.length >= offset) {
            const segments = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(n.data)];
            const end = offset - count;
            const start = segments.filter(s => s.index < end).at(-1).index;
            const range = document.createRange(); range.setStart(n, start); range.setEnd(n, end);
            const r = range.getBoundingClientRect();
            return { x: r.left + r.width * .8, y: r.top + r.height * .5, top: r.top };
          }
          count += n.length;
        }
        throw new Error(`No source position ${offset}`);
      }, offset);
      const tapSource = async offset => {
        let rect = await sourceRect(offset);
        if (rect.y < 100 || rect.y > 700) {
          await page.evaluate(top => window.scrollBy(0, top - 250), rect.top);
          rect = await sourceRect(offset);
        }
        if (width < 600) await page.touchscreen.tap(rect.x, rect.y);
        else await page.mouse.click(rect.x, rect.y);
      };
      const renderedSource = () => page.locator('#reader').evaluate(root => {
        const copy = root.cloneNode(true); copy.querySelectorAll('.reading-annotation').forEach(n => n.remove()); return copy.textContent;
      });
      await tapSource(2);
      assert.equal(await dialogOpen(), false, 'OFF ignores source tap');
      await page.locator('#ruby-mode').click();
      await tapSource(2);
      assert.equal(await dialogOpen(), true);
      assert.equal(await page.locator('.annotation-draft').textContent(), '【】');
      assert.equal(await page.locator('#ruby-save').isDisabled(), true);
      await page.locator('#ruby-input').fill('　 ');
      assert.equal(await page.locator('#ruby-save').isDisabled(), true);
      await page.locator('#ruby-cancel').click();
      assert.equal(await page.locator('.reading-annotation').count(), 0);
      await tapSource(2);
      await page.locator('#ruby-input').fill('たそがれ');
      const imePrevented = await page.locator('#ruby-input').evaluate(el => !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true, bubbles: true })));
      assert.equal(imePrevented, true, 'IME conversion Enter is not submit');
      if (width < 600) {
        // Emulate the reduced visual viewport while a software keyboard is up.
        await page.setViewportSize({ width, height: 340 });
        await page.waitForFunction(() => document.getElementById('ruby-save').getBoundingClientRect().bottom <= window.visualViewport.height);
        const bounds = await page.locator('#ruby-dialog').boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 340);
        if (process.env.READER_TEST_ARTIFACTS) {
          fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
          await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `ruby-editor-${width}.png`) });
        }
        await page.setViewportSize({ width, height: 844 });
      }
      await page.locator('#ruby-save').click();
      assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'true');
      assert.ok((await page.locator('#reader').textContent()).startsWith('黄昏【たそがれ】の空'));
      assert.equal(await renderedSource(), source);
      if (process.env.READER_TEST_ARTIFACTS) {
        fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `ruby-added-${width}.png`) });
      }
      await page.locator('.reading-annotation').first().click();
      await page.locator('#ruby-input').fill('ゆうぐれ');
      await page.locator('#ruby-cancel').click();
      assert.equal(await page.locator('.reading-annotation').first().textContent(), '【たそがれ】');
      await page.locator('.reading-annotation').first().click();
      await page.locator('#ruby-input').fill('ゆうぐれ');
      await page.locator('#ruby-save').click();
      assert.equal(await page.locator('.reading-annotation').first().textContent(), '【ゆうぐれ】');
      const emojiEnd = source.indexOf('、か');
      await tapSource(emojiEnd);
      await page.locator('#ruby-input').fill('<img src=x onerror=alert(1)>');
      await page.locator('#ruby-save').click();
      assert.equal(await page.locator('#reader img').count(), 0, 'annotation input is text, not HTML');
      assert.equal(await renderedSource(), source);
      const toolbar = await page.locator('.reader-toolbar').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert.equal(toolbar.scroll, toolbar.width, 'toolbar fits');
      // Blank area after a short line must not use a nearby caret position.
      const r = await sourceRect(11);
      await page.mouse.click(width - 25, r.y);
      assert.equal(await dialogOpen(), false, 'line-end whitespace ignored');
      // A drag and a pointercancel represent selection and native touch scrolling.
      const p = await sourceRect(2);
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + 45, p.y + 30); await page.mouse.up();
      assert.equal(await dialogOpen(), false, 'drag ignored');
      if (width < 600) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y - 90 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await dialogOpen(), false, 'native touch scroll ignored');
        await cdp.detach();
      }
      await page.locator('#ruby-mode').click();
      await page.locator('.reading-annotation').first().click();
      assert.equal(await dialogOpen(), false, 'OFF ignores existing annotation');
      await page.locator('#reader-back').click();
      assert.equal(await page.locator('#read-text').inputValue(), source);
      assert.equal(await page.locator('#read-count').textContent(), originalCount);
      await page.locator('#open-read').click();
      assert.equal(await page.locator('.reading-annotation').count(), 2, 'same source reopens with readings');
      await page.locator('#ruby-mode').click();
      await page.locator('.reading-annotation').first().click();
      await page.locator('#ruby-delete').click();
      assert.equal(await page.locator('.reading-annotation').count(), 1);
      assert.equal(await renderedSource(), source);
      // Reflow: annotation crossing line and group boundaries, original blank lines,
      // actual visual line counts and an anchor in the middle of the document.
      await page.evaluate(() => window.Reader.configure({ breaks: 2 }));
      await page.evaluate(() => window.scrollTo(0, 650));
      await tapSource(100);
      const before = await page.evaluate(() => window.Reader.capture());
      await page.locator('#ruby-input').fill('ながいよみがな'.repeat(20));
      await page.locator('#ruby-save').click();
      const after = await page.evaluate(() => window.Reader.capture());
      assert.ok(Math.abs(after.offset - before.offset) < 50, 'registration keeps the original reading position');
      assert.ok(Math.abs(after.y - before.y) < 50, 'registration keeps its screen position');
      assert.equal(await renderedSource(), source);
      const anchor = await page.evaluate(() => window.Reader.capture());
      await page.evaluate(() => window.Reader.configure({ width: 520, columns: 18, height: 2.2 }));
      const restored = await sourceRect(Math.max(1, anchor.offset));
      assert.ok(Math.abs(restored.top - anchor.y) < 90, 'settings restore the same original source position');
      assert.equal(await renderedSource(), source);
      assert.equal(await page.locator('.natural-gap').textContent(), '\n\n');
      assert.equal(await page.locator('#layout-status').textContent(), '', 'normal Japanese retains automatic groups');
      const lineCounts = await page.locator('.line-segment').evaluateAll(segments => segments.map(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const centers = [];
        for (const r of range.getClientRects()) {
          if (!r.width) continue;
          const y = r.top + r.height / 2;
          if (!centers.some(v => Math.abs(v - y) < 10)) centers.push(y);
        }
        return centers.length;
      }));
      assert.ok(lineCounts.every(n => n <= 2), `actual group lines: ${lineCounts}`);
      if (process.env.READER_TEST_ARTIFACTS) {
        fs.mkdirSync(process.env.READER_TEST_ARTIFACTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.READER_TEST_ARTIFACTS, `reader-${width}.png`) });
      }
      // Replacement confirmation cancellation preserves the old model.
      await page.locator('#reader-back').click();
      await replaceInput('差し替えた文章');
      await page.locator('#open-read').click();
      assert.equal(await page.locator('#confirm-dialog').evaluate(d => d.open), true);
      assert.match(await page.locator('#confirm-message').textContent(), /読み仮名.*削除/);
      await page.locator('#confirm-cancel').click();
      await replaceInput(source);
      await page.locator('#open-read').click();
      assert.equal(await page.locator('#reading').isVisible(), true);
      assert.ok(await page.locator('.reading-annotation').count() >= 2);
      // Timing has no ruby UI or annotations and does not discard read-mode data.
      await page.locator('#operations').click(); await page.locator('#home-from-menu').click();
      await page.locator('[data-go="time-input"]').click();
      await page.locator('#target-count').fill('2000');
      await page.locator('#prepare-time').click();
      assert.equal(await page.locator('#ruby-mode').isVisible(), false);
      assert.equal(await page.locator('.reading-annotation').count(), 0);
      // Endpoints, CRLF/blank lines and graphemes at paragraph boundaries use
      // ORIGINAL UTF-16 coordinates in the composed display.
      const edgeCase = await page.evaluate(() => {
        const source = '👩‍👩‍👧‍👦か\u3099\r\n\r\n𠮷末';
        const model = new window.ReadingAnnotations(source);
        model.set(0, '先頭');
        model.set(source.indexOf('\r'), '前段末');
        model.set(source.indexOf('𠮷'), '次段頭');
        model.set(source.length, '末尾');
        window.Reader.show(source, model);
        const root = document.getElementById('reader');
        const text = root.textContent;
        const copy = root.cloneNode(true); copy.querySelectorAll('.reading-annotation').forEach(n => n.remove());
        return { text, original: copy.textContent, source };
      });
      assert.equal(edgeCase.original, edgeCase.source);
      assert.equal(edgeCase.text, '【先頭】👩‍👩‍👧‍👦か\u3099【前段末】\r\n\r\n【次段頭】𠮷末【末尾】');
      const longAnchor = await page.evaluate(() => {
        const model = new window.ReadingAnnotations('黄昏の空。' + '日本語の本文。'.repeat(120));
        model.set(2, 'ながいよみがな'.repeat(80));
        window.Reader.show(model.source, model);
        // Locate the reading itself; preparation controls vary with viewport.
        window.scrollTo(0, window.scrollY + document.getElementById('reader').getBoundingClientRect().top + 300);
        const before = window.Reader.capture();
        const annotationTop = index => {
          for (const span of document.querySelectorAll('.reading-annotation[data-offset="2"]')) {
            const node = span.firstChild;
            if (index < node.length) {
              const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
              return range.getBoundingClientRect().top;
            }
            index -= node.length;
          }
          throw new Error(`Missing anchored annotation character: ${JSON.stringify({ index, before })}`);
        };
        const glyphBefore = annotationTop(before.annotationIndex);
        window.Reader.configure({ height: 1.8 });
        return { before, after: window.Reader.capture(), glyphBefore, glyphAfter: annotationTop(before.annotationIndex) };
      });
      assert.equal(longAnchor.before.offset, 2);
      assert.ok(longAnchor.before.annotationIndex > 0, 'anchor is inside a wrapped reading');
      assert.equal(longAnchor.after.offset, longAnchor.before.offset);
      // A preceding line can become partially visible when spacing shrinks.
      // Verify the saved character's screen position, not the next capture's line.
      assert.ok(Math.abs(longAnchor.glyphBefore - longAnchor.glyphAfter) < 2);
      await page.locator('#operations').click(); await page.locator('#home-from-menu').click();
      await page.locator('[data-go="read-input"]').click(); await page.locator('#open-read').click();
      assert.ok(await page.locator('.reading-annotation').count() >= 2);
      await page.locator('#reader-back').click();
      await replaceInput('差し替えた文章'); await page.locator('#open-read').click();
      await page.locator('#confirm-ok').click();
      await page.locator('#reading').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#reader').textContent(), '差し替えた文章');
      assert.equal(await page.locator('.reading-annotation').count(), 0);
      const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
      assert.ok(!JSON.stringify(storage).includes('よみがな'));
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: CRUD, Unicode/source, count, retention, confirmation, timing isolation, reflow, gestures`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());

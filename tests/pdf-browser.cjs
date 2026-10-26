// Playwright + Chrome. Outputs synthetic PDF fixtures under tmp/pdfs for QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..'), output = path.join(directory, 'tmp/pdfs');
const files = ['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js'];
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!files.includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const compact = text => text.normalize('NFC').replace(/\s/gu, '');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const manifest = [];
  try {
    for (const [width, textWidth, fontSize, breaks] of [[1200, 900, 22, 5], [390, 900, 22, 3], [320, 900, 26, 5], [1680, 1400, 18, 5]]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('[data-go="read-input"]').click();
      const text = '\r\n黄昏の空。\t次の語と【原文の括弧】。👩‍👩‍👧‍👦か\u3099𠮷。\r\n\r\n' + Array.from({ length: 85 }, (_, i) => `章${String(i).padStart(3, '0')}：風の音を聞き、今日のことを静かに語った。${i % 9 === 0 ? '\r\n \t\r\n' : i % 4 === 0 ? '\n' : ''}`).join('') + '\n最終ページ確認。';
      const annotations = [{ offset: text.indexOf('昏') + 1, text: 'たそがれ' },
        { offset: text.indexOf('章020') + 4, text: 'ながいよみがな'.repeat(12) },
        { offset: text.indexOf(' \t') + 1, text: '空行の読み' },
        { offset: text.length, text: '<b>おわり</b>' }].sort((a, b) => a.offset - b.offset);
      const data = { format: 'reading-support-manuscript', version: 1, text, annotations };
      await page.locator('#manuscript-file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.locator('#reading').waitFor({ state: 'visible' });
      await page.evaluate(({ textWidth, fontSize, breaks }) => {
        window.Reader.configure({ width: textWidth, height: 2.2, breaks });
        window.Reader.configure({ columns: document.getElementById('reader').getBoundingClientRect().width / fontSize });
      }, { textWidth, fontSize, breaks });
      // Unregistered edits must never enter an export or destroy edit state.
      await page.locator('#ruby-mode').click();
      await page.locator('.reading-annotation').first().click();
      await page.locator('#ruby-input').fill('未登録の変更');
      assert.equal(await page.evaluate(() => { try { window.Reader.printSnapshot(); return false; } catch { return true; } }), true);
      assert.equal(await page.locator('#ruby-input').inputValue(), '未登録の変更');
      await page.locator('#ruby-cancel').click();
      await page.evaluate(() => window.scrollTo(0, 450));
      const before = await page.evaluate(() => ({ html: document.getElementById('reader').innerHTML, style: document.getElementById('reader').getAttribute('style'), count: document.getElementById('read-count').textContent, anchor: window.Reader.capture(), storage: JSON.stringify([{ ...localStorage }, { ...sessionStorage }]) }));
      const requestCount = requests.length;
      const open = async () => {
        await page.locator('#operations').click(); await page.locator('#export-pdf').click();
        await page.waitForFunction(() => document.getElementById('pdf-dialog').open);
      };
      await open();
      assert.equal(await page.locator('#pdf-small-warning').isVisible(), width === 1680);
      await page.locator('#pdf-cancel').click();
      await page.waitForFunction(() => !document.getElementById('manuscript-print').children.length);
      assert.equal(await page.locator('#reader').innerHTML(), before.html);
      const cancelledAnchor = await page.evaluate(() => window.Reader.capture());
      assert.equal(cancelledAnchor.offset, before.anchor.offset);
      assert.ok(Math.abs(cancelledAnchor.y - before.anchor.y) < 2);
      await open();
      const snapshot = await page.evaluate(() => window.Reader.printSnapshot());
      const sourceLines = snapshot.lines.filter(l => l.pieces.some(p => p.text.trim()));
      await page.evaluate(() => { window.printCalls = 0; window.print = () => { window.printCalls++; }; });
      await page.locator('#pdf-print').click();
      assert.equal(await page.evaluate(() => window.printCalls), 1);
      assert.equal(await page.locator('#reader').innerHTML(), before.html);
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('.site-header').isVisible(), false);
      assert.equal(await page.locator('#reader').isVisible(), false);
      const geometry = await page.locator('.manuscript-page').evaluateAll(sheets => sheets.map((sheet, pageIndex) => {
        const page = sheet.getBoundingClientRect();
        const canvas = sheet.firstChild, scale = Number(canvas.dataset.scale);
        return { width: page.width, height: page.height, scale, lines: [...sheet.querySelectorAll('.manuscript-line')].map(row => ({
          text: row.textContent,
          pieces: [...row.children].map(span => {
            const range = document.createRange(); range.selectNodeContents(span);
            const r = range.getBoundingClientRect();
            return { text: span.textContent, annotation: span.dataset.annotation, page: pageIndex, left: r.left - page.left, top: r.top - page.top, bottom: r.bottom - page.top, color: getComputedStyle(span).color };
          })
        })) };
      }));
      assert.ok(geometry.length >= 2, 'exercise multiple pages');
      const rows = geometry.flatMap(p => p.lines);
      assert.equal(rows.length, sourceLines.length, 'no line duplicated or dropped');
      rows.forEach((row, i) => {
        assert.equal(row.text, sourceLines[i].pieces.map(p => p.text).join(''), 'frozen wrapping');
        row.pieces.forEach((piece, j) => {
          const sheet = geometry[piece.page];
          const expectedLeft = (sheet.width - snapshot.width * sheet.scale) / 2 + sourceLines[i].pieces[j].left * sheet.scale;
          assert.ok(Math.abs(piece.left - expectedLeft) < .15, 'frozen horizontal positions');
        });
      });
      const notePages = new Map();
      geometry.forEach(sheet => sheet.lines.forEach(row => row.pieces.forEach(p => {
        assert.ok(p.top >= -.5 && p.bottom <= sheet.height + .5, `glyph outside page: ${JSON.stringify(p)}`);
        if (p.annotation !== undefined) {
          if (notePages.has(p.annotation)) assert.equal(notePages.get(p.annotation), p.page, 'annotation cannot split across pages');
          notePages.set(p.annotation, p.page); assert.equal(p.color, 'rgb(23, 54, 93)');
        } else assert.equal(p.color, 'rgb(0, 0, 0)');
      })));
      // Relative line spacing stays identical except where a page boundary wins.
      let index = 0;
      for (const sheet of geometry) {
        for (let i = 1; i < sheet.lines.length; i++) {
          const actual = sheet.lines[i].pieces[0].top - sheet.lines[i - 1].pieces[0].top;
          const expected = (sourceLines[index + i].pieces[0].top - sourceLines[index + i - 1].pieces[0].top) * sheet.scale;
          assert.ok(Math.abs(actual - expected) < .15, `line spacing: ${actual} vs ${expected}`);
        }
        index += sheet.lines.length;
      }
      const expectedText = rows.map(row => row.text).join('');
      let composed = '', cursor = 0;
      for (const a of annotations) { composed += text.slice(cursor, a.offset) + `【${a.text}】`; cursor = a.offset; }
      composed += text.slice(cursor);
      assert.equal(compact(expectedText), compact(composed));
      assert.equal(await page.locator('#manuscript-print img, #manuscript-print b').count(), 0);
      const filename = `manuscript-${width}.pdf`;
      await page.pdf({ path: path.join(output, filename), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      manifest.push({ filename, pages: geometry.map(p => p.lines.map(l => l.text).join('')), expectedText, scale: geometry[0].scale });
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const restoredAnchor = await page.evaluate(() => window.Reader.capture());
      assert.equal(restoredAnchor.offset, before.anchor.offset);
      assert.ok(Math.abs(restoredAnchor.y - before.anchor.y) < 2);
      assert.equal(await page.locator('#reader').innerHTML(), before.html);
      assert.equal(await page.locator('#reader').getAttribute('style'), before.style);
      assert.equal(await page.locator('#read-count').textContent(), before.count);
      assert.equal(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }])), before.storage);
      assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#ruby-dialog').evaluate(d => d.open), false);
      assert.equal(requests.length, requestCount);
      assert.deepEqual(errors, []);
      await page.locator('#operations').click(); await page.locator('#measure-current').click();
      assert.equal(await page.locator('#export-pdf').isVisible(), false);
      console.log(`PASS ${width}px: ${geometry.length} pages, frozen lines, annotation groups, colour, cancellation, UI/data preserved`);
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());

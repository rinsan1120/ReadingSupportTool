// Native ruby + both manual readings and vector writing in real printed PDFs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..'), output = path.join(directory, 'tmp/pdfs');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/aozora-ruby.html'), 'utf8');
const files = ['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js'];
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!files.includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const choose = async (page, data) => {
  await page.locator('#reader-back').click();
  await page.locator('#manuscript-file').setInputFiles({ name: 'ruby.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.waitForFunction(() => document.getElementById('confirm-dialog').open || !document.getElementById('import-manuscript').disabled);
  assert.equal(await page.locator('#confirm-dialog').evaluate(el => el.open), true, await page.locator('#notice').textContent());
  await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
};
const open = async page => { await page.locator('#operations').click(); await page.locator('#export-pdf').click(); await page.locator('#pdf-dialog').waitFor({ state: 'visible' }); };
const save = async page => {
  await page.locator('#operations').click(); const pending = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
  const file = await pending; return JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
};
const state = page => page.evaluate(() => ({ article: document.getElementById('reader').innerHTML,
  style: document.getElementById('reader').getAttribute('style'), count: document.getElementById('read-count').textContent,
  marks: window.ManuscriptWriting.printSnapshot(), enabled: window.ManuscriptWriting.enabled,
  undo: document.getElementById('writing-undo').disabled, tool: document.querySelector('[data-writing-tool][aria-pressed=true]').dataset.writingTool,
  anchor: window.Reader.capture(), storage: JSON.stringify([{ ...localStorage }, { ...sessionStorage }]) }));
const same = (after, before) => {
  assert.equal(after.anchor.offset, before.anchor.offset); assert.ok(Math.abs(after.anchor.y - before.anchor.y) < 2);
  assert.deepEqual({ ...after, anchor: null }, { ...before, anchor: null });
};
const html = '<ruby>黄昏<rt>たそがれ</rt></ruby>の森。<br><br>' + fixture.replace(/<!--[\s\S]*?-->/g, '') + '<br><br>' +
  Array.from({ length: 45 }, (_, i) => `章${String(i).padStart(3, '0')}：<ruby>風<rt>かぜ</rt></ruby>と<ruby>手袋<rt>てぶくろ</rt></ruby>を<ruby>見上<rt>みあ</rt></ruby>げ、静かに語った。${i % 5 === 0 ? '<br><br>' : '<br>'}`).join('') +
  '<ruby>一<rt>ながいよみがなをそのままのいちに</rt></ruby>。<br>' +
  '<ruby>👩‍👩‍👧‍👦<rt>かぞく</rt></ruby><ruby>が<rt>が</rt></ruby><ruby>𠮷<rt>&lt;b&gt;よみ&lt;/b&gt;</rt></ruby>。<br>' +
  '<ruby>終幕<rt>しゅうまく</rt></ruby>・最終ページ確認。';
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const manifest = [];
  try {
    for (const [width, height, font] of [[1200, 1.3, 26], [390, 1.8, 22], [320, 2.6, 22]]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
      const url = `http://127.0.0.1:${server.address().port}/`; await page.goto(url);
      await page.locator('[data-go=read-input]').click();
      await page.locator('#read-text').evaluate((el, html) => {
        el.focus(); const data = new DataTransfer(); data.setData('text/html', html); data.setData('text/plain', '本文（読み）');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, html);
      await page.locator('#open-read').click();
      await page.evaluate(({ height, font }) => { window.Reader.configure({ height, width: 900, breaks: 5 }); window.Reader.configure({ columns: document.getElementById('reader').getBoundingClientRect().width / font }); }, { height, font });
      const data = await save(page), count = await page.locator('#read-count').textContent();
      await open(page);
      assert.deepEqual(await page.locator('#manuscript-print rt').allTextContents(), data.sourceRubies.map(r => r.reading), 'HTML paste goes straight to native print ruby');
      await page.locator('#pdf-cancel').click();
      data.annotations = [{ offset: 1, text: '手動たそがれ' }, { offset: data.text.length, text: '<b>手動おわり</b>' }];
      data.marks = [{ id: 1, type: 'marker', start: 0, end: data.text.length },
        { id: 2, type: 'memo', offset: 0, dx: .4, dy: 0, text: 'ルビのある語から静かに' },
        { id: 3, type: 'memo', offset: data.text.indexOf('終幕'), dx: .4, dy: 0, text: '終わりはゆっくり' }];
      await choose(page, data); await open(page);
      const boundary = Number(await page.locator('.manuscript-page').nth(1).locator('.manuscript-line').first().getAttribute('data-source-line'));
      await page.locator('#pdf-cancel').click();
      const pen = await page.evaluate(boundary => {
        const s = window.Reader.printSnapshot(), g = window.Reader.getWritingGeometry();
        const first = s.glyphs.find(p => p.line >= boundary - 2), last = s.glyphs.find(p => p.line >= boundary + 2);
        return { id: 4, type: 'pen', offset: first.start, layoutKey: g.layoutKey,
          points: [{ x: -.4, y: -.3 }, { x: .6, y: (last.y - first.y) / g.fontSize }, { x: 1, y: .4 }], witnesses: [{ offset: first.start, x: 0, y: 0 }] };
      }, boundary);
      data.marks.push(pen); await choose(page, data);
      await page.locator('#operations').click(); await page.locator('#writing-mode').click();
      await page.locator('[data-writing-tool=memo]').click(); await page.locator('.writing-memo').first().click();
      await page.locator('#writing-memo-input').fill('ルビのある語から静かに！'); await page.locator('#writing-memo-save').click();
      const saved = await save(page); assert.equal(saved.version, 3); assert.deepEqual(saved.sourceRubies, data.sourceRubies);
      assert.equal(await page.locator('#read-count').textContent(), count);
      await page.evaluate(() => scrollTo(0, 350)); const before = await state(page);
      assert.equal(before.marks.hiddenPens, 0);
      await open(page); await page.locator('#pdf-cancel').click(); same(await state(page), before);
      await open(page);
      const snap = await page.evaluate(() => window.Reader.printSnapshot());
      await page.evaluate(() => { window.print = () => {}; }); await page.locator('#pdf-print').click(); await page.emulateMedia({ media: 'print' });
      const pages = await page.locator('.manuscript-page').evaluateAll(sheets => sheets.map(sheet => {
        const bounds = sheet.getBoundingClientRect(), canvas = sheet.firstChild;
        const rect = node => { const r = document.createRange(); r.selectNodeContents(node); const b = r.getBoundingClientRect(); return { left: b.left - bounds.left, top: b.top - bounds.top, width: b.width, height: b.height }; };
        const body = node => { const copy = node.cloneNode(true); copy.querySelectorAll('rt').forEach(n => n.remove()); return copy.textContent; };
        return { width: bounds.width, height: bounds.height, scale: Number(canvas.dataset.scale), left: canvas.getBoundingClientRect().left - bounds.left,
          lines: [...sheet.querySelectorAll('.manuscript-line')].map(row => ({ index: Number(row.dataset.sourceLine), text: body(row),
            pieces: [...row.children].map(span => ({ text: body(span), ink: rect(span.querySelector('ruby')?.firstChild || span),
              ruby: span.classList.contains('manuscript-source-ruby') ? { start: Number(span.dataset.start), end: Number(span.dataset.end), reading: span.querySelector('rt').textContent, ink: rect(span.querySelector('rt')) } : null })) })),
          markers: [...sheet.querySelectorAll('.manuscript-markers rect')].map(el => ({ offset: Number(el.dataset.offset), x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')) })),
          memos: [...sheet.querySelectorAll('.manuscript-memo')].map(el => ({ offset: Number(el.dataset.offset), text: el.lastChild.textContent })),
          pens: [...sheet.querySelectorAll('.manuscript-pens path[data-mark-id]')].map(el => ({ id: Number(el.dataset.markId), line: Number(el.dataset.sourceLine), d: el.getAttribute('d') })) };
      }));
      const rows = pages.flatMap(p => p.lines), sourceLines = snap.lines.filter(l => l.pieces.some(p => p.text.trim()));
      assert.deepEqual(rows.map(row => row.text), sourceLines.map(line => line.pieces.map(p => p.text).join('')), 'all frozen lines in order');
      const rubies = pages.flatMap(p => p.lines.flatMap(row => row.pieces.filter(piece => piece.ruby)));
      assert.deepEqual(rubies.map(p => ({ start: p.ruby.start, end: p.ruby.end, reading: p.ruby.reading })), data.sourceRubies, 'every ruby/base pair occurs once');
      let maxDrift = 0;
      const glyphs = new Map(snap.glyphs.map(g => [g.start, g]));
      for (const sheet of pages) {
        const byLine = new Map(sheet.lines.map(row => [row.index, row]));
        const shift = index => byLine.get(index).pieces[0].ink.top / sheet.scale - snap.lines[index].pieces[0].top;
        for (let i = 1; i < sheet.lines.length; i++) {
          const previous = sheet.lines[i - 1], current = sheet.lines[i];
          const actual = current.pieces[0].ink.top - previous.pieces[0].ink.top;
          const expected = (snap.lines[current.index].pieces[0].top - snap.lines[previous.index].pieces[0].top) * sheet.scale;
          assert.ok(Math.abs(actual - expected) < .16, 'ruby preserves original spacing, blanks and auto gaps within each page');
        }
        for (const row of sheet.lines) {
          const original = snap.lines[row.index];
          row.pieces.forEach((piece, i) => {
            const from = original.pieces[i], expectedTop = (from.top + shift(row.index)) * sheet.scale;
            assert.ok(Math.abs(piece.ink.left - sheet.left - from.left * sheet.scale) < .16, 'base X remains frozen');
            assert.ok(Math.abs(piece.ink.top - expectedTop) < .16, 'base Y remains frozen');
            if (!piece.ruby) return;
            const rt = piece.ruby.ink, source = from.sourceRuby.readingBounds;
            maxDrift = Math.max(maxDrift, Math.abs(rt.left - sheet.left - source.left * sheet.scale), Math.abs(rt.top - (source.top + shift(row.index)) * sheet.scale));
            // Native Japanese font ascent boxes overlap slightly even on the
            // screen; ink remains above the base's centre (visually checked).
            assert.ok(rt.top < piece.ink.top && rt.top + rt.height < piece.ink.top + piece.ink.height / 2, 'native reading stays above its base');
            assert.ok(rt.top >= -.2 && rt.top + rt.height <= sheet.height + .2 && rt.left >= -.2 && rt.left + rt.width <= sheet.width + .2, 'ruby inside paper');
            const previous = sheet.lines[sheet.lines.indexOf(row) - 1];
            if (previous) assert.ok(rt.top >= Math.max(...previous.pieces.map(p => p.ink.top + p.ink.height)) - .3, 'reading does not touch previous line');
          });
        }
        for (const marker of sheet.markers) {
          const g = glyphs.get(marker.offset); assert.ok(byLine.has(g.line));
          assert.ok(Math.abs(marker.x - g.x * sheet.scale) < .01);
          assert.ok(Math.abs(marker.y - (g.y + shift(g.line)) * sheet.scale) < .16, 'marker follows ruby-aware pagination');
        }
        for (const memo of sheet.memos) assert.ok(byLine.has(glyphs.get(memo.offset).line), 'memo and ruby base on same page');
        for (const pen of sheet.pens) assert.ok(byLine.has(pen.line), 'pen uses the same ruby-aware line table');
      }
      assert.ok(maxDrift < .3, `native rt position drift ${maxDrift}px`);
      assert.equal(pages.flatMap(p => p.markers).length, snap.glyphs.length);
      assert.equal(pages.flatMap(p => p.memos).length, 2);
      assert.ok(pages.filter(p => p.pens.length).length >= 2, 'pen still splits across pages with ruby');
      assert.equal(await page.locator('#manuscript-print b, #manuscript-print img').count(), 0);
      const filename = `source-ruby-${width}.pdf`;
      const expectedPages = await page.locator('.manuscript-page').allTextContents();
      await page.pdf({ path: path.join(output, filename), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      manifest.push({ filename, pages: pages.length, readings: data.sourceRubies.map(r => r.reading), expectedPages });
      await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      same(await state(page), before); assert.deepEqual(await save(page), saved);
      assert.deepEqual(errors, []); assert.equal(requests.filter(r => !r.startsWith(url)).length, 0);
      console.log(`PASS ${width}px: ${pages.length} pages, ${rubies.length} native rubies, drift ${maxDrift.toFixed(3)}px, paste/JSON, manual overlap, pen/marker/memos, state and privacy`);
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'source-ruby-manifest.json'), JSON.stringify(manifest, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..'), output = path.join(directory, 'tmp', 'pdfs');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const compact = text => text.replace(/\s/gu, '');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const manifest = [];
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(10000);
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page);
      const text = '\r\n\r\n黄昏の空に狐。「長い声ー」を聞いた。\n\n' + Array.from({ length: 65 }, (_, i) => `第${String(i).padStart(3, '0')}章、静かな森で本を読みます。${i % 7 === 0 ? '\r\n\r\n\r\n' : i % 3 === 0 ? '\n' : ''}`).join('') + '\n\n最後の文章。';
      const fox = text.indexOf('狐');
      const data = { format: 'reading-support-manuscript', version: 5, writingDirection: 'vertical', text,
        annotations: [{ offset: 6, text: 'たそがれ' }, { offset: 140, text: 'とてもながいよみがな'.repeat(8) }],
        sourceRubies: [{ start: 4, end: 6, reading: 'たそがれ' }, { start: fox, end: fox + 1, reading: 'きつね' }],
        memoSettings: { fontSize: 16, opacity: .8 }, marks: [
          { id: 1, type: 'marker', start: 4, end: 180, color: 'yellow' },
          { id: 2, type: 'marker', start: 400, end: 650, color: 'lightblue' },
          { id: 3, type: 'marker', start: 700, end: 1000, color: 'pink' },
          { id: 4, type: 'memo', offset: 7, text: '少し間を取る', color: 'pink', dx: 30, dy: 30, tx: 0, ty: 0, verticalPosition: { dx: -3, dy: 1, tx: 0, ty: 0 } },
          { id: 5, type: 'memo', offset: text.indexOf('第040'), text: '遠くから声が聞こえる', color: 'lightblue', dx: 0, dy: 0, tx: 0, ty: 0, verticalPosition: { dx: -999, dy: 999, tx: 999, ty: -999 } },
          { id: 6, type: 'pen', direction: 'horizontal', offset: 4, layoutKey: '40:1.8:5:0', color: 'blue', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], witnesses: [{ offset: 4, x: 0, y: 0 }] }
        ] };
      await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'vertical.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      try { await page.locator('#reader').waitFor(); } catch { throw Error(await page.locator('#notice').textContent()); }
      await page.evaluate(data => {
        const restored = ManuscriptMarks.restoreManuscript(JSON.stringify(data)), g = Reader.getWritingGeometry();
        const anchor = g.byOffset.get(4), cx = anchor.x + anchor.width / 2, cy = anchor.y + anchor.height / 2;
        const sections = [...document.querySelectorAll('.vertical-page')].map(el => {
          const r = el.getBoundingClientRect(), root = document.getElementById('reader').getBoundingClientRect();
          return { left: r.left - root.left, right: r.right - root.left, top: r.top - root.top, bottom: r.bottom - root.top };
        });
        const relative = p => ({ x: (p.x - cx) / g.fontSize, y: (p.y - cy) / g.fontSize });
        for (const points of [
          [{ x: cx, y: cy + 35 }, { x: sections[0].left + 10, y: cy + 35 }, { x: sections[0].left + 10, y: cy + 65 }],
          [{ x: cx - 8, y: cy }, { x: cx - 8, y: sections[2].top + 80 }]
        ]) restored.markings.add({ type: 'pen', direction: 'vertical', offset: 4, layoutKey: g.layoutKey, fontSize: g.fontSize, color: 'green',
          points: points.map(relative), witnesses: [{ offset: 4, x: 0, y: 0 }] });
        window.pdfTestModel = restored;
        ManuscriptWriting.show(restored.markings);
      }, data);
      const before = await page.evaluate(() => ({ html: document.getElementById('reader').innerHTML, style: document.getElementById('reader').getAttribute('style'),
        memo: document.getElementById('writing-memos').innerHTML, json: ManuscriptMarks.serializeManuscript(pdfTestModel.manuscript, pdfTestModel.markings), storage: JSON.stringify({ ...localStorage }), anchor: Reader.capture() }));
      await page.locator('#export-pdf').click(); await page.waitForFunction(() => document.getElementById('pdf-dialog').open);
      const result = await page.evaluate(() => {
        const snapshot = Reader.printSnapshot(), writing = ManuscriptWriting.printSnapshot({ forPrint: true });
        const printRoot = document.getElementById('manuscript-print'); printRoot.classList.add('print-measuring');
        const sheets = [...printRoot.querySelectorAll('.manuscript-page')];
        const lineIds = [...printRoot.querySelectorAll('.manuscript-line')].map(el => Number(el.dataset.sourceLine));
        const expectedLines = snapshot.lines.flatMap((line, i) => line.pieces.some(p => p.text.trim()) ? [i] : []);
        if (JSON.stringify(lineIds) !== JSON.stringify(expectedLines)) throw Error('Column order/loss/duplication');
        const base = el => { const clone = el.cloneNode(true); clone.querySelectorAll('rt').forEach(el => el.remove()); return clone.textContent; };
        const actualText = [...printRoot.querySelectorAll('.manuscript-line')].map(base).join('');
        const expectedText = snapshot.lines.flatMap(line => line.pieces.map(p => p.text)).join('');
        if (actualText !== expectedText) throw Error('Text order/loss/duplication');
        let markers = 0;
        for (const m of writing.items.filter(i => i.type === 'marker')) {
          const boxes = [...snapshot.glyphs.filter(g => g.end > m.start && g.start < m.end), ...snapshot.annotationRects.filter(g => m.start < g.offset && g.offset <= m.end)];
          const rects = [...printRoot.querySelectorAll(`.manuscript-markers rect[data-mark-id="${m.id}"]`)];
          if (rects.length !== boxes.length) throw Error('Marker coverage mismatch'); markers += rects.length;
        }
        const spanRange = document.createRange();
        for (const sheet of sheets) {
          const paper = sheet.getBoundingClientRect();
          let previous = Infinity;
          for (const line of sheet.querySelectorAll('.manuscript-line')) {
            const first = line.querySelector('.manuscript-piece'); if (!first) continue;
            const r = first.getBoundingClientRect(); if (r.right > previous + 2) throw Error('Column progression'); previous = r.right;
          }
          for (const el of sheet.querySelectorAll('.manuscript-piece,.manuscript-ruby-reading,.manuscript-pens path,.writing-memo,.memo-tip')) {
            if (el.classList.contains('manuscript-piece')) { spanRange.selectNodeContents(el); }
            const r = el.classList.contains('manuscript-piece') ? spanRange.getBoundingClientRect() : el.getBoundingClientRect();
            if (r.width && r.height && (r.left < paper.left - 1 || r.right > paper.right + 1 || r.top < paper.top - 1 || r.bottom > paper.bottom + 1)) throw Error(`Clipped ${el.className.baseVal || el.className}`);
          }
        }
        if (printRoot.querySelector('.manuscript-pens path[data-mark-id="6"]')) throw Error('Wrong direction pen');
        const scale = Number(printRoot.querySelector('.manuscript-canvas').dataset.scale);
        const lengths = writing.pens.map(pen => ({ id: pen.id,
          source: pen.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pen.points[i].x, p.y - pen.points[i].y), 0),
          output: [...printRoot.querySelectorAll(`.manuscript-pens path[data-mark-id="${pen.id}"]`)].reduce((sum, p) => sum + p.getTotalLength(), 0) / scale }));
        for (const l of lengths) if (Math.abs(l.source - l.output) > .1) throw Error(`Lost/duplicated stroke ${JSON.stringify(l)}`);
        for (const memo of writing.items.filter(i => i.type === 'memo')) {
          const note = printRoot.querySelector(`.writing-memo[data-mark-id="${memo.id}"]`), glyph = snapshot.glyphs.find(g => g.start === memo.offset);
          if (!note?.closest('.manuscript-page').querySelector(`.manuscript-line[data-source-line="${glyph.line}"]`)) throw Error('Memo separated from target');
        }
        const expectedPages = sheets.map(sheet => sheet.textContent);
        printRoot.classList.remove('print-measuring');
        return { pages: sheets.length, expectedPages, actualText, expectedText, markers, lengths };
      });
      let expected = text;
      for (const a of data.annotations.toReversed()) expected = expected.slice(0, a.offset) + `【${a.text}】` + expected.slice(a.offset);
      assert.equal(compact(result.actualText), compact(expected), 'original source and manual readings keep their order');
      const filename = `vertical-${width}.pdf`;
      await page.evaluate(() => { window.print = () => {}; ManuscriptPrint.print(); });
      await page.pdf({ path: path.join(output, filename), preferCSSPageSize: true, printBackground: true });
      await page.evaluate(() => { document.body.classList.remove('manuscript-printing'); });
      await page.locator('#pdf-cancel').evaluate(el => el.click());
      await page.waitForFunction(() => !document.getElementById('pdf-dialog').open);
      const after = await page.evaluate(() => ({ html: document.getElementById('reader').innerHTML, style: document.getElementById('reader').getAttribute('style'),
        memo: document.getElementById('writing-memos').innerHTML, json: ManuscriptMarks.serializeManuscript(pdfTestModel.manuscript, pdfTestModel.markings), storage: JSON.stringify({ ...localStorage }), anchor: Reader.capture() }));
      assert.deepEqual(after, before, 'export must not change reader, stored marks, memo layout or browser data');
      for (const scenario of ['missing-pen', 'invalid-pen', 'missing-memo-target', 'oversize-memo']) {
        await page.evaluate(scenario => {
          const originalReader = Reader.printSnapshot, originalWriting = ManuscriptWriting.printSnapshot;
          window.restorePDFTest = () => { Reader.printSnapshot = originalReader; ManuscriptWriting.printSnapshot = originalWriting; };
          if (scenario === 'missing-memo-target') Reader.printSnapshot = () => {
            const snapshot = originalReader(); return { ...snapshot, glyphs: snapshot.glyphs.filter(g => g.start !== 7) };
          };
          else ManuscriptWriting.printSnapshot = options => {
            const snapshot = originalWriting(options);
            if (scenario === 'missing-pen') snapshot.pens = [];
            if (scenario === 'invalid-pen') snapshot.pens[0].points[0].x = NaN;
            if (scenario === 'oversize-memo') { snapshot.memoSettings.fontSize = 28; snapshot.items.find(i => i.type === 'memo').text = 'あ' + '\n'.repeat(198) + 'あ'; }
            return snapshot;
          };
          document.getElementById('notice').hidden = true;
        }, scenario);
        await page.locator('#export-pdf').click();
        await page.waitForFunction(() => !document.getElementById('notice').hidden);
        assert.match(await page.locator('#notice').textContent(), /ペン|文字メモ/);
        assert.equal(await page.locator('#pdf-dialog').evaluate(el => el.open), false);
        assert.equal(await page.locator('.manuscript-page').count(), 0, 'failed output is cleared');
        await page.evaluate(() => restorePDFTest());
        assert.equal(await page.evaluate(() => ManuscriptMarks.serializeManuscript(pdfTestModel.manuscript, pdfTestModel.markings)), before.json);
      }
      await page.locator('#export-pdf').click(); await page.waitForFunction(() => document.getElementById('pdf-dialog').open);
      await page.locator('#pdf-cancel').click();
      manifest.push({ filename, ...result });
      assert.deepEqual(errors, []); await context.close();
      console.log(`${width}px: ${result.pages} vertical pages; all columns, ruby, markers, split vectors and same-page memos preserved`);
    }
    const stress = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await stress.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(stress); await stress.locator('[data-go=read-input]').click();
    await stress.locator('#read-text').fill('長い原稿。'); await stress.locator('#open-read').click();
    const long = await stress.evaluate(() => {
      const text = Array.from({ length: 2000 }, (_, i) => `第${i}節。「静かな森を歩くー」\r\n${i % 3 ? '' : '\r\n\r\n'}`).join('');
      const model = new ReadingAnnotations(text), marks = new ManuscriptMarks(text); marks.direction = 'vertical';
      Reader.show(text, model, { writingDirection: 'vertical' }); ManuscriptWriting.show(marks);
      const snapshot = Reader.printSnapshot(), result = ManuscriptPrint.prepare(snapshot, ManuscriptWriting.printSnapshot({ forPrint: true }));
      const actual = [...document.querySelectorAll('.manuscript-line')].map(el => el.textContent).join('');
      ManuscriptPrint.clear(); return { text, actual, pages: result.pages };
    });
    assert.equal(compact(long.actual), compact(long.text)); assert.ok(long.pages > 20);
    await stress.close(); console.log(`Long manuscript: ${long.text.length} UTF-16 units, ${long.pages} pages, no missing or duplicate text`);
    fs.writeFileSync(path.join(output, 'vertical-manifest.json'), JSON.stringify(manifest, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

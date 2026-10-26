// Regression: the entire note must follow the text scale, including PDF bounds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const output = process.env.READER_TEST_ARTIFACTS || path.join(directory, 'tmp', 'bubble-scale');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .08, `${label}: ${actual} != ${expected}`);
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('[data-go=read-input]').click();
    const text = '第一段落。\n\n\n\n第二段落。\n' + 'ページをまたいで朗読する文章。\n'.repeat(100);
    const data = { format: 'reading-support-manuscript', version: 4, text, annotations: [], sourceRubies: [],
      marks: [{ id: 1, type: 'memo', offset: 0, dx: .6, dy: 1.2, tx: .2, ty: .3, color: 'pink', text: '間をとる\n静かに\n次の段落へ' }], memoSettings: { fontSize: 16, opacity: .7 } };
    await page.locator('#manuscript-file').setInputFiles({ name: 'scale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => !document.getElementById('reading').hidden);
    for (const requested of [1, .7, .5]) {
      const result = await page.evaluate(requested => {
        const printRoot = document.getElementById('manuscript-print');
        const probe = document.createElement('section'); probe.className = 'manuscript-page';
        printRoot.classList.add('print-measuring'); printRoot.append(probe);
        const paperWidth = probe.getBoundingClientRect().width; probe.remove(); printRoot.classList.remove('print-measuring');
        Reader.configure({ width: requested === 1 ? 600 : paperWidth / requested, breaks: 0 });
        const snapshot = Reader.printSnapshot(), writing = ManuscriptWriting.printSnapshot();
        const live = document.querySelector('#writing-memos .writing-memo');
        const liveBody = live.getBoundingClientRect();
        const second = snapshot.glyphs.find(g => g.start === writing.source.indexOf('第二'));
        if (liveBody.bottom > document.getElementById('reader').getBoundingClientRect().top + second.y) throw Error('fixture overlaps text on screen');
        const before = { items: writing.items, html: document.getElementById('reader').innerHTML, live: live.outerHTML };
        const without = ManuscriptPrint.prepare(snapshot, { ...writing, items: [] });
        const prepared = ManuscriptPrint.prepare(snapshot, writing);
        printRoot.classList.add('print-measuring');
        const note = printRoot.querySelector('.writing-memo'), body = note.getBoundingClientRect();
        const circle = note.querySelector('.memo-tip').getBoundingClientRect();
        const canvas = note.closest('.manuscript-canvas').getBoundingClientRect();
        const firstPiece = note.closest('.manuscript-canvas').querySelector('.manuscript-piece').getBoundingClientRect();
        const secondPiece = [...note.closest('.manuscript-canvas').querySelectorAll('.manuscript-piece')].find(el => el.textContent.includes('第二')).getBoundingClientRect();
        const tip = live.querySelector('.memo-tip').getBoundingClientRect();
        const glyph = snapshot.glyphs[0], memo = writing.items[0], scale = prepared.scale;
        const measures = { scale, width: body.width, height: body.height, liveWidth: liveBody.width, liveHeight: liveBody.height,
          tipWidth: circle.width, liveTipWidth: tip.width, x: body.x - canvas.x,
          expectedX: (glyph.x + glyph.width / 2 + memo.dx * parseFloat(snapshot.font.fontSize)) * scale,
          gap: body.bottom - secondPiece.top, firstInk: firstPiece.width,
          tipX: circle.x + circle.width / 2 - canvas.x,
          expectedTipX: (glyph.x + glyph.width / 2 + memo.tx * parseFloat(snapshot.font.fontSize)) * scale };
        // A late-page note must be clamped using its scaled body/tip extents.
        const edge = { ...memo, id: 2, offset: snapshot.glyphs.at(-1).start, dx: 999, dy: 999, tx: 999, ty: 999 };
        ManuscriptPrint.prepare(snapshot, { ...writing, items: [...writing.items, edge] });
        printRoot.classList.add('print-measuring');
        const edgeNote = printRoot.querySelector('[data-mark-id="2"]'), sheet = edgeNote.closest('.manuscript-page');
        const paper = sheet.getBoundingClientRect();
        if (!sheet.querySelector(`[data-source-line="${snapshot.glyphs.at(-1).line}"]`)) throw Error('source line or note-page reference missing');
        for (const el of [edgeNote, edgeNote.querySelector('.memo-tip')]) {
          const r = el.getBoundingClientRect();
          if (r.left < paper.left - .1 || r.right > paper.right + .1 || r.top < paper.top - .1 || r.bottom > paper.bottom + .1) throw Error('scaled bounds overflow');
        }
        // Height validation must happen after scaling: this note fits only at 50%.
        if (requested === .5) ManuscriptPrint.prepare(snapshot, { ...writing, memoSettings: { fontSize: 28, opacity: .7 }, items: [{ ...memo, text: 'あ'.repeat(200) }] });
        ManuscriptPrint.prepare(snapshot, { ...writing, items: [...writing.items, edge] });
        if (JSON.stringify(ManuscriptWriting.printSnapshot().items) !== JSON.stringify(before.items) ||
            document.getElementById('reader').innerHTML !== before.html || live.outerHTML !== before.live) throw Error('live drawing changed');
        return { measures, prepared, without };
      }, requested);
      const m = result.measures;
      close(m.scale, requested, 'requested scale');
      close(m.width, m.liveWidth * m.scale, 'body width'); close(m.height, m.liveHeight * m.scale, 'body height');
      close(m.tipWidth, m.liveTipWidth * m.scale, 'tip size'); close(m.x, m.expectedX, 'body position'); close(m.tipX, m.expectedTipX, 'tail endpoint');
      assert.ok(m.gap <= .1, 'note must remain in the paragraph gap');
      assert.equal(result.prepared.pages, result.without.pages); close(result.prepared.scale, result.without.scale, 'text scale unchanged');
      // Export through the actual print stylesheet, then inspect the resulting PDF.
      await page.evaluate(() => document.body.classList.add('manuscript-printing'));
      await page.pdf({ path: path.join(output, `bubble-scale-${requested}.pdf`), preferCSSPageSize: true, printBackground: true });
      console.log(`PASS scale ${requested}: body dimensions, tip, placement/gap, page bounds, text pagination, live drawing unchanged`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

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
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = process.env.READER_TEST_ARTIFACTS;
  const manifest = [];
  try {
    for (const width of [1800, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 950 }, acceptDownloads: true });
      page.setDefaultTimeout(8000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const source = '黄昏の空を見ながら、静かな声で本を読みます。'.repeat(140);
      const manuscript = { format: 'reading-support-manuscript', version: 4, text: source,
        annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 0, end: 2, reading: 'たそがれ' }],
        memoSettings: { fontSize: 22, opacity: .6 }, marks: [
          { id: 1, type: 'memo', offset: 3, dx: 45, dy: 0, tx: 0, ty: 0, color: 'pink', text: 'aaa' },
          { id: 2, type: 'marker', start: 0, end: 4, color: 'lightblue' },
          { id: 3, type: 'pen', offset: 0, layoutKey: '30:1.8:0:0', fontSize: 22, color: 'green', points: [{ x: 0, y: .5 }, { x: 1, y: .7 }], witnesses: [{ offset: 0, x: 0, y: 0 }] }
        ] };
      await page.locator('#home [data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({ name: 'memo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manuscript)) });
      await page.locator('#reading').waitFor({ state: 'visible' });
      const before = await page.evaluate(() => ({ writing: ManuscriptWriting.printSnapshot(), html: document.getElementById('reader').innerHTML, memo: document.getElementById('writing-memos').innerHTML }));
      const cases = width === 1800 ? ['right', 'multiple', 'tall', 'safe-gap'] : ['right', 'multiple'];
      for (const scenario of cases) {
        const result = await page.evaluate(scenario => {
          const snapshot = Reader.printSnapshot(), writing = ManuscriptWriting.printSnapshot();
          const originalMemo = writing.items.find(m => m.type === 'memo');
          const printRoot = document.getElementById('manuscript-print');
          if (scenario === 'safe-gap') {
            // A large existing blank band should keep the original placement.
            snapshot.lines.slice(1).forEach(line => { line.top += 180; line.bottom += 180; line.center += 180; line.pieces.forEach(p => { p.top += 180; if (p.sourceRuby) { p.sourceRuby.bounds.top += 180; p.sourceRuby.readingBounds.top += 180; } }); });
            snapshot.glyphs.filter(g => g.line > 0).forEach(g => { g.y += 180; });
            snapshot.annotationRects.filter(g => g.line > 0).forEach(g => { g.y += 180; });
            writing.items = [{ ...originalMemo, dx: 0, dy: 3, text: 'safe-gap' }]; writing.pens = [];
          }
          if (scenario === 'multiple') {
            ManuscriptPrint.prepare(snapshot, { ...writing, items: writing.items.filter(m => m.type !== 'memo') });
            const lastLine = Number([...printRoot.querySelector('.manuscript-page').querySelectorAll('.manuscript-line')].at(-1).dataset.sourceLine);
            const edge = snapshot.glyphs.find(g => g.line === lastLine);
            writing.items.push(...Array.from({ length: 12 }, (_, index) => ({ ...originalMemo, id: 10 + index, offset: index < 6 ? originalMemo.offset : index < 10 ? edge.start : snapshot.glyphs.at(-1).start, dx: 999, dy: index < 6 ? 0 : 999, text: index < 10 ? `note-${index + 1}\n複数のメモを読めるように配置` : `note-${index + 1}\n末尾のメモ\n` + 'あいうえお。'.repeat(28), color: index % 2 ? 'lightblue' : 'yellow' })));
          }
          if (scenario === 'tall') {
            writing.memoSettings = { fontSize: 28, opacity: .35 };
            writing.items = [{ ...originalMemo, text: '長いメモ\n' + 'あ\n'.repeat(90) + '終端' }]; writing.pens = [];
          }
          const expected = writing.items.filter(m => m.type === 'memo').map(m => ({ id: m.id, text: m.text }));
          const prepared = ManuscriptPrint.prepare(snapshot, writing);
          printRoot.classList.add('print-measuring');
          const intersects = (a, b) => a.left < b.right - .1 && a.right > b.left + .1 && a.top < b.bottom - .1 && a.bottom > b.top + .1;
          let notes = 0, references = 0;
          for (const sheet of printRoot.querySelectorAll('.manuscript-page')) {
            const paper = sheet.getBoundingClientRect();
            const occupied = [...sheet.querySelectorAll('.manuscript-piece,.manuscript-ruby-reading,.manuscript-note-reference,.manuscript-notes-title')].map(el => el.getBoundingClientRect());
            for (const note of sheet.querySelectorAll('.writing-memo')) {
              const body = note.getBoundingClientRect(); notes++;
              if (body.left < paper.left - .1 || body.right > paper.right + .1 || body.top < paper.top - .1 || body.bottom > paper.bottom + .1) throw Error('memo outside printable page');
              if (occupied.some(box => intersects(body, box))) throw Error(`memo ${note.dataset.markId} overlaps text, ruby or another memo (${scenario})`);
              occupied.push(body);
              if (note.querySelectorAll('.memo-tail path,.memo-tip').length !== 2) throw Error('tail or endpoint missing');
              if (getComputedStyle(note).opacity !== String(writing.memoSettings.opacity)) throw Error('opacity changed');
              const original = writing.items.find(item => String(item.id) === note.dataset.markId);
              if (note.dataset.color !== original.color || Math.abs(parseFloat(getComputedStyle(note).fontSize) - writing.memoSettings.fontSize * prepared.scale) > .01) throw Error('memo colour or effective font size changed');
            }
            references += sheet.querySelectorAll('.manuscript-note-reference').length;
          }
          for (const item of expected) {
            const text = [...printRoot.querySelectorAll(`.writing-memo[data-mark-id="${item.id}"] .memo-body`)].map(el => el.textContent).join('');
            if (text !== item.text) throw Error('memo text missing or changed');
          }
          const printedPieces = [...printRoot.querySelectorAll('.manuscript-piece')].map(el => { const copy = el.cloneNode(true); copy.querySelectorAll('rt').forEach(n => n.remove()); return copy.textContent; });
          if (printedPieces.join('') !== snapshot.lines.flatMap(l => l.pieces.map(p => p.text)).join('')) throw Error('manuscript text changed');
          if ([...printRoot.querySelectorAll('.manuscript-ruby-reading')].map(el => el.textContent).join('') !== snapshot.lines.flatMap(l => l.pieces.filter(p => p.sourceRuby).map(p => p.sourceRuby.reading)).join('')) throw Error('native ruby changed');
          for (const item of writing.items.filter(m => ['pen', 'marker'].includes(m.type))) {
            const selector = item.type === 'pen' ? '.manuscript-pens path' : '.manuscript-markers rect';
            if (!printRoot.querySelector(`${selector}[data-mark-id="${item.id}"][data-color="${item.color}"]`)) throw Error('pen/marker output missing');
          }
          if (scenario === 'safe-gap' && printRoot.querySelector('.manuscript-memo-page')) throw Error('safe position unnecessarily moved to another page');
          if (scenario === 'tall' && notes < 2) throw Error('oversize note was not paginated');
          const notePages = printRoot.querySelectorAll('.manuscript-memo-page');
          for (const el of notePages) if (!/本文\d+ページのメモ/.test(el.querySelector('.manuscript-notes-title').textContent)) throw Error('source-page reference missing');
          const sheets = [...printRoot.querySelectorAll('.manuscript-page')];
          for (const reference of printRoot.querySelectorAll('.manuscript-note-reference')) {
            const source = sheets.find(sheet => sheet.querySelector(`.manuscript-line[data-source-line="${reference.dataset.sourceLine}"]`));
            const pageNumber = sheets.indexOf(source) + 1;
            const lineNumber = [...source.querySelectorAll('.manuscript-line')].findIndex(line => line.dataset.sourceLine === reference.dataset.sourceLine) + 1;
            if (!reference.textContent.includes(`本文${pageNumber}ページ ${lineNumber}行目`)) throw Error('source reference no longer matches after inserting note pages');
          }
          printRoot.classList.remove('print-measuring');
          return { prepared, notes, references, notePages: notePages.length,
            pages: [...printRoot.querySelectorAll('.manuscript-page')].map(el => el.textContent), expected };
        }, scenario);
        if (output) {
          fs.mkdirSync(output, { recursive: true });
          await page.evaluate(() => { window.print = () => {}; ManuscriptPrint.print(); });
          const filename = `memo-${width}-${scenario}.pdf`;
          await page.pdf({ path: path.join(output, filename), preferCSSPageSize: true, printBackground: true });
          manifest.push({ filename, ...result });
          await page.evaluate(() => { document.body.classList.remove('manuscript-printing'); });
        }
        const after = await page.evaluate(() => ({ writing: ManuscriptWriting.printSnapshot(), html: document.getElementById('reader').innerHTML, memo: document.getElementById('writing-memos').innerHTML }));
        assert.deepEqual(after, before, 'PDF preparation must not mutate source, marks, settings or live memo geometry');
        console.log(`PASS ${width}px ${scenario}: ${result.prepared.pages} pages, ${result.notes} memo bodies, ${result.notePages} note pages`);
        await page.evaluate(() => ManuscriptPrint.clear());
      }
      const download = page.waitForEvent('download'); await page.locator('#export-manuscript').click();
      assert.deepEqual(JSON.parse(fs.readFileSync(await (await download).path(), 'utf8')), manuscript, 'saved JSON unchanged');
      assert.deepEqual(errors, []); await page.close();
    }
    if (output) fs.writeFileSync(path.join(output, 'memo-layout-manifest.json'), JSON.stringify(manifest, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

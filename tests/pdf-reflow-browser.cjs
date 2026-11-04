const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..'), output = path.join(directory, 'tmp', 'pdf-reflow');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const text = '黄昏の空に狐が現れた。👩‍👩‍👧‍👦が𠮷。\r\n\r\n' + Array.from({ length: 46 }, (_, i) => `第${String(i).padStart(3, '0')}段落。静かな森で間を取り、ゆっくりと声にして読みます。明示した改行を残します。${i % 3 === 0 ? '\r\n\r\n' : '\n'}`).join('');
const bodyState = page => page.evaluate(() => ({ html: document.getElementById('reader').innerHTML, style: document.getElementById('reader').getAttribute('style'),
  text: document.getElementById('read-text').value, stored: localStorage.getItem(UserLibrary.KEY), mode: Reader.displayMode, offset: Reader.capture()?.offset,
  marks: ManuscriptWriting.printSnapshot().items, font: getComputedStyle(document.getElementById('reader')).fontSize, leading: getComputedStyle(document.getElementById('reader')).lineHeight }));
const compact = value => value.replace(/\s/gu, '');
const inspect = page => page.evaluate(() => {
  const root = document.getElementById('manuscript-print'), range = document.createRange();
  const sheets = [...root.querySelectorAll('.manuscript-page')];
  const clipped = [], gutter = [], overlaps = [];
  const within = (r, box) => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
  for (const sheet of sheets) {
    const box = sheet.getBoundingClientRect();
    for (const el of sheet.querySelectorAll('.manuscript-piece,.manuscript-ruby-reading,.manuscript-pens path,.manuscript-markers rect,.writing-memo,.memo-tip,.manuscript-note-reference,.manuscript-notes-title')) {
      let r;
      if (el.classList.contains('manuscript-piece')) {
        const base = el.classList.contains('manuscript-source-ruby') ? el.querySelector('ruby').firstChild : el;
        range.selectNodeContents(base); r = range.getBoundingClientRect();
      } else r = el.getBoundingClientRect();
      if (r.width && r.height && !within(r, box)) clipped.push({ type: el.className.baseVal || el.className, text: el.textContent.slice(0, 20), rect: [r.left - box.left, r.top - box.top, r.width, r.height], paper: [box.width, box.height] });
      const spread = sheet.parentElement.classList.contains('manuscript-spread') && sheet.parentElement.getBoundingClientRect();
      if (spread && r.width && r.height && r.right > spread.left + spread.width / 2 - 10 * 96 / 25.4 + 1 && r.left < spread.left + spread.width / 2 + 10 * 96 / 25.4 - 1) gutter.push(el.className.baseVal || el.className);
    }
    const ink = [...sheet.querySelectorAll('.manuscript-piece,.manuscript-ruby-reading,.manuscript-pens path,.manuscript-markers rect')].map(el => el.getBoundingClientRect());
    for (const note of sheet.querySelectorAll('.writing-memo')) {
      const r = note.querySelector('.memo-body').getBoundingClientRect();
      if (ink.some(b => r.left < b.right - 1 && r.right > b.left + 1 && r.top < b.bottom - 1 && r.bottom > b.top + 1)) overlaps.push(note.dataset.markId);
    }
  }
  const bodyPages = sheets.filter(s => !s.classList.contains('manuscript-memo-page'));
  const base = el => { const c = el.cloneNode(true); c.querySelectorAll('rt').forEach(e => e.remove()); return c.textContent; };
  const fonts = [...root.querySelectorAll('.manuscript-canvas')].map(el => ({ size: parseFloat(getComputedStyle(el).fontSize), leading: parseFloat(getComputedStyle(el).lineHeight), scale: Number(el.dataset.scale) }));
  const pens = {};
  for (const p of root.querySelectorAll('.manuscript-pens path')) pens[p.dataset.markId] = (pens[p.dataset.markId] || 0) + p.getTotalLength();
  const order = [...root.querySelectorAll('.manuscript-spread')].map(s => [...s.children].map(p => ({ x: p.getBoundingClientRect().left, text: p.textContent.slice(0, 12) })));
  return { clipped: clipped.slice(0, 5), gutter, overlaps, fonts, pens, body: bodyPages.flatMap(s => [...s.querySelectorAll('.manuscript-line')].map(base)).join(''),
    bodyPages: bodyPages.length, pages: sheets.length, sheets: root.classList.contains('print-two-up') ? root.children.length : sheets.length, order,
    expectedPages: [...root.children].map(s => s.textContent), noteText: [...root.querySelectorAll('.writing-memo .memo-body')].map(e => e.textContent).join(''),
    references: [...root.querySelectorAll('.manuscript-note-reference')].map(e => ({ text: e.textContent, offset: e.dataset.offset })) };
});
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true }), manifest = [];
  try {
    for (const width of (process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1400, 390])) for (const direction of ['horizontal', 'vertical']) for (const layout of ['single', 'spread']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page); await page.locator('[data-go=read-input]').click();
      const data = { format: 'reading-support-manuscript', version: 5, writingDirection: direction, text,
        annotations: [{ offset: 2, text: 'たそがれ' }, { offset: text.indexOf('第010') + 2, text: 'ゆっくり'.repeat(14) }], sourceRubies: [{ start: 0, end: 2, reading: 'たそがれ' }, { start: 5, end: 6, reading: 'きつね' }],
        memoSettings: { fontSize: 16, opacity: .9 }, marks: [
          { id: 1, type: 'marker', start: 0, end: text.indexOf('第015'), color: 'pink' },
          { id: 2, type: 'memo', offset: 6, text: '最初は少し間を取る', color: 'yellow', dx: .6, dy: 1, tx: 0, ty: 0, verticalPosition: { dx: -3, dy: 1, tx: 0, ty: 0 } },
          { id: 3, type: 'memo', offset: text.indexOf('第030'), text: '遠くの声を思い浮かべる', color: 'lightblue', dx: 999, dy: 999, tx: 0, ty: 0, verticalPosition: { dx: -999, dy: 999, tx: 0, ty: 0 } },
          { id: 4, type: 'pen', offset: 0, direction, layoutKey: '40:1.8:5:0', fontSize: 22, color: 'blue', points: direction === 'vertical' ? [{ x: .4, y: 0 }, { x: .4, y: 10 }, { x: -5, y: 10 }] : [{ x: 0, y: .5 }, { x: 15, y: .5 }, { x: 15, y: 5 }], witnesses: [{ offset: 0, x: 0, y: 0 }] }
        ] };
      await page.locator('#manuscript-file').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden && !document.getElementById('import-manuscript').disabled);
      if (width > 1000) await page.evaluate(direction => { Reader.configure({ width: 1300 }); Reader.configure({ columns: Reader.getWritingGeometry().width / (direction === 'vertical' ? 32 : 28), height: direction === 'vertical' ? 1.4 : 2.2 }); }, direction);
      if (width < 600) { await page.locator('#toolbar-settings').click(); await page.locator('#display-mode').selectOption('pages'); await page.locator('[data-close=settings-dialog]').click(); }
      await page.waitForTimeout(250);
      const original = await bodyState(page), source = await page.evaluate(() => Reader.withPrintLayout(() => ({ snapshot: Reader.printSnapshot(), writing: ManuscriptWriting.printSnapshot({ forPrint: true }) })));
      await page.evaluate(() => { const prepare = ManuscriptPrint.prepare; ManuscriptPrint.prepare = (snapshot, writing, options) => { const result = prepare(snapshot, writing, options); window.printTrace = { width: snapshot.width, extent: ManuscriptPrint.inlineExtent(snapshot, writing), maxLine: Math.max(...snapshot.lines.map(l => l.bottom - l.top)), result }; return result; }; });
      await page.locator('#export-pdf').click(); await page.locator('#pdf-dialog').waitFor(); await page.locator('#pdf-layout').selectOption(layout);
      await page.waitForFunction(() => !document.getElementById('manuscript-print').classList.contains('print-measuring'));
      assert.equal(await page.locator('#pdf-layout option[value=spread]').textContent(), '1枚に2ページ（袋とじ用）');
      await page.evaluate(() => { window.print = () => {}; ManuscriptPrint.print(); }); await page.emulateMedia({ media: 'print' });
      const printed = await inspect(page);
      assert.deepEqual(printed.clipped, [], `${width} ${direction} ${layout}: clipped ink`); assert.deepEqual(printed.gutter, [], 'central 20mm is empty'); assert.deepEqual(printed.overlaps, [], 'notes do not overlap ink');
      for (const font of printed.fonts) { assert.equal(font.size, parseFloat(original.font), JSON.stringify({ width, direction, layout, trace: await page.evaluate(() => window.printTrace) })); assert.equal(font.scale, 1, 'rewrap, not global shrink'); assert.equal(font.leading, parseFloat(original.leading)); }
      const expectedText = source.snapshot.lines.flatMap(l => l.pieces.map(p => p.text)).join('');
      assert.equal(compact(printed.body), compact(expectedText), 'all text/ruby bases/manual readings retained in order');
      for (const pen of source.writing.pens) {
        const length = pen.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pen.points[i].x, p.y - pen.points[i].y), 0);
        assert.ok(Math.abs(printed.pens[pen.id] - length) < .3, `full vector length retained: ${printed.pens[pen.id]} / ${length}`);
      }
      for (const pair of printed.order) if (pair.length === 2) assert.equal(pair[0].x < pair[1].x, direction === 'horizontal', 'reading order');
      for (const memo of data.marks.filter(m => m.type === 'memo')) assert.ok(printed.noteText.includes(memo.text));
      const filename = `reflow-${direction}-${layout}-${width}.pdf`;
      await page.pdf({ path: path.join(output, filename), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      manifest.push({ filename, ...printed, fontSize: parseFloat(original.font), layout, direction });
      await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => dispatchEvent(new Event('afterprint'))); await page.locator('#pdf-cancel').evaluate(e => e.click()); await page.waitForTimeout(100);
      const after = await bodyState(page);
      for (const key of ['html', 'style', 'text', 'stored', 'mode', 'marks', 'font', 'leading', 'offset']) assert.deepEqual(after[key], original[key], `screen/data unchanged: ${key}`);
      assert.deepEqual(errors, []); await context.close(); console.log(`${width} ${direction} ${layout}: full-size type, ink, vectors, gutter, order and source passed`);
    }
    for (const direction of ['horizontal', 'vertical']) {
      const context = await browser.newContext({ viewport: { width: 1000, height: 900 } }), page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message)); await page.goto(`http://127.0.0.1:${server.address().port}/`); await startNew(page); await page.locator('[data-go=read-input]').click();
      const memoText = '別ページでも本文との参照を維持します。'.repeat(10).slice(0, 200);
      const stress = { format: 'reading-support-manuscript', version: 5, writingDirection: direction, text,
        annotations: [{ offset: 2, text: 'ながいよみがな'.repeat(140) }], sourceRubies: [], memoSettings: { fontSize: 28, opacity: .9 },
        marks: [0, 1, 2].map(i => ({ id: i + 1, type: 'memo', offset: i ? text.indexOf('第010') : 0, text: memoText, color: 'pink', dx: 0, dy: 0, tx: 0, ty: 0, verticalPosition: { dx: -1, dy: 1, tx: 0, ty: 0 } })) };
      await page.locator('#manuscript-file').setInputFiles({ name: 'stress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(stress)) });
      await page.waitForFunction(() => !document.getElementById('reading').hidden); await page.waitForTimeout(200);
      await page.locator('#export-pdf').click(); await page.locator('#pdf-layout').selectOption('spread');
      await page.evaluate(() => { window.print = () => {}; ManuscriptPrint.print(); }); await page.emulateMedia({ media: 'print' });
      const result = await inspect(page);
      assert.deepEqual(result.clipped, []); assert.deepEqual(result.gutter, []); assert.deepEqual(result.overlaps, []);
      assert.ok(result.references.length > 0, 'oversized notes move to referenced note pages');
      for (const font of result.fonts) assert.equal(font.scale, 1, 'long manual readings break across pages instead of shrinking the book');
      assert.equal(result.noteText, memoText.repeat(3));
      const referencesValid = await page.evaluate(() => {
        const bodies = [...document.querySelectorAll('.manuscript-page:not(.manuscript-memo-page)')];
        return [...document.querySelectorAll('.manuscript-note-reference')].every(r => {
          const number = Number(r.textContent.match(/本文([0-9]+)ページ/)[1]);
          return bodies[number - 1]?.querySelector(`.manuscript-line[data-source-line="${r.dataset.sourceLine}"]`);
        });
      }); assert.ok(referencesValid, 'every note reference names its actual body page/line');
      await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => dispatchEvent(new Event('afterprint'))); await page.locator('#pdf-cancel').evaluate(e => e.click());
      await page.locator('#reader-back').click();
      const extreme = { ...stress, text: '黄昏。', annotations: [], marks: [], sourceRubies: [{ start: 0, end: 2, reading: 'るび'.repeat(600) }] };
      await page.locator('#manuscript-file').setInputFiles({ name: 'extreme.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(extreme)) });
      await page.locator('#confirm-ok').click(); await page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
      await page.locator('#export-pdf').click(); await page.locator('#pdf-dialog').waitFor(); assert.equal(await page.locator('#pdf-small-warning').isVisible(), true, 'unbreakable oversized ruby keeps the existing warning');
      assert.deepEqual(errors, []); await context.close(); console.log(`${direction}: long readings, split notes, references and reduction warning passed`);
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

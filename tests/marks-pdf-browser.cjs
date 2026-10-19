// Real JSON imports, frozen page geometry and actual multi-page vector PDFs.
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
const choose = (page, data) => page.locator('#manuscript-file').setInputFiles({ name: 'writing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
const complete = page => page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
const open = async page => {
  await page.locator('#operations').click(); await page.locator('#export-pdf').click();
  await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
};
const snapshot = page => page.evaluate(() => window.Reader.printSnapshot());
const state = page => page.evaluate(() => ({ writing: window.ManuscriptWriting.printSnapshot(), enabled: window.ManuscriptWriting.enabled,
  tool: document.querySelector('[data-writing-tool][aria-pressed="true"]').dataset.writingTool,
  undo: document.getElementById('writing-undo').disabled, article: document.getElementById('reader').innerHTML,
  style: document.getElementById('reader').getAttribute('style'), count: document.getElementById('read-count').textContent,
  anchor: window.Reader.capture(), storage: JSON.stringify([{ ...localStorage }, { ...sessionStorage }]) }));
const sameState = (after, before) => {
  assert.equal(after.anchor.offset, before.anchor.offset); assert.ok(Math.abs(after.anchor.y - before.anchor.y) < 2);
  assert.deepEqual({ ...after, anchor: null }, { ...before, anchor: null });
};
const length = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
      const url = `http://127.0.0.1:${server.address().port}/`;
      await page.goto(url); await page.locator('[data-go="read-input"]').click();
      const text = '黄昏に狐を見た。👩‍👩‍👧‍👦が𠮷【原文】。\r\n\r\n' + Array.from({ length: 60 }, (_, i) => `章${String(i).padStart(3, '0')}：風の音を聞いて、静かに今日のことを語る。${i % 4 === 0 ? '\n\n' : '\n'}`).join('') + '最終ページ確認。';
      const data = { format: 'reading-support-manuscript', version: 3, text,
        annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: 3, end: 4, reading: 'きつね' }],
        marks: [{ id: 1, type: 'marker', start: 0, end: text.length },
          { id: 2, type: 'memo', offset: 3, dx: .4, dy: 0, text: '少し大きく・間を取る' },
          { id: 3, type: 'memo', offset: text.indexOf('章020'), dx: .4, dy: 0, text: 'ゆっくり'.repeat(8) },
          { id: 4, type: 'memo', offset: text.indexOf('章020'), dx: -1000, dy: 1000, text: '<b>HTMLにしない</b>' },
          { id: 5, type: 'memo', offset: text.indexOf('最終'), dx: 1000, dy: -1000, text: '終わりは静かに' }] };
      await choose(page, data); await complete(page);
      await page.evaluate(() => window.Reader.configure({ width: 900, height: 2.2, breaks: 5 }));
      // Find a real page boundary, then make a restored pen cross it in BOTH
      // directions. Geometry is obtained after the live memo rail is present.
      await open(page);
      const boundary = await page.locator('.manuscript-page').nth(1).locator('.manuscript-line').first().getAttribute('data-source-line');
      await page.locator('#pdf-cancel').click();
      const frozen = await snapshot(page);
      const geometry = await page.evaluate(() => {
        const g = window.Reader.getWritingGeometry(); return { layoutKey: g.layoutKey, fontSize: g.fontSize };
      });
      const first = frozen.glyphs.find(g => g.line >= Number(boundary) - 2);
      const end = frozen.glyphs.find(g => g.line >= Number(boundary) + 2);
      const origin = { x: first.x + first.width / 2, y: first.y + first.height / 2 };
      const raw = [{ x: origin.x - 4, y: origin.y - 4 }, { x: origin.x + 18, y: end.y + end.height / 2 }, { x: origin.x + 32, y: origin.y + 3 }];
      data.marks.push({ id: 6, type: 'pen', offset: first.start, layoutKey: geometry.layoutKey,
        points: raw.map(p => ({ x: (p.x - origin.x) / geometry.fontSize, y: (p.y - origin.y) / geometry.fontSize })), witnesses: [{ offset: first.start, x: 0, y: 0 }] });
      // A tiny stroke at the first character also tests the page's upper edge.
      const initial = frozen.glyphs[0];
      data.marks.push({ id: 7, type: 'pen', offset: initial.start, layoutKey: geometry.layoutKey,
        points: [{ x: -.3, y: -.4 }, { x: .4, y: .3 }], witnesses: [{ offset: initial.start, x: 0, y: 0 }] });
      await page.locator('#reader-back').click(); await choose(page, data); await page.locator('#confirm-ok').click(); await complete(page);
      await page.locator('#operations').click(); await page.locator('#writing-mode').click();
      // Create an undo entry without changing the final dataset, then verify it
      // and the selected writing mode survive print/cancel.
      await page.locator('[data-writing-tool=memo]').click(); await page.locator('.writing-memo').first().click();
      await page.locator('#writing-memo-input').fill('少し大きく・間を取る！'); await page.locator('#writing-memo-save').click();
      await page.evaluate(() => scrollTo(0, 400));
      const before = await state(page), snap = await snapshot(page), requestCount = requests.length;
      await page.locator('.writing-memo').first().click(); await page.locator('#writing-memo-input').fill('未登録のメモ変更');
      assert.equal(await page.evaluate(() => window.ManuscriptPrint.prepare(window.Reader.printSnapshot(), window.ManuscriptWriting.printSnapshot()).marks), 7);
      assert.equal(await page.locator('#manuscript-print').textContent().then(value => value.includes('未登録のメモ変更')), false);
      assert.equal(await page.locator('#writing-memo-input').inputValue(), '未登録のメモ変更');
      await page.evaluate(() => window.ManuscriptPrint.clear()); await page.locator('#writing-memo-cancel').click();
      // Several notes pushed toward the footer can move upward as a cluster;
      // they must not trigger the impossible-stack error when there is room.
      await page.evaluate(() => {
        const writing = window.ManuscriptWriting.printSnapshot();
        for (const memo of writing.items) if (memo.type === 'memo') memo.dy = 1000;
        window.ManuscriptPrint.prepare(window.Reader.printSnapshot(), writing);
        window.ManuscriptPrint.clear();
      });
      // Reposition to the captured reader anchor after the test opened a note.
      await page.evaluate(anchor => window.Reader.restore(anchor), before.anchor);
      await open(page); assert.match(await page.locator('#pdf-layout-info').textContent(), /書き込み7件を含みます/);
      await page.locator('#pdf-cancel').click(); sameState(await state(page), before);
      await open(page);
      await page.locator('#manuscript-print').evaluate(el => el.classList.add('print-measuring'));
      const printed = await page.locator('.manuscript-page').evaluateAll(sheets => sheets.map(sheet => {
        const page = sheet.getBoundingClientRect(), canvas = sheet.firstChild, box = canvas.getBoundingClientRect();
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left - page.left, y: r.top - page.top, width: r.width, height: r.height }; };
        const ink = el => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { x: b.left - page.left, y: b.top - page.top }; };
        return { width: page.width, height: page.height, scale: Number(canvas.dataset.scale), left: box.left - page.left,
          rows: [...sheet.querySelectorAll('.manuscript-line')].map(row => { const body = row.cloneNode(true); body.querySelectorAll('rt').forEach(rt => rt.remove()); return { index: Number(row.dataset.sourceLine), text: body.textContent, first: ink(row.firstChild.querySelector('ruby')?.firstChild || row.firstChild) }; }),
          markers: [...sheet.querySelectorAll('.manuscript-markers rect')].map(el => ({ offset: Number(el.dataset.offset), ...rect(el) })),
          pens: [...sheet.querySelectorAll('.manuscript-pens path[data-mark-id]')].map(el => ({ id: Number(el.dataset.markId), row: Number(el.dataset.sourceLine), d: el.getAttribute('d'), stroke: Number(el.getAttribute('stroke-width')) })),
          memos: [...sheet.querySelectorAll('.manuscript-memo')].map(el => ({ id: Number(el.dataset.markId), offset: Number(el.dataset.offset), text: el.lastChild.textContent, font: parseFloat(getComputedStyle(el).fontSize), ...rect(el) })),
          z: ['.manuscript-markers', '.manuscript-line', '.manuscript-pens', '.manuscript-memo'].map(sel => getComputedStyle(sheet.querySelector(sel) || canvas).zIndex)
        };
      }));
      assert.ok(printed.length >= 2);
      const rows = printed.flatMap(p => p.rows);
      assert.deepEqual(rows.map(row => row.text), snap.lines.filter(line => line.pieces.some(p => p.text.trim())).map(line => line.pieces.map(p => p.text).join('')), 'no missing/duplicated text or changed wrapping');
      const glyphs = new Map(snap.glyphs.map(g => [g.start, g]));
      let drawnLength = 0;
      for (const sheet of printed) {
        const byRow = new Map(sheet.rows.map(row => [row.index, row]));
        const shift = index => byRow.get(index).first.y / sheet.scale - snap.lines[index].pieces[0].top;
        for (const mark of sheet.markers) {
          const g = glyphs.get(mark.offset); assert.ok(byRow.has(g.line), 'marker follows text onto its page');
          assert.ok(Math.abs(mark.x - sheet.left - g.x * sheet.scale) < .06);
          assert.ok(Math.abs(mark.y - (g.y + shift(g.line)) * sheet.scale) < .1);
          assert.ok(Math.abs(mark.width - g.width * sheet.scale) < .06, JSON.stringify({ mark, glyph: g, scale: sheet.scale }));
        }
        for (const pen of sheet.pens) {
          assert.ok(byRow.has(pen.row)); assert.ok(Math.abs(pen.stroke - 2.8 * sheet.scale) < .001);
          let previous;
          for (const token of pen.d.matchAll(/([ML])([-\d.e+]+),([-\d.e+]+)/g)) {
            const point = { x: Number(token[2]), y: Number(token[3]) };
            assert.ok(sheet.left + point.x >= pen.stroke / 2 - .1 && sheet.left + point.x <= sheet.width - pen.stroke / 2 + .1, 'pen horizontally inside paper');
            assert.ok(point.y >= pen.stroke / 2 - .1 && point.y <= sheet.height - pen.stroke / 2 + .1, 'pen vertically inside paper');
            if (pen.id === 6 && token[1] === 'L') drawnLength += Math.hypot(point.x - previous.x, point.y - previous.y) / sheet.scale;
            previous = point;
          }
        }
        let bottom = 0;
        for (const memo of sheet.memos) {
          assert.ok(byRow.has(glyphs.get(memo.offset).line), 'memo stays on the anchor page');
          assert.ok(memo.x >= sheet.left + snap.width * sheet.scale && memo.x + memo.width <= sheet.width + .1, 'memo never covers body or escapes paper');
          assert.ok(memo.y >= bottom - .1 && memo.y + memo.height <= sheet.height + .1, 'memos do not overlap or clip');
          assert.ok(memo.font >= 12); bottom = memo.y + memo.height;
        }
        assert.deepEqual(sheet.z.slice(0, 3), ['0', '1', '2']);
      }
      assert.equal(printed.flatMap(p => p.markers).length, snap.glyphs.length, 'only original glyphs highlighted, never manual readings');
      assert.ok(printed.filter(p => p.pens.some(pen => pen.id === 6)).length >= 2, 'stroke crosses pages');
      assert.ok(Math.abs(drawnLength - length(raw)) < .01, 'split stroke preserves the entire shape without gaps or duplicates');
      assert.equal(printed.flatMap(p => p.memos).length, 4);
      assert.equal(await page.locator('#manuscript-print b, #manuscript-print img').count(), 0, 'safe text');
      assert.equal(await page.locator('#manuscript-print rt').count(), data.sourceRubies.length, 'source ruby coexists with all writing layers');
      await page.locator('#manuscript-print').evaluate(el => el.classList.remove('print-measuring'));
      await page.evaluate(() => { window.print = () => {}; }); await page.locator('#pdf-print').click(); await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(output, `markings-${width}.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      sameState(await state(page), before);
      // After reflow, the complex pen is excluded with a count/reason, while its
      // JSON data and undo history remain intact. Print is never a data edit.
      await page.evaluate(() => window.Reader.configure({ height: 2.6 }));
      const hidden = await state(page); assert.ok(hidden.writing.hiddenPens > 0);
      await open(page); assert.match(await page.locator('#pdf-layout-info').textContent(), new RegExp(`一時非表示になっている赤ペン${hidden.writing.hiddenPens}件はPDFに含まれません`));
      assert.equal(await page.locator('.manuscript-pens path[data-mark-id="6"]').count(), 0);
      await page.locator('#pdf-cancel').click(); sameState(await state(page), hidden);
      await page.locator('[data-writing-tool=pen]').click(); await page.evaluate(() => scrollTo(0, 0));
      const start = await page.evaluate(() => { const r = document.getElementById('reader').getBoundingClientRect(), g = window.Reader.getWritingGeometry().glyphs[0]; return { x: r.left + g.x + g.width / 2, y: r.top + g.y + g.height / 2 }; });
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 10, start.y + 7);
      assert.equal(await page.locator('#writing-pen path[data-mark-id=draft]').count(), 1);
      await page.evaluate(() => window.ManuscriptPrint.prepare(window.Reader.printSnapshot(), window.ManuscriptWriting.printSnapshot()));
      assert.equal(await page.locator('#manuscript-print [data-mark-id=draft]').count(), 0);
      assert.equal(await page.locator('#writing-pen path[data-mark-id=draft]').count(), 1, 'preparation does not commit/cancel a live stroke');
      await page.evaluate(() => { window.ManuscriptPrint.clear(); window.ManuscriptWriting.cancelPending(); }); await page.mouse.up();
      await page.locator('[data-writing-tool=memo]').click(); await page.evaluate(anchor => window.Reader.restore(anchor), hidden.anchor);
      sameState(await state(page), hidden);
      // Impossible same-anchor note stacks fail explicitly, without truncation.
      await page.locator('#reader-back').click(); const crowded = { ...data, marks: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, type: 'memo', offset: 0, dx: .4, dy: 0, text: '長いメモをすべて残して読むための文字です。'.slice(0, 20).repeat(2) })) };
      await choose(page, crowded); await page.locator('#confirm-ok').click(); await complete(page);
      const crowdedBefore = await state(page);
      await page.locator('#operations').click(); await page.locator('#export-pdf').click();
      await page.waitForFunction(() => document.getElementById('notice').textContent.includes('文字メモが1ページに収まりません'));
      assert.match(await page.locator('#notice').textContent(), /文字メモが1ページに収まりません/);
      assert.equal(await page.locator('#manuscript-print').evaluate(el => el.children.length), 0); sameState(await state(page), crowdedBefore);
      assert.equal(requests.length, requestCount); assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: ${printed.length} pages, restored vectors/markers/memos, clipping/anchor pages, hidden warnings, safe text, cancellation/state, crowded-note error`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

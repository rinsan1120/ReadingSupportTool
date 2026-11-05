// Straight-line pen mode: two clicks draw a two-point pen that reuses the
// freehand storage, so screen and PDF geometry must agree exactly.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew, saveUser } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const glyphPoint = (page, offset, dx = 0, dy = 0) => page.evaluate(([o, x, y]) => {
  const g = window.Reader.getWritingGeometry(), root = document.getElementById('reader').getBoundingClientRect();
  const glyph = g.byOffset.get(o);
  return { x: root.left + glyph.x + glyph.width / 2 + x, y: root.top + glyph.y + glyph.height / 2 + y };
}, [offset, dx, dy]);
const marksOf = async page => (await saveUser(page)).manuscripts[0].manuscript.marks;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const text = '本文を読みます。次の文です。'.repeat(30);
    const data = { format: 'reading-support-manuscript', version: 5, text, annotations: [], sourceRubies: [], marks: [], memoSettings: { fontSize: 16, opacity: .9 } };
    // ---- Desktop: horizontal line, cancel paths, freehand regression ----
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await startNew(page);
    await page.locator('[data-go=read-input]').click();
    await page.locator('#manuscript-file').setInputFiles({ name: 'line.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.locator('#reader').waitFor();
    await page.locator('#writing-mode').click();
    await page.locator('[data-writing-tool=pen]').click();
    await page.locator('#pen-line-mode').click();
    assert.equal(await page.locator('#pen-line-mode').getAttribute('aria-pressed'), 'true');
    const a = await glyphPoint(page, 0), b = await glyphPoint(page, 42);
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y, { steps: 4 });
    const draft = page.locator('#writing-pen path[data-mark-id="draft"]');
    assert.equal(await draft.count(), 1, 'armed line shows a draft path');
    await page.mouse.click(b.x, b.y);
    assert.equal(await draft.count(), 0, 'draft is committed');
    let marks = await marksOf(page);
    const line = marks.find(m => m.type === 'pen');
    assert.ok(line, 'line saved as a pen');
    assert.equal(line.points.length, 2);
    assert.equal(line.direction, 'horizontal');
    assert.equal(line.color, 'red');
    assert.ok(line.witnesses.some(w => w.offset === line.offset && w.x === 0 && w.y === 0));
    assert.ok(line.witnesses.length >= 2, 'endpoint witness recorded');
    // PDF fidelity: fragment lengths / scale reproduce the on-screen length.
    const fidelity = await page.evaluate(id => {
      const snapshot = window.Reader.printSnapshot(), writing = window.ManuscriptWriting.printSnapshot({ forPrint: true });
      const mine = writing.pens.find(p => p.id === id);
      const screenLength = Math.hypot(mine.points[1].x - mine.points[0].x, mine.points[1].y - mine.points[0].y);
      const result = window.ManuscriptPrint.prepare(snapshot, writing);
      const paths = [...document.querySelectorAll(`#manuscript-print .manuscript-pens path[data-mark-id="${id}"]`)];
      const printed = paths.reduce((sum, p) => {
        const pts = [...p.getAttribute('d').matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(m => ({ x: +m[1], y: +m[2] }));
        return sum + pts.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);
      }, 0);
      window.ManuscriptPrint.clear();
      return { screenLength, printedLength: printed / result.scale, paths: paths.length };
    }, line.id);
    assert.ok(fidelity.paths >= 1);
    assert.ok(Math.abs(fidelity.printedLength - fidelity.screenLength) < fidelity.screenLength * 0.02 + 1,
      `PDF length ${fidelity.printedLength} vs screen ${fidelity.screenLength}`);
    // Escape cancels an armed line.
    await page.mouse.click(a.x, a.y);
    assert.equal(await draft.count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await draft.count(), 0);
    // Tool switch cancels an armed line.
    await page.mouse.click(a.x, a.y);
    assert.equal(await draft.count(), 1);
    await page.locator('[data-writing-tool=marker]').click();
    assert.equal(await draft.count(), 0);
    marks = await marksOf(page);
    assert.equal(marks.filter(m => m.type === 'pen').length, 1, 'cancelled lines are not saved');
    // Freehand still works after leaving line mode.
    await page.locator('[data-writing-tool=pen]').click();
    await page.locator('#pen-line-mode').click();
    assert.equal(await page.locator('#pen-line-mode').getAttribute('aria-pressed'), 'false');
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    marks = await marksOf(page);
    const free = marks.filter(m => m.type === 'pen').at(-1);
    assert.ok(free.points.length > 2, 'freehand stroke has many points');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('desktop: line commit, PDF fidelity, cancel paths, freehand regression passed');
    // ---- Vertical line ----
    const vpage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const verrors = []; vpage.on('pageerror', e => verrors.push(e.message));
    await vpage.goto(`http://127.0.0.1:${server.address().port}/`);
    await startNew(vpage);
    await vpage.locator('[data-go=read-input]').click();
    await vpage.locator('#manuscript-file').setInputFiles({ name: 'linev.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...data, writingDirection: 'vertical' })) });
    await vpage.locator('#reader').waitFor();
    await vpage.locator('#writing-mode').click();
    await vpage.locator('[data-writing-tool=pen]').click();
    await vpage.locator('#pen-line-mode').click();
    const va = await glyphPoint(vpage, 0), vb = await glyphPoint(vpage, 42);
    await vpage.mouse.click(va.x, va.y);
    await vpage.mouse.move(vb.x, vb.y, { steps: 4 });
    await vpage.mouse.click(vb.x, vb.y);
    const vmarks = await marksOf(vpage);
    const vline = vmarks.find(m => m.type === 'pen');
    assert.ok(vline); assert.equal(vline.points.length, 2); assert.equal(vline.direction, 'vertical');
    await vpage.locator('#writing-mode').click();
    await vpage.locator('#export-pdf').click();
    await vpage.waitForFunction(() => document.getElementById('pdf-dialog').open);
    assert.ok(await vpage.locator(`.manuscript-pens path[data-mark-id="${vline.id}"]`).count() >= 1, 'vertical line appears in PDF');
    await vpage.locator('#pdf-cancel').click();
    assert.deepEqual(verrors, []);
    await vpage.close();
    console.log('vertical: line commit and PDF presence passed');
    // ---- Touch: tap, tap ----
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const tpage = await context.newPage();
    const terrors = []; tpage.on('pageerror', e => terrors.push(e.message));
    await tpage.goto(`http://127.0.0.1:${server.address().port}/`);
    await startNew(tpage);
    await tpage.locator('[data-go=read-input]').click();
    await tpage.locator('#manuscript-file').setInputFiles({ name: 'linet.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await tpage.locator('#reader').waitFor();
    await tpage.locator('#writing-mode').click();
    await tpage.locator('[data-writing-tool=pen]').click();
    await tpage.locator('#pen-line-mode').click();
    const ta = await glyphPoint(tpage, 0), tb = await glyphPoint(tpage, 28);
    const cdp = await context.newCDPSession(tpage);
    const tap = async p => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await tap(ta);
    assert.equal(await tpage.locator('#writing-pen path[data-mark-id="draft"]').count(), 1, 'first tap arms the line');
    await tap(tb);
    const tmarks = await marksOf(tpage);
    const tline = tmarks.find(m => m.type === 'pen');
    assert.ok(tline, 'second tap commits the line');
    assert.equal(tline.points.length, 2);
    assert.deepEqual(terrors, []);
    await context.close();
    console.log('touch: tap-tap line passed');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

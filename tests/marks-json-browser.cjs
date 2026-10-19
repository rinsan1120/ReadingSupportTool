// Playwright + Chrome. Exercise actual downloads, file import and editing;
// malformed files must leave BOTH manuscript models and textarea drafts intact.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'app.js'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const text = '黄昏の空に狐が現れた。\r\n\r\n👩‍👩‍👧‍👦と、が、𠮷【原文】。\n' + '静かな森で間を取って読む。'.repeat(40);
const fox = text.indexOf('狐');
const original = { format: 'reading-support-manuscript', version: 2, text,
  annotations: [{ offset: 2, text: 'たそがれ' }], sourceRubies: [{ start: fox, end: fox + 1, reading: 'きつね' }] };
const writingOn = async page => { await page.locator('#operations').click(); await page.locator('#writing-mode').click(); };
const tool = (page, type) => page.locator(`[data-writing-tool=${type}]`).click();
const point = async (page, offset) => {
  const get = () => page.evaluate(offset => {
    const r = document.getElementById('reader').getBoundingClientRect(), g = window.Reader.getWritingGeometry().byOffset.get(offset);
    return { x: r.left + g.x + g.width / 2, y: r.top + g.y + g.height / 2 };
  }, offset);
  const p = await get();
  await page.evaluate(y => {
    const edge = document.querySelector('.reader-controls').getBoundingClientRect().bottom;
    if (y < edge + 15 || y > innerHeight - 60) scrollBy(0, y - edge - 80);
  }, p.y);
  return get();
};
const save = async (page, direct = false) => {
  if (!direct) await page.locator('#operations').click();
  const pending = page.waitForEvent('download');
  if (direct) await page.locator('#export-manuscript').evaluate(el => el.click()); else await page.locator('#export-manuscript').click();
  const download = await pending; assert.equal(download.suggestedFilename(), 'reading-manuscript.json');
  return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
};
const choose = (page, data, raw = false) => page.locator('#manuscript-file').setInputFiles({
  name: 'manuscript.json', mimeType: 'application/json', buffer: Buffer.from(raw ? data : JSON.stringify(data), 'utf8')
});
const complete = page => page.waitForFunction(() => !document.getElementById('import-manuscript').disabled);
const renderedCounts = page => page.evaluate(() => ({ pen: document.querySelectorAll('#writing-pen path').length,
  marker: new Set([...document.querySelectorAll('#writing-markers rect')].map(el => el.dataset.markId)).size, memo: document.querySelectorAll('.writing-memo').length }));

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
      const url = `http://127.0.0.1:${server.address().port}/`;
      await page.goto(url); await page.locator('[data-go="read-input"]').click(); await choose(page, original); await complete(page);
      const storage = () => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      const initialStorage = await storage();
      const count = await page.locator('#read-count').textContent();
      await writingOn(page);
      const p = await point(page, fox);
      await page.mouse.move(p.x + 6, p.y - 7); await page.mouse.down(); await page.mouse.move(p.x - 4, p.y + 7, { steps: 5 }); await page.mouse.up();
      await tool(page, 'marker'); const first = await point(page, 0), last = await point(page, 4);
      await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(last.x, last.y, { steps: 8 }); await page.mouse.up();
      await tool(page, 'memo'); const memoAt = await point(page, fox); await page.mouse.click(memoAt.x, memoAt.y);
      await page.locator('#writing-memo-input').fill('少し大'); await page.locator('#writing-memo-save').click();
      // Draw a complex stroke in the layout WITH the memo rail present.
      await tool(page, 'pen'); const a = await point(page, 0), b = await point(page, fox);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
      const saved = await save(page);
      assert.deepEqual({ ...saved, version: 2, marks: undefined }, { ...original, marks: undefined });
      assert.equal(saved.version, 3); assert.deepEqual(saved.marks.map(m => m.type), ['pen', 'marker', 'memo', 'pen']);
      assert.deepEqual(Object.keys(saved).sort(), ['annotations', 'format', 'marks', 'sourceRubies', 'text', 'version']);
      assert.equal(saved.marks.some(m => 'history' in m || 'nextId' in m), false);
      const penGeometry = await page.locator('#writing-pen path').evaluateAll(nodes => nodes.map(el => el.getAttribute('d')));
      assert.equal(penGeometry.length, 2);
      // Neither an unfinished line nor text being edited enters the file.
      const unfinished = await point(page, fox);
      await page.mouse.move(unfinished.x, unfinished.y); await page.mouse.down(); await page.mouse.move(unfinished.x + 7, unfinished.y + 8);
      assert.deepEqual(await save(page, true), saved);
      await page.evaluate(() => window.ManuscriptWriting.cancelPending()); await page.mouse.up();
      await tool(page, 'memo'); await page.locator('.writing-memo').click(); await page.locator('#writing-memo-input').fill('未登録');
      assert.deepEqual(await save(page, true), saved); await page.locator('#writing-memo-cancel').click();
      // Fresh load simulates next visit; no manuscript or history in Storage.
      await page.reload(); await page.locator('[data-go="read-input"]').click(); await choose(page, saved); await complete(page);
      assert.equal(await page.locator('#read-count').textContent(), count);
      assert.equal(await page.locator('#read-text').inputValue(), text.replace(/\r\n?/g, '\n'));
      assert.equal(await page.locator('#ruby-mode').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#writing-toolbar').isVisible(), false);
      assert.deepEqual(await renderedCounts(page), { pen: 2, marker: 1, memo: 1 });
      assert.deepEqual(await page.locator('#writing-pen path').evaluateAll(nodes => nodes.map(el => el.getAttribute('d'))), penGeometry);
      assert.deepEqual(await save(page), saved);
      await writingOn(page); assert.equal(await page.locator('#writing-undo').isDisabled(), true, 'undo history starts empty');
      await tool(page, 'memo'); await page.locator('.writing-memo').click();
      await page.locator('#writing-memo-input').fill('<b>ゆっくり</b>'); await page.locator('#writing-memo-save').click();
      assert.equal(await page.locator('.writing-memo b').count(), 0); assert.match(await page.locator('.writing-memo').textContent(), /<b>ゆっくり<\/b>/);
      const edited = structuredClone(saved); edited.marks.find(m => m.type === 'memo').text = '<b>ゆっくり</b>';
      assert.deepEqual(await save(page), edited);
      await tool(page, 'eraser'); await page.locator('.writing-memo').click(); assert.equal((await renderedCounts(page)).memo, 0);
      await page.locator('#writing-undo').click(); assert.equal((await renderedCounts(page)).memo, 1);
      await tool(page, 'marker'); const extra = await point(page, text.indexOf('👩')); await page.mouse.click(extra.x, extra.y);
      const extended = await save(page);
      assert.equal(new Set(extended.marks.map(m => m.id)).size, extended.marks.length);
      assert.ok(extended.marks.at(-1).id > Math.max(...saved.marks.map(m => m.id)));
      // A hidden stroke stays byte-for-byte in the model and subsequent save.
      await page.evaluate(() => window.Reader.configure({ height: 2.6 }));
      assert.equal((await renderedCounts(page)).pen, 1); assert.match(await page.locator('#writing-status').textContent(), /一時非表示/);
      assert.deepEqual(await save(page), extended);
      await page.locator('#reader-back').click();
      const draft = text.replace(/\r\n?/g, '\n') + '入力途中';
      await page.locator('#read-text').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input')); }, draft);
      // Each file fails as a whole, including errors in its last mark.
      const pen = saved.marks[0], marker = saved.marks[1], memo = saved.marks[2];
      const bad = [];
      const failure = (marks, reason) => bad.push([{ ...saved, marks }, reason]);
      for (const value of [undefined, null, {}, 'marks']) failure(value, /marks/);
      for (const value of [null, [], {}, { ...marker, type: 'other' }, { ...marker, type: {} }]) failure([value], /種類/);
      for (const id of [0, -1, .5, '1', null, Number.MAX_SAFE_INTEGER + 1]) failure([{ ...marker, id }], /ID/);
      failure([marker, marker], /重複/);
      for (const offset of [-1, .5, text.length, text.length + 1, '0', text.indexOf('👩') + 2, text.indexOf('が') + 1, text.indexOf('\r')]) failure([{ ...memo, offset }], /offset/);
      for (const [start, end] of [[0, 0], [2, 1], [-1, 2], [0, text.length + 1], [0, .5], [0, text.indexOf('👩') + 1]]) failure([{ ...marker, start, end }], /範囲|境界/);
      for (const points of [null, [], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 0 }], [null, { x: 0, y: 0 }], [{ x: '1', y: 0 }, { x: 0, y: 0 }], [{ x: 1001, y: 0 }, { x: 0, y: 0 }], Array.from({ length: 2001 }, () => ({ x: 0, y: 0 }))]) failure([{ ...pen, points }], /点列|座標|オブジェクト/);
      for (const witnesses of [null, [], [{ offset: fox, x: 1, y: 0 }], [pen.witnesses[0], pen.witnesses[0]], [{ offset: -1, x: 0, y: 0 }]]) failure([{ ...pen, witnesses }], /補助|offset|重複/);
      for (const layoutKey of [null, '', 'x'.repeat(101), '0:1.8:5:0', '40:11:5:0', '40:1.8:101:0', '40:1.8:5:4294967296']) failure([{ ...pen, layoutKey }], /layoutKey/);
      for (const content of [null, '', '　', 'a\nb', 'a\u2028b', '長'.repeat(41)]) failure([{ ...memo, text: content }], /メモ/);
      for (const dx of [null, '1', 1001, -1001]) failure([{ ...memo, dx }], /座標/);
      failure([{ ...marker, history: [] }], /未対応/);
      failure(Array.from({ length: 1001 }, (_, i) => ({ ...marker, id: i + 1 })), /1,000件/);
      const many = Array.from({ length: 51 }, (_, i) => ({ ...pen, id: i + 1, points: Array.from({ length: 2000 }, (_, j) => ({ x: j % 2, y: 0 })), witnesses: [{ offset: fox, x: 0, y: 0 }] }));
      failure(many, /100,000件/);
      bad.push([{ ...saved, text: '長'.repeat(200001) }, /200,000/]);
      bad.push([{ ...saved, annotations: Array(10001).fill({ offset: 0, text: 'よみ' }) }, /10,000/]);
      bad.push([{ ...saved, sourceRubies: Array(10001).fill(saved.sourceRubies[0]) }, /10,000/]);
      bad.push([{ ...saved, version: 2 }, /version 3/]);
      bad.push([JSON.stringify(saved).replace(`"x":${JSON.stringify(pen.points[0].x)}`, '"x":1e309'), /座標/, true]);
      bad.push([JSON.stringify(saved).replace(`"x":${JSON.stringify(pen.points[0].x)}`, '"x":NaN'), /JSON/, true]);
      for (const [invalid, reason, raw] of bad) {
        await choose(page, invalid, raw); await complete(page);
        assert.match(await page.locator('#notice').textContent(), reason);
        assert.equal(await page.locator('#confirm-dialog').evaluate(el => el.open), false);
        assert.equal(await page.locator('#read-text').inputValue(), draft);
      }
      await page.evaluate(() => { window.originalArrayBuffer = File.prototype.arrayBuffer; File.prototype.arrayBuffer = () => { throw new Error('must not read oversized file'); }; });
      await choose(page, ' '.repeat(10 * 1024 * 1024 + 1), true); await complete(page);
      assert.match(await page.locator('#notice').textContent(), /10MiB/);
      await page.evaluate(() => { File.prototype.arrayBuffer = window.originalArrayBuffer; });
      await choose(page, saved); await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
      assert.match(await page.locator('#confirm-message').textContent(), /書き込み.*失われます/);
      await page.locator('#confirm-cancel').click(); await complete(page); assert.equal(await page.locator('#read-text').inputValue(), draft);
      await page.locator('#read-text').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input')); }, text);
      await page.locator('#open-read').click(); assert.deepEqual(await save(page), extended, 'failures and cancel preserve hidden and visible marks');
      // Saving rejects model/source mismatch and non-finite runtime coordinates.
      const rejected = await page.evaluate(data => {
        const { manuscript, markings } = window.ManuscriptMarks.restoreManuscript(JSON.stringify(data));
        const messages = [];
        markings.source += '変更'; try { window.ManuscriptMarks.serializeManuscript(manuscript, markings); } catch (e) { messages.push(e.message); }
        markings.source = manuscript.source;
        for (const value of [NaN, Infinity, -Infinity]) {
          markings.items[0].points[0].x = value;
          try { window.ManuscriptMarks.serializeManuscript(manuscript, markings); } catch (e) { messages.push(e.message); }
        }
        return messages;
      }, saved);
      assert.match(rejected[0], /原文が一致/); assert.equal(rejected.length, 4);
      // High restored IDs cannot collide, even when MAX_SAFE_INTEGER wraps.
      await page.locator('#reader-back').click(); const highId = { ...saved, marks: [{ ...memo, id: Number.MAX_SAFE_INTEGER }] };
      await choose(page, highId); await page.locator('#confirm-ok').click(); await complete(page);
      await writingOn(page); await tool(page, 'marker'); const at = await point(page, 0); await page.mouse.click(at.x, at.y);
      assert.deepEqual((await save(page)).marks.map(m => m.id), [Number.MAX_SAFE_INTEGER, 1]);
      // Old versions still load with empty marks, and upgrade only on explicit save.
      for (const version of [1, 2]) {
        await page.locator('#reader-back').click(); const legacy = { ...original, version };
        if (version === 1) delete legacy.sourceRubies;
        await choose(page, legacy); await page.locator('#confirm-ok').click(); await complete(page);
        assert.deepEqual(await renderedCounts(page), { pen: 0, marker: 0, memo: 0 });
        assert.deepEqual(await save(page), { ...legacy, version: 3, sourceRubies: legacy.sourceRubies || [], marks: [] });
      }
      assert.equal(await storage(), initialStorage);
      assert.equal(requests.filter(request => !request.startsWith(url)).length, 0);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: JSON v3 marks round trip/editing, hidden strokes, ids/history, ${bad.length + 1} invalid-file cases, v1/v2 upgrade, no Storage/network writes`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

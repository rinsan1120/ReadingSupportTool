// Run with Playwright on NODE_PATH and Chrome installed. These synthetic MIME
// payloads exercise the app, not the Android OS clipboard or software keyboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew, saveUser } = require('./file-session.cjs');
const root = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/aozora-ruby.html'), 'utf8');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js',
  'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!files.has(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, name)));
});
const paste = (page, id, html, plain, start = 0, end = null) => page.locator(`#${id}`).evaluate((el, args) => {
  el.focus(); el.setSelectionRange(args.start, args.end ?? el.value.length);
  const data = new DataTransfer();
  if (args.html) data.setData('text/html', args.html);
  data.setData('text/plain', args.plain);
  const native = el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  // Untrusted paste events do not insert text. Simulate default insertion only
  // when the real handler has left it to the browser; never insert twice.
  if (native) { el.setRangeText(args.plain, el.selectionStart, el.selectionEnd, 'end'); el.dispatchEvent(new Event('input')); }
  return native;
}, { html, plain, start, end });
const source = page => page.locator('#reader').evaluate(el => {
  const copy = el.cloneNode(true); copy.querySelectorAll('rt,.reading-annotation').forEach(n => n.remove()); return copy.textContent;
});
const confirm = async (page, answer) => {
  // dialog.close() queues its close event. Wait for that event (and the app's
  // promise continuation), rather than racing the next paste against it.
  await page.locator('#confirm-dialog').evaluate(el => {
    window.clipboardTestClosed = new Promise(resolve => el.addEventListener('close', resolve, { once: true }));
  });
  await page.locator(`#confirm-${answer}`).click();
  await page.evaluate(async () => { await window.clipboardTestClosed; delete window.clipboardTestClosed; });
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1200, 390, 320]) {
      for (const id of ['read-text', 'time-text']) {
        const cases = [
          { html: fixture, plain: '狐きつねの親子の棲すんでいる森。', rich: true },
          { plain: '寒い冬が北方から、狐きつねの親子の棲すんでいる森へ。\n或朝あるあさ洞穴ほらあなから、眼めを抑おさえた。' },
          { plain: '狐（きつね）の話。（ここから後半）漢字(説明)、山（やま）へ行く。\nが・𠮷・👩‍👩‍👧‍👦を残す。' },
          { html: '<p>狐きつねの親子。説明（補足）</p>', plain: '狐きつねの親子。説明（補足）' }
        ];
        for (const { html = '', plain, rich = false } of cases) {
          const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
          try {
            const page = await context.newPage(), errors = [], external = [];
            page.setDefaultTimeout(8000);
            page.on('pageerror', e => errors.push(e.message));
            const url = `http://127.0.0.1:${server.address().port}/`;
            page.on('request', r => { if (!r.url().startsWith(url)) external.push(r.url()); });
            await page.goto(url); await startNew(page);
            await page.locator(`#home [data-go="${id === 'read-text' ? 'read-input' : 'time-input'}"]`).click();
            if (id === 'time-text') await page.locator('[name=source][value=custom]').check();
            const parsed = rich ? await page.evaluate(html => window.HTMLRubyImporter.parse(html).toJSON(), html) : null;
            const expected = parsed?.text ?? plain;
            if (rich) {
              assert.equal(parsed.sourceRubies.length, 6);
              assert.deepEqual(parsed.sourceRubies.map(r => parsed.text.slice(r.start, r.end)), ['狐', '棲', '或朝', '洞穴', '眼', '抑']);
              assert.deepEqual(parsed.sourceRubies.map(r => r.reading), ['きつね', 'す', 'あるあさ', 'ほらあな', 'め', 'おさ']);
              assert.equal(expected, '　寒い冬が北方から、狐の親子の棲んでいる森へもやって来ました。\n　或朝洞穴から子供の狐が出ようとしましたが、\n「あっ」と叫んで眼を抑えながら母さん狐のところへころげて来ました。');
            }
            assert.equal(await paste(page, id, html, plain), !rich);
            assert.equal(await page.locator(`#${id}`).inputValue(), expected);
            if (!rich) {
              assert.equal(await paste(page, id, html, plain, 0, 1), false);
              assert.equal(await page.locator(`#${id}`).inputValue(), plain + plain.slice(1));
              await paste(page, id, html, plain); await confirm(page, 'cancel');
              assert.equal(await page.locator(`#${id}`).inputValue(), plain + plain.slice(1));
              await paste(page, id, html, plain); await confirm(page, 'ok');
              assert.equal(await page.locator(`#${id}`).inputValue(), plain);
            }
            await page.locator(id === 'read-text' ? '#open-read' : '#prepare-time').click();
            assert.equal(await source(page), expected);
            assert.deepEqual(await page.locator('#reader rt').allTextContents(), parsed?.sourceRubies.map(r => r.reading) ?? []);
            await page.locator('[data-direction="vertical"]').click();
            assert.equal(await page.evaluate(() => Reader.direction), 'vertical');
            assert.equal(await source(page), expected);
            if (id === 'read-text') {
              const saved = await saveUser(page);
              const manuscript = saved.manuscripts.find(m => m.id === saved.activeId).manuscript;
              assert.equal(manuscript.text, expected);
              assert.deepEqual(manuscript.sourceRubies, parsed?.sourceRubies ?? []);
            }
            assert.deepEqual(errors, []); assert.deepEqual(external, []);
          } finally { await context.close(); }
        }
      }
      console.log(`PASS ${width}px: HTML ruby / flat plain / parentheses / non-ruby HTML; both inputs, replacement, reader, vertical and saved source`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());

'use strict';
// Paper (white background) preference: saved with the user data like the
// display settings, restored on load, and kept out of manuscript files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew } = require('./file-session.cjs');
const directory = path.join(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(path.join(directory, name)));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', error => { throw error; });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    await startNew(page);
    const data = { format: 'reading-support-manuscript', version: 6, title: '白背景', text: '本文を読みます。次の文です。'.repeat(10), annotations: [], sourceRubies: [], marks: [], memoSettings: { fontSize: 16, opacity: .9 } };
    await page.locator('[data-go=read-input]').click();
    await page.locator('#manuscript-file').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.locator('#reader').waitFor();
    assert.equal(await page.locator('#reader-stage').evaluate(el => el.classList.contains('paper-mode')), false);
    // Toggle on: applied immediately and written to the user data.
    await page.locator('#paper-mode').click();
    assert.equal(await page.locator('#reader-stage').evaluate(el => el.classList.contains('paper-mode')), true);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(UserLibrary.KEY)).paperMode === true);
    // Reload: the preference comes back with the manuscript.
    await page.reload();
    await startNew(page);
    await page.locator('#library-list .book-open').click();
    await page.locator('#reader').waitFor();
    assert.equal(await page.locator('#reader-stage').evaluate(el => el.classList.contains('paper-mode')), true);
    assert.equal(await page.locator('#paper-mode').getAttribute('aria-pressed'), 'true');
    // Toggle off persists too.
    await page.locator('#paper-mode').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(UserLibrary.KEY)).paperMode === false);
    console.log('paper persistence: toggle, storage and reload restore passed');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });

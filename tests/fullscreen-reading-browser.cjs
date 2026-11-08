'use strict';
// Fullscreen reading: manuscript-only view for reading without measuring.
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
async function openReader(page) {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await startNew(page);
  const data = { format: 'reading-support-manuscript', version: 6, title: '全画面', text: '本文を読みます。次の文です。'.repeat(60), annotations: [], sourceRubies: [], marks: [], memoSettings: { fontSize: 16, opacity: .9 } };
  await page.locator('#new-memo-title, #manuscript-title').first().fill('全画面').catch(() => {});
  await page.locator('[data-go=read-input]').click();
  await page.locator('#manuscript-file').setInputFiles({ name: 'zen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.locator('#reader').waitFor();
}
const zen = page => page.evaluate(() => ({
  on: document.body.classList.contains('zen-reading'), ui: document.body.classList.contains('zen-ui'),
  controlsVisible: !!document.querySelector('.reader-controls')?.offsetParent,
  fullscreen: Boolean(document.fullscreenElement)
}));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', error => { throw error; });
    await openReader(page);
    assert.equal(await page.locator('#fullscreen-reading').isVisible(), true);

    // Enter: header disappears, manuscript stays, exit UI shows then fades.
    await page.locator('#fullscreen-reading').click();
    await page.waitForFunction(() => document.body.classList.contains('zen-reading'));
    let state = await zen(page);
    assert.equal(state.on, true); assert.equal(state.controlsVisible, false); assert.equal(state.ui, true);
    assert.equal(await page.locator('#zen-exit').isVisible(), true);
    await page.waitForFunction(() => !document.body.classList.contains('zen-ui'), null, { timeout: 5000 });
    await page.mouse.move(300, 300);
    await page.waitForFunction(() => document.body.classList.contains('zen-ui'));
    // Exit via the floating button.
    await page.locator('#zen-exit').click();
    await page.waitForFunction(() => !document.body.classList.contains('zen-reading'));
    assert.equal((await zen(page)).controlsVisible, true);

    // Entering with the writing menu open closes writing first.
    await page.locator('#writing-mode').click();
    assert.equal(await page.locator('#writing-mode').getAttribute('aria-expanded'), 'true');
    await page.locator('#fullscreen-reading').click();
    await page.waitForFunction(() => document.body.classList.contains('zen-reading'));
    assert.equal(await page.locator('#writing-mode').getAttribute('aria-expanded'), 'false');
    // Esc leaves fullscreen reading (native fullscreen exit or the fallback key handler).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('zen-reading'), null, { timeout: 5000 });
    console.log('scroll: enter/exit, fade, writing-close, Esc passed');

    // Paged mode: page controls become a fading overlay, paging still works.
    await page.locator('#toolbar-settings').click(); await page.locator('#display-mode').selectOption('pages'); await page.locator('[data-close=settings-dialog]').click();
    await page.locator('#page-controls:not([hidden])').waitFor();
    const positionBefore = await page.locator('#page-position').textContent();
    await page.locator('#fullscreen-reading').click();
    await page.waitForFunction(() => document.body.classList.contains('zen-reading'));
    await page.mouse.move(400, 400);
    await page.waitForFunction(() => document.body.classList.contains('zen-ui'));
    assert.equal(await page.locator('#page-controls').isVisible(), true);
    await page.locator('#page-next').click();
    await page.waitForFunction(before => document.querySelector('#page-position')?.textContent !== before, positionBefore);
    await page.locator('#zen-exit').click();
    await page.waitForFunction(() => !document.body.classList.contains('zen-reading'));
    console.log('paged: overlay page controls and paging passed');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });

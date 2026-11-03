// Pen geometry is rigid across layouts; moving rebases one confirmed stroke.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew, saveUser } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..');
const output = process.env.READER_TEST_ARTIFACTS || path.join(directory, 'tmp', 'pen-move');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
const shape = points => points.map(p => ({ x: p.x - points[0].x, y: p.y - points[0].y }));
const sameShape = (a, b) => shape(a).forEach((p, i) => { close(p.x, shape(b)[i].x, 'shape x'); close(p.y, shape(b)[i].y, 'shape y'); });
const length = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
(async () => {
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 for(const width of [1200,390]) {
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await startNew(page);await page.locator('[data-go=read-input]').click();
 const pen=direction=>({id:direction==='vertical'?2:1,type:'pen',direction,offset:0,layoutKey:'40:1.8:5:0',fontSize:22,color:direction==='vertical'?'green':'blue',points:[{x:0,y:.5},{x:2,y:.5}],witnesses:[{offset:0,x:0,y:0}]});
 const data={format:'reading-support-manuscript',version:5,writingDirection:'vertical',text:'本文を読みます。'.repeat(40),annotations:[{offset:2,text:'ほんぶん'}],sourceRubies:[],marks:[pen('horizontal'),pen('vertical'),{id:3,type:'memo',offset:0,text:'元メモ',color:'pink',dx:1,dy:2,tx:0,ty:0,verticalPosition:{dx:-2,dy:3,tx:.2,ty:.3}}],memoSettings:{fontSize:16,opacity:.9}};
 await page.locator('#manuscript-file').setInputFiles({name:'v5.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await page.locator('#reader').waitFor();
 assert.equal(await page.locator('#writing-direction').count(),0);
 assert.equal(await page.locator('#writing-pen path[data-mark-id="1"]').count(),1);assert.equal(await page.locator('#writing-pen path[data-mark-id="2"]').count(),0);
 await page.locator('#writing-mode').click();await page.locator('[data-writing-tool=memo]').click();
 await page.locator('.memo-body').click();await page.locator('.memo-body').click();await page.locator('#writing-memo-input').fill('ロールバック中の編集');await page.locator('#writing-memo-save').click();
 await page.locator('#writing-off').click();
 await page.locator('#export-pdf').click();await page.waitForFunction(()=>document.getElementById('pdf-dialog').open);
 assert.equal(await page.locator('.manuscript-pens path[data-mark-id="2"]').count(),0);assert.ok(await page.locator('.manuscript-pens path[data-mark-id="1"]').count());await page.locator('#pdf-cancel').click();
 const saved=(await saveUser(page)).manuscripts[0].manuscript;
 assert.equal(saved.writingDirection,'vertical');assert.deepEqual(saved.marks.find(i=>i.id===2),data.marks[1]);assert.deepEqual(saved.marks.find(i=>i.id===3).verticalPosition,data.marks[2].verticalPosition);assert.equal(saved.marks.find(i=>i.id===3).text,'ロールバック中の編集');
 await page.locator('#reader-back').click();assert.equal(await page.locator('#read-text').getAttribute('readonly'),'');assert.ok(await page.locator('#rollback-protection').isVisible());
 // Even a synthetic modification cannot reset source annotations behind the guard.
 await page.locator('#read-text').evaluate(el=>{el.value='変更後';el.dispatchEvent(new Event('input'));});await page.locator('#open-read').click();assert.match(await page.locator('#notice').textContent(),/通常版/);
 await page.reload();await startNew(page);await page.locator('[data-go=read-input]').click();
 assert.equal(await page.locator('#read-text').getAttribute('readonly'),'');
 assert.deepEqual(errors,[]);await page.close();console.log(width+'px: v5 data, horizontal edit/PDF, hidden writing and direction retained; source guard passed');
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

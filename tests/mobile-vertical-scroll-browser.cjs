const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
const settle = page => page.waitForTimeout(260);
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 for(const fallback of [false,true]) {
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(fallback) await page.addInitScript(()=>{const original=CSS.supports.bind(CSS);CSS.supports=(...args)=>args[0]==='height'&&args[1]==='100svh'?false:original(...args)});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await startNew(page);await page.locator('[data-go=read-input]').click();
 const text='本文を読みます。\n\n'+'静かな森で声を聞く。👩‍👩‍👧‍👦が「声ー」。'.repeat(300);
 const data={format:'reading-support-manuscript',version:5,writingDirection:'vertical',text,annotations:[{offset:2,text:'ほんぶん'}],sourceRubies:[{start:0,end:2,reading:'ほんぶん'}],marks:[{id:1,type:'marker',start:0,end:text.indexOf('👩'),color:'pink'},{id:2,type:'pen',direction:'vertical',offset:0,layoutKey:'40:1.8:5:0',fontSize:22,color:'green',points:[{x:0,y:0},{x:1,y:1}],witnesses:[{offset:0,x:0,y:0}]}],memoSettings:{fontSize:16,opacity:.9}};
 await page.locator('#manuscript-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await page.locator('#reader').waitFor();await page.evaluate(()=>document.fonts.ready);await settle(page);
 const items=await page.evaluate(()=>ManuscriptWriting.printSnapshot().items);
 for(const measuring of [false,true]) {
 if(measuring){await page.locator('#measure-current').click();await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('measurement-status').textContent==='計測中');}
 await page.evaluate(()=>{document.activeElement?.blur();window.__layouts=0;document.getElementById('reader').addEventListener('reader-layout',()=>window.__layouts++);scrollTo(0,800)});await settle(page);
 assert.ok(await page.locator('.reader-controls').evaluate(el=>el.classList.contains('is-scroll-hidden')),'scroll down hides toolbar');
 const before=await page.evaluate(()=>({html:document.getElementById('reader').innerHTML,y:scrollY}));
 await page.evaluate(()=>{
 const original=Object.getOwnPropertyDescriptor(window,'innerHeight');const vv=window.visualViewport,originalVV=Object.getOwnPropertyDescriptor(vv,'height');
 window.__restoreHeights=()=>{Object.defineProperty(window,'innerHeight',original);if(originalVV)Object.defineProperty(vv,'height',originalVV);else delete vv.height;};
 for(const height of [900,960,844,920]){Object.defineProperty(window,'innerHeight',{configurable:true,value:height});Object.defineProperty(vv,'height',{configurable:true,value:height});window.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('resize'));}
 });await settle(page);
 const after=await page.evaluate(()=>({html:document.getElementById('reader').innerHTML,y:scrollY,layouts:window.__layouts,hidden:document.querySelector('.reader-controls').classList.contains('is-scroll-hidden'),items:ManuscriptWriting.printSnapshot().items}));
 assert.equal(after.layouts,0,'browser chrome height must not rebuild the manuscript');assert.equal(after.html,before.html);assert.equal(after.y,before.y,'height events must not restore/jump scroll');assert.ok(after.hidden,'height events must not reveal toolbar');assert.deepEqual(after.items,items);
 for(const delta of [-80,100,-90,120]){const y=await page.evaluate(d=>{const height=d>0?940:844;Object.defineProperty(window,'innerHeight',{configurable:true,value:height});Object.defineProperty(window.visualViewport,'height',{configurable:true,value:height});scrollBy(0,d);window.dispatchEvent(new Event('resize'));window.visualViewport.dispatchEvent(new Event('resize'));return scrollY},delta);await settle(page);assert.equal(await page.evaluate(()=>scrollY),y);assert.equal(await page.evaluate(()=>window.__layouts),0);assert.equal(await page.locator('.reader-controls').evaluate(el=>el.classList.contains('is-scroll-hidden')),delta>0);}
 await page.evaluate(()=>window.__restoreHeights());
 if(measuring){const fit=await page.evaluate(()=>({height:document.querySelector('.vertical-page').getBoundingClientRect().height,available:Reader.viewportHeight-document.querySelector('.reader-controls').getBoundingClientRect().height-document.getElementById('measurement-bar').getBoundingClientRect().height-12}));assert.ok(fit.height<=fit.available+2);}
 }
 const anchor = await page.evaluate(()=>Reader.capture());
 await page.setViewportSize({width:844,height:390});await settle(page);assert.ok(await page.evaluate(()=>window.__layouts)>0,'rotation must rebuild');
 const anchorY=await page.evaluate(offset=>{const g=Reader.getWritingGeometry().byOffset.get(offset);return document.getElementById('reader').getBoundingClientRect().top+g.y},anchor.offset);const visibleTop=await page.locator('.reader-controls').evaluate(el=>el.getBoundingClientRect().bottom);assert.ok(anchorY>=visibleTop&&anchorY<390,'rotation keeps source anchor below the revealed toolbar');
 const clone=await page.locator('#reader').evaluate(root=>{const c=root.cloneNode(true);c.querySelectorAll('rt,.reading-annotation').forEach(el=>el.remove());return c.textContent});assert.equal(clone,text);assert.deepEqual(await page.evaluate(()=>ManuscriptWriting.printSnapshot().items),items);assert.deepEqual(errors,[]);
 console.log(`mobile ${fallback?'fallback':'svh'}: no rebuild/scroll correction on chrome-height events; down/up toolbar, measurement, rotation and data preserved`);await page.close();
 }
 const desktop=await browser.newPage({viewport:{width:1200,height:900}});
 await desktop.goto(`http://127.0.0.1:${server.address().port}/`);await startNew(desktop);await desktop.locator('[data-go=read-input]').click();await desktop.locator('#read-text').fill('静かな森で声を聞く。'.repeat(400));await desktop.locator('#open-read').click();await desktop.locator('button[data-direction=vertical]').click();await settle(desktop);
 const desktopHeight=await desktop.locator('.vertical-page').first().evaluate(el=>el.getBoundingClientRect().height);await desktop.setViewportSize({width:1200,height:700});await settle(desktop);assert.ok(await desktop.locator('.vertical-page').first().evaluate(el=>el.getBoundingClientRect().height)<desktopHeight,'desktop window height resize remains supported');
 console.log('desktop: real height resize still updates vertical columns');await desktop.close();
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

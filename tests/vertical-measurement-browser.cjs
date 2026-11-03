const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startNew } = require('./file-session.cjs');
const directory = path.resolve(__dirname, '..'), output = path.join(directory, 'tmp', 'pdfs');
const files = new Set(['index.html', 'styles.css', 'samples.js', 'reading-annotations.js', 'html-ruby.js', 'reader.js', 'manuscript-writing.js', 'manuscript-print.js', 'user-library.js', 'app.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory, name)));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 for(const width of [1200,390]) {
 const page=await browser.newPage({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await startNew(page);await page.locator('[data-go=read-input]').click();
 const text='本文を読みます。\n\n'+'静かな森で声を聞く。'.repeat(100);
 const data={format:'reading-support-manuscript',version:5,writingDirection:'vertical',text,annotations:[{offset:2,text:'ほんぶん'}],sourceRubies:[{start:0,end:2,reading:'ほんぶん'}],marks:[{id:1,type:'marker',start:0,end:30,color:'pink'},{id:2,type:'pen',direction:'vertical',offset:0,layoutKey:'40:1.8:5:0',fontSize:22,color:'green',points:[{x:0,y:0},{x:1,y:1}],witnesses:[{offset:0,x:0,y:0}]},{id:3,type:'memo',offset:2,text:'間を取る',color:'pink',dx:1,dy:1,tx:0,ty:0,verticalPosition:{dx:-1,dy:1,tx:0,ty:0}}],memoSettings:{fontSize:16,opacity:.9}};
 await page.locator('#manuscript-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await page.locator('#reader').waitFor();
 const normalHeight=await page.locator('.vertical-page').first().evaluate(el=>el.getBoundingClientRect().height);
 const initial=await page.evaluate(()=>ManuscriptWriting.printSnapshot().items);
 await page.locator('#measure-current').click();await page.clock.install();await page.locator('#start').click();
 async function check(){
 await page.waitForTimeout(100);
 const r=await page.evaluate(()=>{
 const root=document.getElementById('reader'),c=document.querySelector('.reader-controls'),bar=document.getElementById('measurement-bar');
 const first=root.querySelector('.vertical-page');scrollTo(0,scrollY+first.getBoundingClientRect().top-c.getBoundingClientRect().height-12);
 const p=first.getBoundingClientRect(),controls=c.getBoundingClientRect(),b=bar.getBoundingClientRect();const clone=root.cloneNode(true);clone.querySelectorAll('rt,.reading-annotation').forEach(e=>e.remove());
 return {height:p.height,available:(visualViewport?.height??innerHeight)-controls.height-b.height-12,top:p.top,bottom:p.bottom,barTop:b.top,controlsBottom:controls.bottom,text:clone.textContent,readOnly:!ManuscriptWriting.enabled,items:ManuscriptWriting.printSnapshot().items};
 });
 assert.ok(r.height<=r.available+2,JSON.stringify(r));assert.ok(r.top>=r.controlsBottom-1);assert.ok(r.bottom<=r.barTop+1,JSON.stringify(r));assert.equal(r.text,text);assert.deepEqual(r.items,initial);assert.ok(r.readOnly);
 }
 await check();await page.clock.fastForward(3000);await check();await page.locator('#pause-measurement').click();await check();
 for(const size of [{width:844,height:390},{width:320,height:568},{width:568,height:320}]){await page.setViewportSize(size);await check();}
 await page.locator('#pause-measurement').click();await check();await page.clock.fastForward(3000);await check();
 await page.setViewportSize({width:390,height:844});await check();
 await page.evaluate(()=>document.getElementById('measurement-bar').style.paddingBottom='60px');await check();
 await page.evaluate(()=>document.getElementById('measurement-bar').style.paddingBottom='');await check();
 await page.clock.fastForward(1000);await page.locator('#finish').click();assert.ok(await page.locator('#results').isVisible());
 assert.deepEqual(errors,[]);console.log(width+'px: start/pause/resume/rotation/bar resize; columns, ruby, text and annotations preserved; normal height '+normalHeight);await page.close();
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

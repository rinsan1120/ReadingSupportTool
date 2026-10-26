const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '..');
const output = process.env.READER_TEST_ARTIFACTS || path.join(directory, 'tmp');
const files = new Set(['index.html','styles.css','samples.js','reading-annotations.js','html-ruby.js','reader.js','manuscript-writing.js','manuscript-print.js','app.js']);
const server = http.createServer((req,res) => {
  const name = new URL(req.url,'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(directory,name)));
});
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const width of [1200,390,320]) {
      const context = await browser.newContext({viewport:{width,height:844},hasTouch:true});
      const page = await context.newPage(); page.setDefaultTimeout(6000);
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const data={format:'reading-support-manuscript',version:4,text:'黄昏の空を見上げた。\n'+'静かな森で本を読む。\n'.repeat(100),annotations:[{offset:2,text:'たそがれ'}],sourceRubies:[{start:0,end:2,reading:'たそがれ'}],marks:[{id:1,type:'marker',start:0,end:2,color:'pink'}],memoSettings:{fontSize:16,opacity:.9}};
      await page.locator('[data-go=read-input]').click();
      await page.locator('#manuscript-file').setInputFiles({name:'memo.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
      await page.waitForFunction(()=>!document.getElementById('import-manuscript').disabled);

      await page.locator('#writing-mode').click(); await page.locator('#confirm-ok').click(); await page.locator('[data-writing-tool=memo]').click();
      const state=()=>page.evaluate(()=>window.ManuscriptWriting.printSnapshot());
      const glyph=async offset => page.evaluate(offset=>{const g=window.Reader.getWritingGeometry().byOffset.get(offset),r=document.getElementById('reader').getBoundingClientRect();return {x:r.left+g.x+g.width/2,y:r.top+g.y+g.height/2};},offset);
      const beforeWidth=await page.locator('#reader').evaluate(el=>el.getBoundingClientRect().width);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      let p=await glyph(3); await page.evaluate(y=>{const edge=document.querySelector('.reader-controls').getBoundingClientRect().bottom;if(y<edge+30)scrollBy(0,y-edge-40);},p.y);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));p=await glyph(3);
      await page.locator('[data-writing-tool=pen]').click();
      p=await glyph(3);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+20,p.y+8,{steps:4});await page.mouse.up();
      assert.equal((await state()).items.filter(m=>m.type==='pen').length,1);
      await page.locator('[data-writing-tool=memo]').click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      p=await glyph(3);await page.mouse.click(p.x,p.y);
      await page.locator('#writing-memo-input').fill('間をとる\n静かに読む'); await page.locator('#writing-memo-save').click();
      let memo=(await state()).items.find(m=>m.type==='memo'); assert.ok(memo); assert.equal(memo.text,'間をとる\n静かに読む');
      assert.equal(await page.locator('#reader').evaluate(el=>el.getBoundingClientRect().width),beforeWidth);
      const body=page.locator('.memo-body');
      await body.click(); assert.equal(await page.locator('.memo-remove').count(),1); assert.equal(await page.locator('#writing-memo-dialog').evaluate(el=>el.open),false);
      await body.click(); await page.locator('#writing-memo-input').fill('変更後\n'+ 'あ'.repeat(196)); await page.locator('#writing-memo-save').click();
      assert.equal((await state()).items.find(m=>m.type==='memo').text.length,200);
      await page.locator('#writing-undo').click(); assert.equal((await state()).items.find(m=>m.type==='memo').text,memo.text);
      const drag=async (locator,dx,dy,touch=false)=>{
        const b=await locator.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
        if(touch){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/5,y:y+dy*i/5}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
        else {await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:5});await page.mouse.up();}
      };
      await drag(body,20,50,width<600); let moved=(await state()).items.find(m=>m.type==='memo'); assert.notEqual(moved.dy,memo.dy); assert.equal(moved.tx,memo.tx); assert.equal(await page.locator('#writing-memo-dialog').evaluate(el=>el.open),false);
      await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items.find(m=>m.type==='memo'),memo,'whole drag is one undo');
      await body.click();
      await drag(page.locator('.memo-tip'),7,70,width<600); moved=(await state()).items.find(m=>m.type==='memo'); assert.ok(moved.offset!==memo.offset || moved.ty!==memo.ty);
      const afterBody=await body.boundingBox();assert.ok(afterBody); assert.equal(await page.locator('#writing-memo-dialog').evaluate(el=>el.open),false);
      await page.locator('#writing-undo').click(); assert.deepEqual((await state()).items.find(m=>m.type==='memo'),memo);
      await body.click(); await page.locator('[data-marker-color=lightblue]').click(); assert.equal((await state()).items.find(m=>m.type==='memo').color,'lightblue');
      await page.locator('#writing-undo').click(); assert.equal((await state()).items.find(m=>m.type==='memo').color,'yellow');
      await body.click(); page.once('dialog',d=>{assert.equal(d.message(),'このメモを削除しますか？');d.dismiss();});await page.locator('.memo-remove').click();assert.equal(await page.locator('.memo-remove').count(),1);
      page.once('dialog',d=>d.accept());await page.locator('.memo-remove').click();assert.equal((await state()).items.filter(m=>m.type==='memo').length,0);await page.locator('#writing-undo').click();
      await page.locator('#memo-settings-open').click();await page.locator('#memo-font-size').fill('22');await page.locator('#memo-opacity').fill('0.6');await page.locator('#memo-settings-form button[type=submit]').click();
      assert.deepEqual((await state()).memoSettings,{fontSize:22,opacity:.6});
      const saved=await page.evaluate(()=>{
        const w=window.ManuscriptWriting.printSnapshot(),m=window.ReadingAnnotations.fromData({format:'reading-support-manuscript',version:2,text:w.source,annotations:[{offset:2,text:'たそがれ'}],sourceRubies:[{start:0,end:2,reading:'たそがれ'}]});
        const marks=window.ManuscriptMarks.fromItems(w.items,m,w.memoSettings);return JSON.parse(window.ManuscriptMarks.serializeManuscript(m,marks));
      });assert.equal(saved.version,4);assert.deepEqual(saved.memoSettings,{fontSize:22,opacity:.6});
      const roundtrip=await page.evaluate(saved=>{const r=window.ManuscriptMarks.restoreManuscript(JSON.stringify(saved));return {items:r.markings.items,settings:r.markings.memoSettings};},saved);assert.deepEqual(roundtrip.items,saved.marks);assert.deepEqual(roundtrip.settings,saved.memoSettings);
      await page.locator('#writing-off').click();const frozen=await state();await body.click({force:true});assert.equal(await page.locator('#writing-memo-dialog').evaluate(el=>el.open),false);assert.deepEqual(await state(),frozen);
      const print=await page.evaluate(()=>{
        const snapshot=window.Reader.printSnapshot(),w=window.ManuscriptWriting.printSnapshot();
        const without=window.ManuscriptPrint.prepare(snapshot,{...w,items:w.items.filter(i=>i.type!=='memo')});
        const last=snapshot.glyphs.at(-1);
        const overflow={...w.items.find(i=>i.type==='memo'),id:999,offset:last.start,dx:999,dy:999,tx:999,ty:999};
        window.ManuscriptPrint.prepare(snapshot,{...w,items:[...w.items,overflow]});
        document.getElementById('manuscript-print').classList.add('print-measuring');
        const extra=document.querySelector('#manuscript-print .writing-memo[data-mark-id="999"]');
        const target=extra.closest('.manuscript-page');
        if(!target.querySelector(`[data-source-line="${last.line}"]`))throw Error('memo and anchor on different pages');
        for(const el of [extra,extra.querySelector('.memo-tip')]){
          const r=el.getBoundingClientRect(),b=target.getBoundingClientRect();
          if(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)throw Error('overflow not corrected');
        }
        const withNotes=window.ManuscriptPrint.prepare(snapshot,w);
        document.getElementById('manuscript-print').classList.add('print-measuring');
        const bounds=[...document.querySelectorAll('#manuscript-print .writing-memo')].map(note=>{const page=note.closest('.manuscript-page').getBoundingClientRect(),r=note.getBoundingClientRect();return {left:r.left-page.left,right:r.right-page.right,top:r.top-page.top,bottom:r.bottom-page.bottom,opacity:getComputedStyle(note).opacity,font:getComputedStyle(note).fontSize,tail:note.querySelectorAll('.memo-tip').length};});
        return {without,withNotes,bounds};
      });assert.equal(print.without.scale,print.withNotes.scale);assert.ok(print.withNotes.pages>=print.without.pages);assert.equal(print.bounds.length,1);for(const b of print.bounds){assert.ok(b.left>=-1&&b.right<=1&&b.top>=-1&&b.bottom<=1,JSON.stringify(b));assert.equal(b.opacity,'0.6');assert.ok(Math.abs(parseFloat(b.font)-22*print.withNotes.scale)<.01);assert.equal(b.tail,1);}
      fs.mkdirSync(output,{recursive:true});await page.evaluate(()=>{document.getElementById('manuscript-print').classList.remove('print-measuring');document.body.classList.add('manuscript-printing');});
      await page.emulateMedia({media:'print'});
      await page.locator('.manuscript-page').first().screenshot({path:path.join(output,`bubble-print-${width}.png`)});
      await page.pdf({path:path.join(output,`bubble-${width}.pdf`),format:'A4',printBackground:true});
      await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('manuscript-printing'));
      await page.screenshot({path:path.join(output,`bubble-${width}.png`),fullPage:false});
      // Validation and compatibility are atomic and preserve the other mark types.
      await page.evaluate(saved=>{
        for(const change of [{text:'a'.repeat(201)},{tx:Infinity},{color:'red'},{offset:999999}]){
          const bad=structuredClone(saved);Object.assign(bad.marks.find(m=>m.type==='memo'),change);let rejected=false;try{window.ManuscriptMarks.restoreManuscript(JSON.stringify(bad));}catch{rejected=true;}if(!rejected)throw Error('invalid memo accepted');
        }
        const legacy=structuredClone(saved);legacy.version=3;delete legacy.memoSettings;for(const m of legacy.marks)if(m.type==='memo'){delete m.tx;delete m.ty;delete m.color;}
        const restored=window.ManuscriptMarks.restoreManuscript(JSON.stringify(legacy));if(!restored.markings.items.some(m=>m.type==='marker'))throw Error('marker lost');
      },saved);
      const downloadPending=page.waitForEvent('download');await page.locator('#export-manuscript').click();
      const downloaded=JSON.parse(fs.readFileSync(await (await downloadPending).path(),'utf8'));assert.deepEqual(downloaded,saved);
      await page.locator('#reader-back').click();await page.locator('#save-navigation-cancel').click();assert.equal(await page.locator('#reading').isVisible(),true);
      await page.locator('#measure-current').click();await page.waitForFunction(()=>document.getElementById('reading-title').textContent==='朗読速度の計測');
      assert.deepEqual((await state()).items,saved.marks);assert.deepEqual((await state()).memoSettings,saved.memoSettings);
      await page.evaluate(()=>{ManuscriptWriting.setMode(true);document.getElementById('writing-undo').onclick();document.querySelector('[data-marker-color=pink]').click();});
      assert.equal(await page.evaluate(()=>ManuscriptWriting.enabled),false);assert.deepEqual((await state()).items,saved.marks);
      assert.deepEqual(errors,[]);console.log(`PASS ${width}px: create/edit/select/delete, mouse/touch body & tip, undo, settings, v4 JSON, v3 import, PDF width/pages/bounds`);await context.close();
    }
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

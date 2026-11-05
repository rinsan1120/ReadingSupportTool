const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
function load(normal){const c=vm.createContext({window:{},Intl,TextEncoder,structuredClone,Event,document:{dispatchEvent(){}}});for(const name of ['reading-annotations.js','manuscript-writing.js','user-library.js']){let s=normal?cp.execFileSync('git',['show','main:'+name],{encoding:'utf8'}):fs.readFileSync(name,'utf8');if(name==='manuscript-writing.js')s=s.slice(0,s.indexOf('  const $ ='))+'})();';vm.runInContext(s,c)}return c.window}
const app=load(false),normal=load(true);
test('v6 direct memos survive the rollback round trip verbatim',()=>{
 const r=new normal.ReadingAnnotations('本文。'),m=new normal.ManuscriptMarks(r.source);m.direction='vertical';
 m.add({type:'memo',offset:0,text:'直接',color:'pink',dx:1,dy:2,tx:0,ty:0,style:'direct',fontSize:28,verticalPosition:{dx:-2,dy:3,tx:.2,ty:.3}});
 m.add({type:'memo',offset:0,text:'吹き出し',color:'yellow',dx:1,dy:1,tx:0,ty:0});
 const json=normal.ManuscriptMarks.serializeManuscript(r,m);assert.equal(JSON.parse(json).version,6);
 const v=app.ManuscriptMarks.restoreManuscript(json);
 const direct=v.markings.items.find(i=>i.text==='直接');
 assert.equal(direct.style,'direct');assert.equal(direct.fontSize,28);assert.deepEqual(JSON.parse(JSON.stringify(direct.verticalPosition)),{dx:-2,dy:3,tx:.2,ty:.3});
 const bubble=v.markings.items.find(i=>i.text==='吹き出し');assert.ok(!('style' in bubble)&&!('fontSize' in bubble));
 v.markings.updateMemo(direct.id,{text:'直接・編集後'});
 const back=normal.ManuscriptMarks.restoreManuscript(app.ManuscriptMarks.serializeManuscript(v.manuscript,v.markings));
 const kept=back.markings.items.find(i=>i.text==='直接・編集後');
 assert.equal(kept.style,'direct');assert.equal(kept.fontSize,28);assert.equal(back.markings.direction,'vertical');
});
test('invalid direct-memo fields reject; legacy versions still read',()=>{
 const base={format:'reading-support-manuscript',version:6,text:'本文',annotations:[],sourceRubies:[],memoSettings:{fontSize:16,opacity:.9}};
 const memo={id:1,type:'memo',offset:0,dx:0,dy:0,tx:0,ty:0,color:'pink',text:'x'};
 assert.throws(()=>app.ManuscriptMarks.restoreManuscript(JSON.stringify({...base,marks:[{...memo,style:'weird'}]})),/形式/);
 assert.throws(()=>app.ManuscriptMarks.restoreManuscript(JSON.stringify({...base,marks:[{...memo,style:'direct',fontSize:100}]})),/文字サイズ/);
 assert.throws(()=>app.ManuscriptMarks.restoreManuscript(JSON.stringify({...base,marks:[{...memo,style:'direct',fontSize:20,extra:1}]})),/未対応/);
 for(const version of [1,2,3,4,5]){const d={format:'reading-support-manuscript',version,text:'本文',annotations:[],sourceRubies:[],marks:[],memoSettings:{fontSize:16,opacity:.9}};assert.equal(app.ManuscriptMarks.restoreManuscript(JSON.stringify(d)).manuscript.source,'本文')}
});
test('user data paperMode is validated and preserved by both builds',()=>{
 const data={format:'yomijitaku-user',version:1,profile:{name:''},displaySettings:{mode:'pages',width:900,fontSize:22,height:1.8,breaks:5},paperMode:true,manuscripts:[],activeId:null,history:[],target:'',plannedMinutes:'20'};
 assert.equal(app.UserLibrary.parse(JSON.stringify(data)).paperMode,true);
 assert.equal(normal.UserLibrary.parse(JSON.stringify(data)).paperMode,true);
 const absent={...data};delete absent.paperMode;
 assert.equal(app.UserLibrary.parse(JSON.stringify(absent)).paperMode,false);
 assert.equal(normal.UserLibrary.parse(JSON.stringify(absent)).paperMode,false);
 assert.throws(()=>app.UserLibrary.parse(JSON.stringify({...data,paperMode:'on'})));
 assert.throws(()=>normal.UserLibrary.parse(JSON.stringify({...data,paperMode:1})));
});

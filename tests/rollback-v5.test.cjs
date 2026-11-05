const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
function load(normal){const c=vm.createContext({window:{},Intl,TextEncoder,structuredClone,Event,document:{dispatchEvent(){}}});for(const name of ['reading-annotations.js','manuscript-writing.js','user-library.js']){let s=normal?cp.execFileSync('git',['show','main:'+name],{encoding:'utf8'}):fs.readFileSync(name,'utf8');if(name==='manuscript-writing.js')s=s.slice(0,s.indexOf('  const $ ='))+'})();';vm.runInContext(s,c)}return c.window}
const app=load(false),normal=load(true);
test('normal -> rollback edits -> normal retains v5 hidden data',()=>{
 const r=new normal.ReadingAnnotations('本文。'),m=new normal.ManuscriptMarks(r.source);m.direction='vertical';m.add({type:'memo',offset:0,text:'元',color:'pink',dx:1,dy:2,tx:0,ty:0,verticalPosition:{dx:-2,dy:3,tx:0,ty:0}});
 const json=normal.ManuscriptMarks.serializeManuscript(r,m),v=app.ManuscriptMarks.restoreManuscript(json);v.markings.updateMemo(1,{text:'編集後'});v.markings.undo();assert.equal(v.markings.items[0].text,'元');v.markings.updateMemo(1,{text:'編集後'});
 const back=normal.ManuscriptMarks.restoreManuscript(app.ManuscriptMarks.serializeManuscript(v.manuscript,v.markings));assert.equal(back.markings.direction,'vertical');assert.equal(back.markings.items[0].text,'編集後');assert.deepEqual(JSON.parse(JSON.stringify(back.markings.items[0].verticalPosition)),{dx:-2,dy:3,tx:0,ty:0});
});
test('legacy v1-v4 readable; unknown fields reject',()=>{
 for(const version of [1,2,3,4]){const d={format:'reading-support-manuscript',version,text:'本文',annotations:[],sourceRubies:[],marks:[],memoSettings:{fontSize:16,opacity:.9}};const v=app.ManuscriptMarks.restoreManuscript(JSON.stringify(d));assert.equal(v.manuscript.source,'本文')}
 const d={format:'reading-support-manuscript',version:5,text:'本文',annotations:[],sourceRubies:[],marks:[],memoSettings:{fontSize:16,opacity:.9},writingDirection:'vertical',futureData:1};assert.throws(()=>app.ManuscriptMarks.restoreManuscript(JSON.stringify(d)),/未対応/);
 const outer=app.UserLibrary.empty();outer.futureData=1;assert.throws(()=>app.UserLibrary.validate(outer),/未対応/);
});

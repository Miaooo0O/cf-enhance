const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {JudgeStore}=require('./judge-store.cjs');const {runCases,compareOutput}=require('./judge-runner.cjs');const {execute}=require('./samples.cjs');
function storage(){const data={};return {get:(k,d)=>data[k]||d,update:async(k,v)=>{data[k]=structuredClone(v);}};}
test('custom cases persist per source, imported samples deduplicate, and new problems retain edited/manual tests',async()=>{
 const saved=storage(),store=new JudgeStore(saved),s=store.suite('file:a.cpp','a.cpp'),id=s.cases[0].id;await store.edit(s.key,id,{input:'custom',expected:'answer',compare:true});
 assert.equal(await store.import(s.key,{contestId:10,index:'A'},[{input:'1\n',output:'2\n'}]),1);assert.equal(await store.import(s.key,{contestId:10,index:'A'},[{input:'1\r\n',output:'2\r\n'}]),0);const imported=store.suites[s.key].cases.find(c=>c.origin==='web');await store.edit(s.key,imported.id,{expected:'my edited answer'});
 await store.import(s.key,{contestId:10,index:'B'},[{input:'3',output:'4'}]);await store.flush();const restored=new JudgeStore(saved).suite(s.key);assert.equal(restored.cases.length,3);assert.equal(restored.cases[0].input,'custom');assert(restored.cases.some(c=>c.expected==='my edited answer'));assert.equal(store.suite('file:b.cpp').cases.length,1);assert.equal(store.suite('file:b.cpp').cases[0].input,'');
 assert.throws(()=>store.edit(s.key,id,{input:'x'.repeat(65537)}),/64 KiB/);assert.equal(store.suites[s.key].cases[0].input,'custom');
});
test('reimporting a different problem replaces only unchanged web samples and removes the empty placeholder',async()=>{
 const store=new JudgeStore(storage()),s=store.suite('file:a.cpp');await store.import(s.key,{contestId:1,index:'A'},[{input:'1',output:'2'}]);assert.equal(store.suites[s.key].cases.length,1);await store.import(s.key,{contestId:2,index:'B'},[{input:'3',output:'4'}]);assert.equal(store.suites[s.key].cases.length,1);assert.equal(store.suites[s.key].cases[0].input,'3');
});
test('local comparison supports token and exact modes without treating numerical differences as equal',()=>{
 assert(compareOutput('1\n2\r\n','1 2'));assert(!compareOutput('1\n2','1 2','exact'));assert(!compareOutput('1.0','1'));assert(compareOutput('hello\r\n','hello\n','exact'));
});
test('actual C++ snapshots run custom stdin, compare outputs, support output-only cases, and report compilation errors',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cf judge '));try{
  const snapshot={languageId:'cpp',fileName:path.join(dir,'anything.cpp'),source:'#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<"\\n";}'};await fs.writeFile(snapshot.fileName,'original file remains');const cases=[{id:'a',input:'21',expected:'42',compare:true,revision:1},{id:'b',input:'2',expected:'5',compare:true,revision:1},{id:'c',input:'3',expected:'',compare:false,revision:1}];
  const result=await runCases(snapshot,cases);assert.deepEqual(result.results.map(r=>r.status),['passed','wrongAnswer','output']);assert.equal(result.results[2].stdout.trim(),'6');assert(result.results.every(r=>r.timeMs>=0));assert.equal(await fs.readFile(snapshot.fileName,'utf8'),'original file remains');const broken=await runCases({...snapshot,source:'this is not C++'},cases);assert(broken.compileError);assert.equal(broken.results.length,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('stop interrupts an owned process and output limits are bounded',async()=>{
 const controller=new AbortController();const pending=execute(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:10000,signal:controller.signal});setTimeout(()=>controller.abort(),100);const stopped=await pending;assert.equal(stopped.reason,'已停止');const oversized=await execute(process.execPath,['-e','process.stdout.write("x".repeat(2*1024*1024))']);assert.match(oversized.reason,/输出/);assert(Buffer.byteLength(oversized.stdout)<=1024*1024);
});

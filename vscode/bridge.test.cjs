const test=require('node:test');const assert=require('node:assert/strict');
const {Bridge,parseProblem,sourceHash,publicTask}=require('./bridge.cjs');
const extensionId='a'.repeat(32),source='#include <iostream>\nint main(){return 0;}\n';
async function setup(options={}){let clock=1000000;const b=new Bridge({...options,now:()=>clock});await b.start(0);const call=async(path,data,token,extra={})=>{const r=await fetch(`http://127.0.0.1:${b.port}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-CFE-Client':extensionId,...(token?{Authorization:`Bearer ${token}`} :{}),...extra},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};return {b,call,advance:ms=>clock+=ms,pair:async()=>{const code=b.issuePairing().split(':')[2];return (await call('/pair',{code,extensionId})).data.token;}};}
test('targets are independent from filenames and source snapshots remain immutable',()=>{
 assert.deepEqual(parseProblem('2246a'),{contestId:2246,index:'A'});assert.deepEqual(parseProblem('https://codeforces.com/problemset/problem/10/A1'),{contestId:10,index:'A1'});assert.throws(()=>parseProblem('https://evil.test/problemset/problem/10/A'));
 const b=new Bridge();const first=b.createTask({source,sourceName:'1.cpp',problem:parseProblem('2246A'),language:'cpp23'});const second=b.createTask({source:source+'// next',sourceName:'1.cpp',problem:parseProblem('2246B'),language:'cpp20'});assert.notEqual(first.id,second.id);assert.equal(b.tasks[1].source,source);assert.equal(publicTask(b.tasks[1]).source,undefined);assert.equal(sourceHash('a\r\nb'),sourceHash('a\nb'));
});
test('loopback pairing is single-use and rejects expired codes, unauthenticated clients and web origins',async()=>{
 const {b,call,pair,advance}=await setup();try{
  assert.equal((await call('/poll',{})).status,401);const token=await pair();assert(token);
  assert.equal((await call('/pair',{extensionId,code:'a'.repeat(32)})).status,403);
  assert.equal((await call('/poll',{},token,{Origin:'https://evil.test'})).status,403);
  assert.equal((await call('/poll',{},token,{'X-CFE-Client':'b'.repeat(32)})).status,401);
  assert.equal((await call('/poll',{},'é'.repeat(43))).status,401);
  assert.equal((await call('/poll',{},token)).status,200);
  const code=b.issuePairing().split(':')[2];advance(300001);assert.equal((await call('/pair',{extensionId,code})).status,403);
  await b.revoke();assert.equal((await call('/poll',{},token)).status,401);
 }finally{await b.close();}
});
test('feedback is tied to a submission ID; cancellation and restart never re-send source',async()=>{
 const {b,call,pair}=await setup();try{const token=await pair(),t=b.createTask({source,sourceName:'scratch.cpp',problem:parseProblem('10A'),language:'cpp23'});
  const event=data=>call('/event',{id:t.id,...data},token);
  assert.equal((await event({type:'verdict',submissionId:10,verdict:'OK'})).status,409);
  await event({type:'state',state:'opened'});await event({type:'state',state:'prepared'});await event({type:'state',state:'submitted'});await event({type:'bound',submissionId:10,handle:'sample'});
  assert.equal((await event({type:'verdict',submissionId:11,verdict:'OK'})).status,409);
  await event({type:'verdict',submissionId:10,verdict:'WRONG_ANSWER',passedTests:2,timeMs:31,memoryBytes:262144});assert.equal(b.tasks[0].state,'finished');assert.equal(b.tasks[0].source,undefined);
  const pending=b.createTask({source,sourceName:'unsaved',problem:parseProblem('10B'),language:'manual'});const restarted=new Bridge({tasks:b.tasks.map(publicTask)});assert.equal(restarted.tasks[0].state,'interrupted');assert.equal(restarted.tasks[0].source,undefined);
  b.cancel(pending.id);await call('/event',{id:pending.id,type:'state',state:'prepared'},token);assert.equal(b.tasks[0].state,'cancelled');
 }finally{await b.close();}
});

test('restart resumes feedback for sent tasks without restoring or replaying their source',async()=>{
 const tasks=[{id:'sent',source,problem:{contestId:10,index:'A'},state:'submitted',created:1000000},{id:'bound',source,problem:{contestId:10,index:'B'},state:'judging',submissionId:123,created:1000000}];const {b,call,pair}=await setup({tasks});
 try{const token=await pair();assert.equal(b.tasks[0].state,'submitted');assert.equal(b.tasks[1].state,'judging');assert(b.tasks.every(t=>!t.source));assert.equal((await call('/poll',{},token)).data.task,null);await call('/event',{id:'bound',type:'verdict',submissionId:123,verdict:'OK'},token);assert.equal(b.tasks[1].state,'finished');}finally{await b.close();}
});

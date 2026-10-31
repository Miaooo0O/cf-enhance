import test from 'node:test';
import assert from 'node:assert/strict';
let sequence=0;
async function harness(state,respond){
  let listener;const calls=[];let now=10000000;
  const oldNow=Date.now,oldTimeout=globalThis.setTimeout,oldFetch=globalThis.fetch,oldChrome=globalThis.chrome;
  Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{now+=ms;queueMicrotask(fn);return 0;};
  globalThis.chrome={runtime:{id:'test-extension',onMessage:{addListener:fn=>listener=fn}},storage:{local:{
    get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in state).map(k=>[k,structuredClone(state[k])])),
    set:async values=>Object.assign(state,structuredClone(values))
  }},tabs:{create:async options=>({id:1,...options})}};
  globalThis.fetch=async(url,options)=>{const parsed=new URL(url);calls.push({method:parsed.pathname.split('/').pop(),params:parsed.searchParams,time:now,options});return {ok:true,json:async()=>({status:'OK',result:await respond(parsed)})};};
  await import(`./background.mjs?test=${++sequence}`);
  return {state,calls,send:m=>new Promise(resolve=>listener(m,{id:'test-extension'},resolve)),restore:()=>{Date.now=oldNow;globalThis.setTimeout=oldTimeout;globalThis.fetch=oldFetch;globalThis.chrome=oldChrome;}};
}
const problem=(index,rating=1400)=>({contestId:10,index,rating,name:index,tags:['dp']});

test('deleting and restoring a session preserves other sessions/history and cannot resurrect legacy data',async()=>{
 const a={id:'a',name:'First',problems:[problem('A')],viewed:{'10/A':{first:1}}},b={id:'b',name:'Second',problems:[problem('B')],viewed:{}};const account={handle:'sample',complete:true,states:{'10/A':{solved:true}}};
 const h=await harness({trainings:[a,b],training:a,history:['10/A'],drawLog:[{key:'10/A'}],account},()=>{throw Error('No network expected');});try{
  const deleted=await h.send({type:'deleteSession',id:'a'});assert(deleted.ok);assert.deepEqual(deleted.data.sessions,[b]);assert.equal((await h.send({type:'sessions'})).data.length,1);assert.equal(h.state.training,null);assert.deepEqual(h.state.history,['10/A']);assert.deepEqual(h.state.account,account);assert.equal(h.state.drawLog.length,1);
  const restored=await h.send({type:'restoreSession',id:'a'});assert(restored.ok);assert.deepEqual(restored.data.sessions,[a,b]);assert.equal(h.state.trainingTrash.length,0);assert.equal(h.calls.length,0);
  assert.equal((await h.send({type:'deleteSession',id:'missing'})).ok,false);assert.equal(h.state.trainings.length,2);
 }finally{h.restore();}
});
test('account sync reads every page, deduplicates pagination overlap and respects API rate limit',async()=>{
  const page=Array.from({length:1000},(_,i)=>({id:2000-i,problem:problem('A'),verdict:'WRONG_ANSWER'}));
  const h=await harness({},url=>url.searchParams.get('from')==='1'?page:[page[999],{id:1,problem:problem('B'),verdict:'OK'}]);
  try{const r=await h.send({type:'sync',handle:'sample',force:true});assert(r.ok);assert.equal(r.data.count,1001);assert(r.data.complete);assert(r.data.states['10/B'].solved);assert.equal(h.calls.length,2);assert(h.calls[1].time-h.calls[0].time>=2200);assert.equal(h.calls[0].options.credentials,'omit');}finally{h.restore();}
});
test('failed account switch never overwrites previous complete account',async()=>{
  const previous={handle:'old',complete:true,states:{'10/A':{solved:true}},time:1};
  const page=Array.from({length:1000},(_,id)=>({id,problem:problem('B')}));
  const h=await harness({account:previous},url=>{if(url.searchParams.get('from')==='1')return page;throw new Error('offline');});
  try{const r=await h.send({type:'sync',handle:'new-user',force:true});assert.equal(r.ok,false);assert.deepEqual(h.state.account,previous);}finally{h.restore();}
});
test('simultaneous draws serialize history writes and migrate old records without data loss',async()=>{
  const h=await harness({cache:{time:10000000,problems:[problem('A'),problem('B')]},settings:{min:800,max:2000,noRepeat:true,exclude:'none'},history:['9/C']},()=>{throw new Error('no network expected');});
  try{const [a,b]=await Promise.all([h.send({type:'draw'}),h.send({type:'draw'})]);assert(a.ok&&b.ok);assert.notEqual(a.data.index,b.data.index);assert.equal(h.state.history.length,3);assert.equal(h.state.drawLog.length,3);assert.equal(h.state.drawLog[2].key,'9/C');assert.equal(h.state.drawLog[2].at,null);}finally{h.restore();}
});
test('training failure keeps previous training, logs and exclusion history untouched',async()=>{
  const state={cache:{time:10000000,problems:[problem('A')]},settings:{min:800,max:2000,exclude:'none'},training:{name:'old'},history:['9/C'],drawLog:[{key:'9/C',at:1}]};
  const before=structuredClone(state),h=await harness(state,()=>[]);
  try{const r=await h.send({type:'training',groups:[{min:800,max:2000,count:2}]});assert.equal(r.ok,false);assert.deepEqual(state,before);}finally{h.restore();}
});
test('recent requests share cache, preserve old AC and cannot update a different handle',async()=>{
  const h=await harness({account:{handle:'sample',complete:true,states:{'10/A':{solved:true,attempts:4}},time:1}},()=>[{id:2,problem:problem('A'),verdict:'WRONG_ANSWER'}]);
  try{await h.send({type:'recent',handle:'sample'});await h.send({type:'recent',handle:'Sample'});assert.equal(h.calls.length,1);assert(h.state.account.states['10/A'].solved);assert.equal(h.state.account.states['10/A'].attempts,4);const previous=structuredClone(h.state.account);await h.send({type:'recent',handle:'someone'});assert.deepEqual(h.state.account,previous);}finally{h.restore();}
});
test('creating sessions migrates legacy training, keeps earlier sessions and uses independent IDs',async()=>{
  const legacy={id:99,name:'legacy',created:1,problems:[problem('A')]};
  const h=await harness({cache:{time:10000000,problems:[problem('A'),problem('B')]},settings:{min:800,max:2000,exclude:'none',noRepeat:false},training:legacy},()=>[]);
  try{const message={type:'training',name:'scene',groups:[{min:800,max:2000,count:1}],options:{exclude:'none',noRepeat:false}};const first=await h.send(message),second=await h.send(message);assert(first.ok&&second.ok);assert.notEqual(first.data.id,second.data.id);assert.equal(h.state.trainings.length,3);assert.equal(h.state.trainings[2].id,'99');
    const viewed=await h.send({type:'viewed',id:first.data.id,key:`10/${first.data.problems[0].index}`});assert(viewed.ok);assert.equal(Object.keys(h.state.trainings[1].viewed).length,1);assert.deepEqual(h.state.trainings[0].viewed,{});
    const old=structuredClone(h.state.trainings);const invalid=await h.send({type:'viewed',id:first.data.id,key:'999/Z'});assert.equal(invalid.ok,false);assert.deepEqual(h.state.trainings,old);
  }finally{h.restore();}
});

import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML,DOMParser} from 'linkedom';
import {createBridgeWorker} from './bridge-worker.mjs';import {parsePairing,hashSource,submissionMatches,extractSource} from './bridge-protocol.mjs';
import {parseResultRows,fillNativeTask,submitNativeTask,mountCompanion,fetchProblemSamples} from './companion.mjs';
import bridgeModule from './vscode/bridge.cjs';const {Bridge,sourceHash}=bridgeModule;
const extensionId='a'.repeat(32),source='#include <bits/stdc++.h>\nint main(){return 0;}\n';
async function environment(){
 let offline=false,apiOverride=null,clock=1000000,submissions=[{id:5,problem:{contestId:10,index:'A'},creationTimeSeconds:900,author:{members:[{handle:'sample'}]},verdict:'OK'}];
 const server=new Bridge({now:()=>clock});await server.start(0);const state={},tabs=new Map();let counter=0,sourceRequests=0;
 const chrome={runtime:{id:extensionId},alarms:{create:async()=>{},clear:async()=>{}},storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in state).map(k=>[k,structuredClone(state[k])])),set:async values=>Object.assign(state,structuredClone(values)),remove:async keys=>{for(const key of keys)delete state[key];}}},tabs:{create:async({url})=>{const tab={id:++counter,url,active:true};tabs.set(tab.id,tab);return tab;},query:async()=>[...tabs.values()],get:async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);}}};
 const fetcher=async(url,options)=>{if(url.startsWith('http://127.0.0.1:')){if(offline)throw Error('offline');return fetch(url,options);}sourceRequests++;return new Response(`<pre class="prettyprint" id="program-source-text">${source.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</pre>`);};
 const worker=createBridgeWorker({chrome,now:()=>clock,api:async()=>apiOverride?apiOverride():submissions,fetch:fetcher});
 await worker.handle({type:'bridgePair',code:server.issuePairing()},{url:`chrome-extension://${extensionId}/popup.html`});
 const form=()=>({url:tabs.get(1).url,tab:tabs.get(1)});
 return {server,worker,state,tabs,form,chrome,setApi:f=>apiOverride=f,setOffline:value=>offline=value,setSubmissions:s=>submissions=s,advance:n=>clock+=n,sourceRequests:()=>sourceRequests};
}
test('pairing parser only accepts local port and cryptographic one-time code',()=>{assert.deepEqual(parsePairing('cfe-pair:27121:'+'a'.repeat(32)),{port:27121,code:'a'.repeat(32)});for(const text of ['http://evil.test','cfe-pair:80:'+'a'.repeat(32),'cfe-pair:27121:123456'])assert.throws(()=>parsePairing(text));});

test('sample requests target the selected problem without navigating or submitting, and cached problems stay isolated',async()=>{
 const e=await environment();try{
  const problem={contestId:1768,index:'E'};await e.chrome.tabs.create({url:'https://codeforces.com/problemset/problem/2272/A'});
  let requested;e.chrome.tabs.sendMessage=async(id,m)=>{requested=m.problem;return {samples:await fetchProblemSamples(m.problem,{Parser:DOMParser,fetch:async()=>new Response('<div class="sample-test"><div class="input"><pre><div class="test-example-line">1 &lt; 2</div><div class="test-example-line">3</div></pre></div><div class="output"><pre>9<br>8</pre></div></div>')})};};
  e.server.requestSamples(problem);await e.worker.tick();for(let i=0;i<20&&!e.server.samplesFor(problem)?.samples;i++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(requested,problem);assert.equal(e.server.samplesFor(problem).samples[0].input,'1 < 2\n3');assert.equal(e.server.samplesFor(problem).samples[0].output,'9\n8');assert.equal(e.tabs.size,1);assert.equal(e.server.tasks.length,0);assert.equal(e.server.samplesFor({contestId:2272,index:'A'}).samples,undefined);
  e.server.requestSamples(problem);assert.equal(e.server.commands.length,0);e.server.requestSamples(problem,true);assert.equal(e.server.commands.length,1);
  await assert.rejects(fetchProblemSamples(problem,{Parser:DOMParser,fetch:async()=>new Response('<html>Login</html>')}),/未找到样例/);
 }finally{await e.server.close();}
});

test('expired and mismatched sample replies cannot replace the selected problem cache; retry uses a new request id',async()=>{
 const e=await environment();try{
  const a={contestId:1768,index:'E'},b={contestId:2272,index:'A'},connection=e.state.bridgeConnection;
  const reply=async body=>fetch(`http://127.0.0.1:${e.server.port}/samples`,{method:'POST',headers:{'Content-Type':'application/json','X-CFE-Client':extensionId,Authorization:`Bearer ${connection.token}`},body:JSON.stringify(body)});
  e.server.requestSamples(a);const old=e.server.sampleRequests.get('1768/E');e.advance(26000);assert.match(e.server.samplesFor(a).error,/超时/);e.server.requestSamples(a,true);const current=e.server.sampleRequests.get('1768/E');assert.notEqual(old.id,current.id);
  assert.equal((await reply({id:old.id,problem:a,samples:[{input:'old',output:'wrong'}]})).status,409);assert.equal((await reply({id:current.id,problem:b,samples:[{input:'wrong problem',output:'wrong'}]})).status,409);assert.equal(e.server.samplesFor(a).samples,undefined);
  assert.equal((await reply({id:current.id,problem:a,samples:[{input:'new',output:'right'}]})).status,200);assert.equal(e.server.samplesFor(a).samples[0].input,'new');assert.equal(e.server.samplesFor(b).samples,undefined);
 }finally{await e.server.close();}
});
test('source proof decodes HTML without executing it; identity excludes old or other-account submissions',async()=>{
 assert.equal(extractSource('<pre id="program-source-text">a &lt; b &amp;&amp; c&#10;</pre>'),'a < b && c\n');assert.equal(extractSource('<html>Login</html>'),null);assert.equal(await hashSource(source),sourceHash(source));
 const t={problem:{contestId:10,index:'A'},baseline:5,submittedAt:1000000,handle:'sample'},s={id:6,creationTimeSeconds:1000,problem:t.problem,author:{members:[{handle:'sample'}]}};assert(submissionMatches(t,s));assert(!submissionMatches(t,{...s,id:5}));assert(!submissionMatches(t,{...s,author:{members:[{handle:'other'}]}}));
});
test('real local HTTP round trip: task delivery, source verification, AC feedback and no duplicate tabs',async()=>{
 const e=await environment();try{
  const task=e.server.createTask({source,sourceName:'any-name.cpp',problem:{contestId:10,index:'A'},language:'cpp23'});await e.worker.tick();await e.worker.tick();assert.equal(e.tabs.size,1);
  const received=await e.worker.handle({type:'bridgeTask',id:task.id},e.form());assert.equal(received.source,source);
  await assert.rejects(e.worker.handle({type:'bridgeTask',id:task.id},{url:e.form().url,tab:{id:999}}));
  await e.worker.handle({type:'bridgePrepared',id:task.id,handle:'sample',baseline:5,baselineReady:true},e.form());await e.worker.handle({type:'bridgeSubmitted',id:task.id,source},e.form());
  e.setSubmissions([{id:6,creationTimeSeconds:1000,problem:task.problem,author:{members:[{handle:'sample'}]},verdict:'OK',passedTestCount:42,timeConsumedMillis:31,memoryConsumedBytes:262144}]);await e.worker.drain();await e.worker.tick();await e.worker.drain();
  assert.equal(e.server.tasks[0].submissionId,6);assert.equal(e.server.tasks[0].verdict,'OK');assert.equal(e.server.tasks[0].state,'finished');assert.equal(e.server.tasks[0].source,undefined);assert.equal(e.state.bridgeTasks[task.id].source,undefined);assert(e.sourceRequests()>0);
 }finally{await e.server.close();}
});
test('ambiguous submissions need an explicit row association and mismatched rows are rejected',async()=>{
 const e=await environment();try{
  const t=e.server.createTask({source,sourceName:'same.cpp',problem:{contestId:10,index:'A'},language:'cpp23'});await e.worker.tick();await e.worker.handle({type:'bridgePrepared',id:t.id,handle:'sample'},e.form());await e.worker.handle({type:'bridgeSubmitted',id:t.id,source},e.form());
  const rows=[6,7].map(id=>({id,creationTimeSeconds:1000,problem:t.problem,author:{members:[{handle:'sample'}]},verdict:'OK'}));e.setSubmissions(rows);await e.worker.tick();assert.equal(e.server.tasks[0].submissionId,undefined);
  const sender={url:'https://codeforces.com/contest/10/my',tab:{id:1}};
  await assert.rejects(e.worker.handle({type:'bridgeBind',id:t.id,confirmed:true,handle:'other',problem:t.problem,submissionId:6},sender));
  await e.worker.handle({type:'bridgeBind',id:t.id,confirmed:true,handle:'sample',problem:t.problem,submissionId:6,verdict:'WRONG_ANSWER',passedTests:2},sender);assert.equal(e.server.tasks[0].submissionId,6);assert.equal(e.server.tasks[0].verdict,'WRONG_ANSWER');
 }finally{await e.server.close();}
});
test('native CF row parsing preserves exact handle, problem and submission identity',()=>{
 const {document}=parseHTML('<table><tr data-submission-id="123"><td><a href="/profile/sample">sample</a></td><td><a href="/contest/10/problem/A1">A1</a></td><td><span submissionverdict="WRONG_ANSWER">Wrong answer on test 3</span></td><td class="time-consumed-cell">31 ms</td><td class="memory-consumed-cell">256 KB</td></tr></table>');
 const [r]=parseResultRows(document);assert.equal(r.submissionId,123);assert.equal(r.handle,'sample');assert.equal(r.problem.index,'A1');assert.equal(r.passedTests,2);assert.equal(r.memoryBytes,262144);
});
test('form preparation fills chosen target but never overwrites a different draft or submits',async()=>{
 const {document,window}=parseHTML('<html><body><form><select name="submittedProblemIndex"><option value="A">A</option></select><select name="programTypeId"><option value="old">Python 3.13</option><option value="91">GNU G++23 14</option></select><textarea name="source"></textarea><button type="submit">Submit</button></form></body></html>');
 const originalEvent=globalThis.Event,originalCustom=globalThis.CustomEvent;globalThis.Event=window.Event;globalThis.CustomEvent=window.CustomEvent;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value;},set(v){for(const o of this.options)o.toggleAttribute('selected',o.value===v);},configurable:true});
 try{let submits=0;document.querySelector('form').addEventListener('submit',()=>submits++);const task={problem:{contestId:10,index:'A'},source,hash:await hashSource(source),language:'cpp23'};await fillNativeTask(task,document);assert.equal(document.querySelector('[name=programTypeId]').value,'91');assert.equal(document.querySelector('textarea').value,source);assert.equal(submits,0);document.querySelector('textarea').value='my draft';await assert.rejects(fillNativeTask(task,document),/未覆盖/);assert.equal(document.querySelector('textarea').value,'my draft');}finally{globalThis.Event=originalEvent;globalThis.CustomEvent=originalCustom;}
});

test('one VS Code task automatically fills and submits the native form once; reloading never resubmits',async()=>{
 const e=await environment(),saved={};for(const k of ['chrome','window','document','location','Event','CustomEvent','DOMParser','fetch'])saved[k]=globalThis[k];let window;
 try{
  const task=e.server.createTask({source,sourceName:'chosen.cpp',problem:{contestId:10,index:'A'},language:'cpp23',autoSubmit:true});await e.worker.tick();assert.equal(e.server.context.autoSubmit,true);
  ({window}=parseHTML('<html><body><div id="header"><div class="lang-chooser"><a href="/profile/sample">sample</a></div></div><div id="pageContent"><form><select name="submittedProblemIndex"><option value="A">A</option></select><select name="programTypeId"><option value="91">GNU G++23</option></select><textarea name="source"></textarea><button type="submit">Submit</button></form></div></body></html>'));
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value;},set(v){for(const o of this.options)o.toggleAttribute('selected',o.value===v);},configurable:true});
  Object.assign(globalThis,{chrome:e.chrome,window,document:window.document,location:new URL(e.form().url),DOMParser,fetch:async(url,options)=>String(url).startsWith('http://127.0.0.1:')?saved.fetch(url,options):new Response('<div id=header><div class=lang-chooser><a href=/profile/sample>sample</a></div></div><div id=pageContent><table><tr data-submission-id=5></tr></table></div>'),Event:window.Event,CustomEvent:window.CustomEvent});
  e.chrome.runtime.sendMessage=async m=>{try{return {ok:true,data:await e.worker.handle(m,e.form())};}catch(error){return {ok:false,error:error.message};}};
  let clicks=0;document.querySelector('button[type=submit]').click=()=>{clicks++;assert.equal(e.server.tasks[0].state,'submitted');assert.equal(document.querySelector('textarea').value,source);};
  await mountCompanion();assert.equal(clicks,1);assert.equal(e.server.tasks[0].state,'submitted');assert(e.state.bridgeTasks[task.id].autoAttempt);
  window.dispatchEvent(new window.Event('pagehide'));await mountCompanion();assert.equal(clicks,1);window.dispatchEvent(new window.Event('pagehide'));
  await assert.rejects(e.worker.handle({type:'bridgePrepared',id:task.id,handle:'sample'},e.form()),/不会重新准备/);
  assert.throws(()=>e.server.createTask({source,sourceName:'again.cpp',problem:task.problem,language:'cpp23',autoSubmit:true}),/正在处理/);
 }finally{window?.dispatchEvent(new window.Event('pagehide'));for(const [k,v]of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}await e.server.close();}
});

test('automatic submission stops before sending when language, form validation, or snapshot differs',async()=>{
 let sent=0,clicked=0;const task={id:'task',problem:{contestId:10,index:'A'},source,hash:await hashSource(source),language:'cpp23'};
 const field={value:source},form={dataset:{},checkValidity:()=>true,querySelector:()=>({click:()=>clicked++,disabled:false})},doc={querySelector:selector=>selector.includes('programTypeId')?{value:'91',options:[{value:'91',textContent:'GNU G++23'}]}:{value:'A'},querySelectorAll:()=>[]};
 const filled={form,field,languageMatched:false};await assert.rejects(submitNativeTask(task,filled,async()=>sent++,doc),/匹配/);
 filled.languageMatched=true;form.checkValidity=()=>false;await assert.rejects(submitNativeTask(task,filled,async()=>sent++,doc),/校验/);
 form.checkValidity=()=>true;field.value='changed';await assert.rejects(submitNativeTask(task,filled,async()=>sent++,doc),/已变化/);assert.equal(sent,0);assert.equal(clicked,0);
 field.value=source;doc.querySelectorAll=()=>[{getClientRects:()=>[{}]}];await assert.rejects(submitNativeTask(task,filled,async()=>sent++,doc),/验证码/);assert.equal(sent,0);
});

test('native feedback binds the original tab without waiting for a stalled public API',async()=>{
 const e=await environment();let release;try{
  await e.worker.drain();const t=e.server.createTask({source,sourceName:'any.cpp',problem:{contestId:10,index:'A'},language:'cpp23',autoSubmit:true});await e.worker.tick();await e.worker.drain();
  e.setApi(()=>new Promise(resolve=>release=resolve));
  await e.worker.handle({type:'bridgePrepared',id:t.id,handle:'sample',baseline:5,baselineReady:true},e.form());
  await e.worker.handle({type:'bridgeSubmitted',id:t.id,source},e.form());await e.worker.tick();
  const row={submissionId:6,handle:'sample',problem:t.problem,verdict:'OK',timeMs:12,memoryBytes:1024};
  const result=await Promise.race([e.worker.handle({type:'bridgeRows',handle:'sample',rows:[row]},{url:'https://codeforces.com/problemset/status?my=on',tab:e.form().tab}),new Promise((_,reject)=>setTimeout(()=>reject(Error('native feedback blocked on API')),500))]);
  assert.equal(e.server.tasks[0].state,'finished');assert.equal(e.server.tasks[0].submissionId,6);assert.equal(e.server.tasks[0].verdict,'OK');assert.equal(e.server.tasks.length,1);assert.equal(result.accepted.key,'10/A');assert.equal(e.state.account.states['10/A'].solved,true);
 }finally{release?.([]);await e.worker.drain();await e.server.close();}
});

test('manual web submissions update VS Code feedback, preserve per-tab session context, and ignore other users',async()=>{
 const e=await environment();try{
  const tab={id:50};await e.worker.handle({type:'bridgeWebSubmit',problem:{contestId:10,index:'B'},handle:'sample',baseline:7,baselineReady:true,sessionId:'training-one'}, {url:'https://codeforces.com/contest/10/submit',tab});
  const row={submissionId:8,handle:'sample',problem:{contestId:10,index:'B'},verdict:'TESTING'};const sender={url:'https://codeforces.com/contest/10/my',tab};
  await e.worker.handle({type:'bridgeRows',handle:'sample',rows:[row,{...row,submissionId:9,handle:'other'}]},sender);assert.equal(e.server.tasks.length,1);assert.equal(e.server.tasks[0].origin,'browser');assert.equal(e.server.tasks[0].state,'judging');
  const result=await e.worker.handle({type:'bridgeRows',handle:'sample',rows:[{...row,verdict:'OK',timeMs:30,memoryBytes:2048}]},sender);assert.equal(e.server.tasks.length,1);assert.equal(e.server.tasks[0].verdict,'OK');assert.equal(result.accepted.sessionId,'training-one');assert.equal(result.accepted.key,'10/B');
  assert.equal((await e.worker.handle({type:'bridgePageContext'},{url:sender.url,tab:{id:51}})),null);
 }finally{await e.worker.drain();await e.server.close();}
});

test('disconnected feedback is retained and replayed in order after reconnecting',async()=>{
 const e=await environment();try{
  const t=e.server.createTask({source,sourceName:'retry.cpp',problem:{contestId:10,index:'A'},language:'cpp23'});await e.worker.tick();await e.worker.drain();e.setOffline(true);
  await e.worker.handle({type:'bridgePrepared',id:t.id,handle:'sample',baseline:5,baselineReady:true},e.form());await e.worker.handle({type:'bridgeSubmitted',id:t.id,source},e.form());assert(e.state.bridgeOutbox.length>=2);assert.equal(e.server.tasks[0].state,'opened');
  e.setOffline(false);await e.worker.tick();await e.worker.drain();assert.equal(e.server.tasks[0].state,'submitted');assert.equal(e.state.bridgeOutbox.length,0);
 }finally{await e.worker.drain();await e.server.close();}
});

test('verdict text without a submissionVerdict attribute still reports final results',()=>{
 const {document}=parseHTML('<table><tr data-submission-id="77"><td><a href="/profile/sample">sample</a></td><td><a href="/problemset/problem/10/A">A</a></td><td class="status-cell"><span class="verdict-rejected">Time limit exceeded on test 4</span></td></tr></table>');assert.equal(parseResultRows(document)[0].verdict,'TIME_LIMIT_EXCEEDED');assert.equal(parseResultRows(document)[0].passedTests,3);
});

test('only a dedicated fresh task may replace restored site code, and a stuck page reports an error',async()=>{
 const {document,window}=parseHTML('<form><select name="submittedProblemIndex"><option value="A">A</option></select><select name="programTypeId"><option value="91">GNU G++23</option></select><textarea name="source">previous submission</textarea></form>');const originalEvent=globalThis.Event,originalCustom=globalThis.CustomEvent;globalThis.Event=window.Event;globalThis.CustomEvent=window.CustomEvent;Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value;},set(v){for(const o of this.options)o.toggleAttribute('selected',o.value===v);},configurable:true});
 try{const task={problem:{contestId:10,index:'A'},source,hash:await hashSource(source),language:'cpp23'};await assert.rejects(fillNativeTask(task,document),/未覆盖/);await fillNativeTask({...task,replacePrefill:true},document);assert.equal(document.querySelector('textarea').value,source);}finally{globalThis.Event=originalEvent;globalThis.CustomEvent=originalCustom;}
 const e=await environment();try{const t=e.server.createTask({source,sourceName:'slow.cpp',problem:{contestId:10,index:'A'},language:'cpp23'});await e.worker.tick();await e.worker.drain();e.advance(46000);await e.worker.tick();await e.worker.drain();assert.equal(e.server.tasks.find(x=>x.id===t.id).state,'error');assert.match(e.server.tasks.find(x=>x.id===t.id).detail,/45 秒/);}finally{await e.worker.drain();await e.server.close();}
});

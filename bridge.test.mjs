import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';
import {createBridgeWorker} from './bridge-worker.mjs';import {parsePairing,hashSource,submissionMatches,extractSource} from './bridge-protocol.mjs';
import {parseResultRows,fillNativeTask,submitNativeTask,mountCompanion} from './companion.mjs';
import bridgeModule from './vscode/bridge.cjs';const {Bridge,sourceHash}=bridgeModule;
const extensionId='a'.repeat(32),source='#include <bits/stdc++.h>\nint main(){return 0;}\n';
async function environment(){
 let clock=1000000,submissions=[{id:5,problem:{contestId:10,index:'A'},creationTimeSeconds:900,author:{members:[{handle:'sample'}]},verdict:'OK'}];
 const server=new Bridge({now:()=>clock});await server.start(0);const state={},tabs=new Map();let counter=0,sourceRequests=0;
 const chrome={runtime:{id:extensionId},alarms:{create:async()=>{},clear:async()=>{}},storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in state).map(k=>[k,structuredClone(state[k])])),set:async values=>Object.assign(state,structuredClone(values)),remove:async keys=>{for(const key of keys)delete state[key];}}},tabs:{create:async({url})=>{const tab={id:++counter,url,active:true};tabs.set(tab.id,tab);return tab;},query:async()=>[...tabs.values()],get:async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);}}};
 const fetcher=async(url,options)=>{if(url.startsWith('http://127.0.0.1:'))return fetch(url,options);sourceRequests++;return new Response(`<pre class="prettyprint" id="program-source-text">${source.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</pre>`);};
 const worker=createBridgeWorker({chrome,now:()=>clock,api:async()=>submissions,fetch:fetcher});
 await worker.handle({type:'bridgePair',code:server.issuePairing()},{url:`chrome-extension://${extensionId}/popup.html`});
 const form=()=>({url:tabs.get(1).url,tab:tabs.get(1)});
 return {server,worker,state,tabs,form,chrome,setSubmissions:s=>submissions=s,advance:n=>clock+=n,sourceRequests:()=>sourceRequests};
}
test('pairing parser only accepts local port and cryptographic one-time code',()=>{assert.deepEqual(parsePairing('cfe-pair:27121:'+'a'.repeat(32)),{port:27121,code:'a'.repeat(32)});for(const text of ['http://evil.test','cfe-pair:80:'+'a'.repeat(32),'cfe-pair:27121:123456'])assert.throws(()=>parsePairing(text));});
test('source proof decodes HTML without executing it; identity excludes old or other-account submissions',async()=>{
 assert.equal(extractSource('<pre id="program-source-text">a &lt; b &amp;&amp; c&#10;</pre>'),'a < b && c\n');assert.equal(extractSource('<html>Login</html>'),null);assert.equal(await hashSource(source),sourceHash(source));
 const t={problem:{contestId:10,index:'A'},baseline:5,submittedAt:1000000,handle:'sample'},s={id:6,creationTimeSeconds:1000,problem:t.problem,author:{members:[{handle:'sample'}]}};assert(submissionMatches(t,s));assert(!submissionMatches(t,{...s,id:5}));assert(!submissionMatches(t,{...s,author:{members:[{handle:'other'}]}}));
});
test('real local HTTP round trip: task delivery, source verification, AC feedback and no duplicate tabs',async()=>{
 const e=await environment();try{
  const task=e.server.createTask({source,sourceName:'any-name.cpp',problem:{contestId:10,index:'A'},language:'cpp23'});await e.worker.tick();await e.worker.tick();assert.equal(e.tabs.size,1);
  const received=await e.worker.handle({type:'bridgeTask',id:task.id},e.form());assert.equal(received.source,source);
  await assert.rejects(e.worker.handle({type:'bridgeTask',id:task.id},{url:e.form().url,tab:{id:999}}));
  await e.worker.handle({type:'bridgePrepared',id:task.id,handle:'sample'},e.form());await e.worker.handle({type:'bridgeSubmitted',id:task.id,source},e.form());
  e.setSubmissions([{id:6,creationTimeSeconds:1000,problem:task.problem,author:{members:[{handle:'sample'}]},verdict:'OK',passedTestCount:42,timeConsumedMillis:31,memoryConsumedBytes:262144}]);await e.worker.tick();
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
 const e=await environment(),saved={};for(const k of ['chrome','window','document','location','Event','CustomEvent'])saved[k]=globalThis[k];let window;
 try{
  const task=e.server.createTask({source,sourceName:'chosen.cpp',problem:{contestId:10,index:'A'},language:'cpp23',autoSubmit:true});await e.worker.tick();assert.equal(e.server.context.autoSubmit,true);
  ({window}=parseHTML('<html><body><div id="header"><div class="lang-chooser"><a href="/profile/sample">sample</a></div></div><div id="pageContent"><form><select name="submittedProblemIndex"><option value="A">A</option></select><select name="programTypeId"><option value="91">GNU G++23</option></select><textarea name="source"></textarea><button type="submit">Submit</button></form></div></body></html>'));
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value;},set(v){for(const o of this.options)o.toggleAttribute('selected',o.value===v);},configurable:true});
  Object.assign(globalThis,{chrome:e.chrome,window,document:window.document,location:new URL(e.form().url),Event:window.Event,CustomEvent:window.CustomEvent});
  e.chrome.runtime.sendMessage=async m=>{try{return {ok:true,data:await e.worker.handle(m,e.form())};}catch(error){return {ok:false,error:error.message};}};
  let clicks=0;document.querySelector('button[type=submit]').click=()=>{clicks++;assert.equal(e.server.tasks[0].state,'submitted');assert.equal(document.querySelector('textarea').value,source);};
  await mountCompanion();assert.equal(clicks,1);assert(e.state.bridgeTasks[task.id].autoAttempt);
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

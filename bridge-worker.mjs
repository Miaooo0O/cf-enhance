import {parsePairing,validProblem,hashSource,extractSource,submissionMatches} from './bridge-protocol.mjs';
import {readSessions} from './sessions.mjs';
const finalStates=new Set(['finished','cancelled','expired','interrupted']);
export function createBridgeWorker({chrome,api,fetch:fetcher=fetch,now=Date.now}){
 let busy=false,monitoring=null,writes=Promise.resolve(),flushing=null;
 function serial(fn){const job=writes.then(fn);writes=job.catch(()=>{});return job;}
 async function state(detail,connected=false){await chrome.storage.local.set({bridgeStatus:{detail,connected,time:now()}});}
 async function config(){return (await chrome.storage.local.get('bridgeConnection')).bridgeConnection;}
 async function post(path,data,connection){const c=connection||await config();if(!c)throw Error('尚未连接 VS Code。');
  const response=await fetcher(`http://127.0.0.1:${c.port}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-CFE-Client':chrome.runtime.id,...(c.token?{Authorization:`Bearer ${c.token}`}:{})},body:JSON.stringify(data),credentials:'omit',signal:AbortSignal.timeout(2500)});
  const result=await response.json();if(!response.ok){const error=Error(result.error||'本机连接失败');error.status=response.status;throw error;}return result;
 }
 async function tasks(){return (await chrome.storage.local.get('bridgeTasks')).bridgeTasks||{};}
 async function writeTask(t){return serial(async()=>{const all=await tasks(),prev=all[t.id];if(prev&&((prev.revision||0)!==(t.revision||0)||finalStates.has(prev.state)&&prev.state!==t.state))return prev;t.revision=(t.revision||0)+1;t.updated=now();all[t.id]=t;await chrome.storage.local.set({bridgeTasks:all});return t;});}
 async function event(t,value){await serial(async()=>{const {bridgeOutbox=[]}=await chrome.storage.local.get('bridgeOutbox');bridgeOutbox.push({id:t.id,...value});await chrome.storage.local.set({bridgeOutbox:bridgeOutbox.slice(-500)});});await flushEvents();}
 async function flushEvents(){if(flushing)return flushing;flushing=(async()=>{if(!await config())return;for(let i=0;i<12;i++){const first=(await chrome.storage.local.get('bridgeOutbox')).bridgeOutbox?.[0];if(!first)return;try{await post('/event',first);}catch(e){if(![400,404,409].includes(e.status))return;}await serial(async()=>{const {bridgeOutbox=[]}=await chrome.storage.local.get('bridgeOutbox');bridgeOutbox.shift();await chrome.storage.local.set({bridgeOutbox});});}})();try{await flushing;}finally{flushing=null;}}

 async function taskForSender(m,sender){const t=(await tasks())[m.id];if(!t||sender.tab?.id!==t.tabId)throw Error('任务与当前标签页不匹配。');const u=new URL(sender.url||sender.tab.url);if(u.hostname!=='codeforces.com')throw Error('不是 CF 页面');return t;}
 async function tick(){
  if(busy||!await config())return;busy=true;
  try{
   await flushEvents();
   const stored=await chrome.storage.local.get(['bridgeContext','trainings','training']);const sessions=readSessions(stored).slice(0,20).map(s=>({id:s.id,name:s.name,problems:s.problems.map(({contestId,index,name})=>({contestId,index,name}))}));
   const data=await post('/poll',{context:{...stored.bridgeContext,sessions,autoSubmit:true,protocolVersion:2}});await state('VS Code 已连接',true);await chrome.storage.local.set({bridgeCapabilities:data.capabilities||{}});
   if(data.capabilities?.webFeedback){const {webFeedback={}}=await chrome.storage.local.get('webFeedback');const linked=new Set(Object.values(await tasks()).map(t=>t.submissionId).filter(Boolean));for(const [id,row]of Object.entries(webFeedback).sort((a,b)=>Number(a[0])-Number(b[0])).slice(-20)){const signature=JSON.stringify([row.verdict,row.passedTests,row.timeMs,row.memoryBytes]);if(!linked.has(Number(id))&&row.sentSignature!==signature){await event({id:'web:'+id},{type:'observed',...row});row.sentSignature=signature;}}await serial(async()=>{const {webFeedback:latest={}}=await chrome.storage.local.get('webFeedback');for(const [id,row]of Object.entries(webFeedback)){if(latest[id]&&JSON.stringify([latest[id].verdict,latest[id].passedTests,latest[id].timeMs,latest[id].memoryBytes])===row.sentSignature)latest[id].sentSignature=row.sentSignature;}await chrome.storage.local.set({webFeedback:latest});});}

   const all=await tasks();for(const id of data.cancelled||[]){if(all[id]&&!finalStates.has(all[id].state)){all[id].state='cancelled';delete all[id].source;await writeTask(all[id]);}}
   for(const command of data.commands||[])if(command.type==='open'&&validProblem(command.problem))await chrome.tabs.create({url:`https://codeforces.com/problemset/problem/${command.problem.contestId}/${command.problem.index}`});
   if(data.task){const remote=data.task;
    if(!/^[\da-f-]{36}$/i.test(remote.id)||!validProblem(remote.problem)||typeof remote.source!=='string'||remote.source.length>1024*1024||await hashSource(remote.source)!==remote.hash)throw Error('提交任务数据校验失败');
    const existing=(await tasks())[remote.id];
    if(existing?.state==='opened'){try{await chrome.tabs.get(existing.tabId);}catch{existing.state='error';await event(existing,{type:'state',state:'error',detail:'提交页已关闭，请在 VS Code 重新准备任务'});delete existing.source;await writeTask(existing);}}
    if(!existing){
     const tabs=await chrome.tabs.query({url:'https://codeforces.com/*'});const restored=tabs.find(tab=>{try{return new URL(tab.url).searchParams.get('cfeTask')===remote.id;}catch{return false;}});
     await event(remote,{type:'state',state:'opened',detail:'提交页已打开，等待准备代码'});
     const t={...remote,dedicatedTab:!restored,state:'opened',handle:null,baseline:0,baselineReady:false};
     if(restored)t.tabId=restored.id;else {const tab=await chrome.tabs.create({active:!t.autoSubmit,url:`https://codeforces.com/contest/${t.problem.contestId}/submit?submittedProblemIndex=${t.problem.index}&cfeTask=${t.id}${t.sessionId?'&cfeSession='+encodeURIComponent(t.sessionId):''}`});t.tabId=tab.id;}
     await writeTask(t);
    }
   }
   if(!monitoring){monitoring=monitor().catch(()=>{}).finally(()=>{monitoring=null;});}
  }catch(e){await state('联动暂不可用：'+e.message,false);}finally{busy=false;}
 }
 async function monitor(){
  const all=await tasks();for(const t of Object.values(all)){const age=now()-(t.updated||t.created);if(['opened','prepared'].includes(t.state)&&age>45000){t.state='error';await writeTask(t);await event(t,{type:'state',state:'error',detail:'CF 提交页未在 45 秒内准备完成，请查看网页后重新提交。'});}else if(t.state==='submitted'&&!t.submissionId&&now()-t.submittedAt>60000&&!t.waitNotice){t.waitNotice=true;await writeTask(t);await event(t,{type:'state',state:'submitted',attention:true,detail:'尚未识别到 CF 提交编号。请点“查看网页”检查是否被验证码、限流或表单错误阻止；不会重复提交。'});}}const active=Object.values(all).filter(t=>['submitted','judging'].includes(t.state)&&t.handle);const handles=[...new Set(active.map(t=>t.handle))];
  for(const handle of handles.slice(0,2)){
   let submissions;try{submissions=await api('user.status',{handle,from:1,count:100});}catch{continue;}
   for(const old of active.filter(t=>t.handle===handle)){const t=(await tasks())[old.id];if(!t||!['submitted','judging'].includes(t.state))continue;
    if(now()-t.created>86400000){t.state='expired';delete t.source;await writeTask(t);continue;}
    if(!t.submissionId&&t.baselineReady&&now()-(t.verifyAt||0)>=15000){
     t.verifyAt=now();await writeTask(t);
     const candidates=submissions.filter(s=>submissionMatches(t,s)),matches=[];if(candidates.length>3)continue;
     for(const s of candidates){try{const response=await fetcher(`https://codeforces.com/contest/${t.problem.contestId}/submission/${s.id}`,{credentials:'include',signal:AbortSignal.timeout(10000)});if(!response.ok)continue;const source=extractSource(await response.text());if(source!==null&&await hashSource(source)===(t.submittedHash||t.hash))matches.push(s);}catch{}}
     if(matches.length===1){const fresh=(await tasks())[t.id];if(fresh?.state!=='submitted'||fresh.submissionId)continue;t.submissionId=matches[0].id;t.state='judging';delete t.source;await event(t,{type:'bound',submissionId:t.submissionId,handle:t.handle,detail:'已核对账号、题号和代码快照，开始跟踪'});await writeTask(t);}
    }
    if(t.submissionId){const s=submissions.find(s=>s.id===t.submissionId&&s.problem?.contestId===t.problem.contestId&&s.problem.index===t.problem.index);if(s?.verdict){
      await report(t,{verdict:s.verdict,passedTests:s.passedTestCount,timeMs:s.timeConsumedMillis,memoryBytes:s.memoryConsumedBytes});
    }}
   }
  }
 }
 async function report(t,r){const verdict=r.verdict,signature=JSON.stringify([verdict,r.passedTests,r.timeMs,r.memoryBytes]);if(t.feedbackSignature===signature)return;t.feedbackSignature=signature;if(!/^[A-Z_]{2,50}$/.test(verdict||''))return;await event(t,{type:'verdict',submissionId:t.submissionId,verdict,passedTests:r.passedTests,timeMs:r.timeMs,memoryBytes:r.memoryBytes,detail:verdict==='OK'?'Accepted':`${verdict}${r.passedTests?' · 通过 '+r.passedTests+' 个测试':''}`});t.verdict=verdict;t.state=verdict==='TESTING'?'judging':'finished';delete t.source;await writeTask(t);}
 function cfPage(sender){const u=new URL(sender.url||sender.tab?.url);if(!sender.tab||u.origin!=='https://codeforces.com')throw Error('不是 CF 页面');return u;}
 const same=(a,b)=>a?.contestId===b?.contestId&&a?.index===b?.index;
 async function pageContext(m,sender){const url=cfPage(sender);return serial(async()=>{const {submissionContexts={}}=await chrome.storage.local.get('submissionContexts');if(m.problem){if(!validProblem(m.problem)||!/^[A-Za-z0-9_.-]{3,24}$/.test(m.handle||''))throw Error('提交上下文无效');submissionContexts[sender.tab.id]={problem:m.problem,handle:m.handle,baseline:Number.isSafeInteger(m.baseline)?m.baseline:0,baselineReady:m.baselineReady===true,started:now(),sessionId:m.sessionId||null,mode:m.mode==='random'?'random':'contest'};await chrome.storage.local.set({submissionContexts});}const current=submissionContexts[sender.tab.id];if(!current||now()-current.started>20*60*1000)return null;const contest=url.pathname.match(/^\/contest\/(\d+)/)?.[1];if(!m.problem&&contest&&Number(contest)!==current.problem.contestId)return null;return current;});}
 async function nativeRows(m,sender){
  const u=cfPage(sender);if(!/^(?:\/contest\/\d+\/(?:my|status|submission\/\d+)|\/problemset\/(?:status|submission\/\d+)|\/submissions\/[^/]+)\/?$/.test(u.pathname)||!/^[A-Za-z0-9_.-]{3,24}$/.test(m.handle||''))return {};
  const rows=(Array.isArray(m.rows)?m.rows:[]).slice(0,50).filter(r=>Number.isSafeInteger(r.submissionId)&&r.submissionId>0&&validProblem(r.problem)&&r.handle?.toLowerCase()===m.handle.toLowerCase()&&/^[A-Z_]{2,50}$/.test(r.verdict||'')).sort((a,b)=>b.submissionId-a.submissionId);
  const all=await tasks(),linked=new Set(Object.values(await tasks()).map(t=>t.submissionId).filter(Boolean));
  for(const t of Object.values(all).filter(t=>['submitted','judging'].includes(t.state)&&t.handle?.toLowerCase()===m.handle.toLowerCase())){
   const eligible=rows.filter(r=>same(t.problem,r.problem)&&r.submissionId>t.baseline);
   if(!t.submissionId&&t.tabId===sender.tab.id&&t.baselineReady&&eligible.length===1){const r=eligible[0];if(!Object.values(all).some(other=>other.id!==t.id&&other.submissionId===r.submissionId)){t.submissionId=r.submissionId;t.state='judging';delete t.source;await event(t,{type:'bound',handle:t.handle,submissionId:t.submissionId,detail:'已从原提交标签页确认新提交编号'});await writeTask(t);}}
   if(t.submissionId){linked.add(t.submissionId);const row=eligible.find(r=>r.submissionId===t.submissionId);if(row)await report(t,row);}
  }
  const {bridgeCapabilities={},webFeedback={}}=await chrome.storage.local.get(['account','bridgeCapabilities','webFeedback']);
  for(const r of rows.slice(0,20).reverse()){const sig=JSON.stringify([r.verdict,r.passedTests,r.timeMs,r.memoryBytes]);if(!linked.has(r.submissionId)&&webFeedback[r.submissionId]?.sentSignature!==sig&&bridgeCapabilities.webFeedback&&await config())await event({id:'web:'+r.submissionId},{type:'observed',...r,origin:'browser'});webFeedback[r.submissionId]={...r,sentSignature:bridgeCapabilities.webFeedback?sig:webFeedback[r.submissionId]?.sentSignature};}
  const {account}=await chrome.storage.local.get('account');
  let nextAccount=account;if(rows.length&&(!account||account.handle?.toLowerCase()===m.handle.toLowerCase())){
   nextAccount=account||{handle:m.handle,complete:false,states:{},time:0};nextAccount.states||={};
   for(const r of [...rows].reverse()){const id=r.problem.contestId+'/'+r.problem.index,prev=nextAccount.states[id]||{};nextAccount.states[id]={...prev,solved:prev.solved||r.verdict==='OK',attempts:Math.max(1,prev.attempts||0),...(r.submissionId>=(prev.latestId||0)?{latestId:r.submissionId,verdict:r.verdict}:{} )};}
  }
  const kept=Object.fromEntries(Object.entries(webFeedback).sort((a,b)=>Number(b[0])-Number(a[0])).slice(0,100));await chrome.storage.local.set({webFeedback:kept,...(nextAccount!==account||nextAccount?.handle?.toLowerCase()===m.handle.toLowerCase()?{account:nextAccount}:{})});
  let pending=await pageContext({},sender),accepted=null;
  if(pending&&now()-pending.started<20*60*1000&&pending.handle.toLowerCase()===m.handle.toLowerCase()){
   const match=rows.filter(r=>same(r.problem,pending.problem)&&r.submissionId>pending.baseline);
   if(pending.submissionId)accepted=match.find(r=>r.submissionId===pending.submissionId&&r.verdict==='OK');
   else if(pending.baselineReady&&match.length===1){pending.submissionId=match[0].submissionId;accepted=match[0].verdict==='OK'?match[0]:null;await serial(async()=>{const {submissionContexts={}}=await chrome.storage.local.get('submissionContexts');submissionContexts[sender.tab.id]=pending;await chrome.storage.local.set({submissionContexts});});}
  }
  if(accepted&&!pending.accepted){pending.accepted=true;await serial(async()=>{const {submissionContexts={}}=await chrome.storage.local.get('submissionContexts');submissionContexts[sender.tab.id]=pending;await chrome.storage.local.set({submissionContexts});});}
  return {accepted:accepted?{...pending,key:pending.problem.contestId+'/'+pending.problem.index,submissionId:accepted.submissionId}:null};
 }
 async function handle(m,sender){
  if(['bridgePair','bridgeDisconnect'].includes(m.type)&&!String(sender.url||'').startsWith(`chrome-extension://${chrome.runtime.id}/popup.html`))throw Error('请在 Chrome 扩展弹窗中操作配对。');
  if(m.type==='bridgePair'){const pairing=parsePairing(m.code),result=await post('/pair',{code:pairing.code,extensionId:chrome.runtime.id},{port:pairing.port});const {webFeedback={}}=await chrome.storage.local.get('webFeedback');for(const row of Object.values(webFeedback))delete row.sentSignature;await chrome.storage.local.set({bridgeConnection:{port:pairing.port,token:result.token},bridgeTasks:{},bridgeOutbox:[],webFeedback});await chrome.alarms?.create('cfe-bridge',{periodInMinutes:.5});await tick();return true;}
  if(m.type==='bridgeDisconnect'){await chrome.storage.local.remove(['bridgeConnection','bridgeTasks','bridgeOutbox']);await chrome.alarms?.clear('cfe-bridge');await state('未连接 VS Code');return true;}
  if(m.type==='bridgeStatus'){const s=await chrome.storage.local.get(['bridgeConnection','bridgeStatus']);return {paired:!!s.bridgeConnection,...s.bridgeStatus};}
  if(m.type==='bridgeTick'){await tick();return true;}
  if(m.type==='bridgeRows')return nativeRows(m,sender);
  if(m.type==='bridgeWebSubmit'||m.type==='bridgePageContext')return pageContext(m.type==='bridgePageContext'?{}:m,sender);
  if(m.type==='bridgeContext'){if(sender.tab?.active&&validProblem(m.problem))await chrome.storage.local.set({bridgeContext:{problem:m.problem,handle:String(m.handle||'').slice(0,24),sessionId:m.sessionId||null,mode:m.mode==='random'?'random':'contest',samples:Array.isArray(m.samples)?m.samples.slice(0,20).map(s=>({input:String(s.input).slice(0,65536),output:String(s.output).slice(0,65536)})):[]}});return true;}
  if(m.type==='bridgePageTasks'){return Object.values(await tasks()).filter(t=>!finalStates.has(t.state)).map(({source,...meta})=>meta);}
  if(m.type==='bridgeResume'){const u=new URL(sender.url||sender.tab?.url);return Object.values(await tasks()).find(t=>t.tabId===sender.tab?.id&&u.hostname==='codeforces.com'&&u.pathname===`/contest/${t.problem.contestId}/submit`)?.id||null;}
  const t=await taskForSender(m,sender);
  if(m.type==='bridgeTask'){if(!new URL(sender.url||sender.tab.url).pathname.match(new RegExp(`^/contest/${t.problem.contestId}/submit/?$`)))throw Error('不在目标题目提交页');return t;}
  if(m.type==='bridgeFailed'){if(finalStates.has(t.state)||t.state==='judging')return false;t.state='error';await writeTask(t);await event(t,{type:'state',state:'error',detail:String(m.detail||'网页提交受阻').slice(0,300)});return true;}
  if(m.type==='bridgePrepared'){
   if(t.autoAttempt||!['opened','prepared','error'].includes(t.state))throw Error('本任务已发送或结束，不会重新准备');
   if(!/^[A-Za-z0-9_.-]{3,24}$/.test(m.handle||''))throw Error('请先在 CF 登录后刷新提交页。');
   t.handle=m.handle;t.state='prepared';t.baseline=Number.isSafeInteger(m.baseline)&&m.baseline>=0?m.baseline:0;t.baselineReady=m.baselineReady===true;
   await event(t,{type:'state',state:'prepared',detail:'代码已核对，正在提交'});await writeTask(t);return true;
  }
  if(m.type==='bridgeSubmitted'){
   if(t.state!=='prepared')throw Error('请先准备代码并确认 CF 账号。');if(t.autoSubmit)t.autoAttempt=true;t.submittedAt=now();t.submittedHash=typeof m.source==='string'&&m.source.length<=1024*1024?await hashSource(m.source):t.hash;t.state='submitted';
   await writeTask(t);await pageContext({problem:t.problem,handle:t.handle,baseline:t.baseline,baselineReady:t.baselineReady,sessionId:t.sessionId,mode:t.mode},sender);await event(t,{type:'state',state:'submitted',detail:'已发送提交请求，等待 CF 网页返回编号'});return true;
  }
  throw Error('未知联动操作');
 }
 // Verdicts from native result pages require an explicit user-selected row first.
 async function result(m,sender){
  cfPage(sender);const t=(await tasks())[m.id];if(!t||!sender.tab||!/^\/(?:contest\/\d+\/(?:my|status|submission\/\d+)|problemset\/(?:status|submission\/\d+)|submissions\/[^/]+)\/?$/.test(new URL(sender.url||sender.tab.url).pathname))throw Error('结果页面与任务不匹配');
  if(m.handle?.toLowerCase()!==t.handle?.toLowerCase()||m.problem?.contestId!==t.problem.contestId||m.problem.index!==t.problem.index||!Number.isSafeInteger(m.submissionId)||m.submissionId<=t.baseline)throw Error('提交账号、题号或编号不匹配');
  if(m.type==='bridgeBind'){
   if(!m.confirmed||t.state!=='submitted')throw Error('请先确认本次提交行');
   if(Object.values(await tasks()).some(other=>other.id!==t.id&&other.submissionId===m.submissionId))throw Error('该提交已属于其他任务');
   t.submissionId=m.submissionId;t.state='judging';delete t.source;await event(t,{type:'bound',handle:t.handle,submissionId:t.submissionId,detail:'用户已确认提交编号'});await writeTask(t);
  }
  if(t.submissionId!==m.submissionId)throw Error('任务已关联其他提交');
  if(m.verdict)await report(t,m);return true;
 }
 return {tick,drain:async()=>{if(monitoring)await monitoring;await flushEvents();},handle:async(m,s)=>m.type==='bridgeBind'||m.type==='bridgeVerdict'?result(m,s):handle(m,s)};
}

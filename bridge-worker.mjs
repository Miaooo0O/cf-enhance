import {parsePairing,validProblem,hashSource,extractSource,submissionMatches} from './bridge-protocol.mjs';
import {readSessions} from './sessions.mjs';
const finalStates=new Set(['finished','cancelled','expired','interrupted']);
export function createBridgeWorker({chrome,api,fetch:fetcher=fetch,now=Date.now}){
 let busy=false;
 async function state(detail,connected=false){await chrome.storage.local.set({bridgeStatus:{detail,connected,time:now()}});}
 async function config(){return (await chrome.storage.local.get('bridgeConnection')).bridgeConnection;}
 async function post(path,data,connection){const c=connection||await config();if(!c)throw Error('尚未连接 VS Code。');
  const response=await fetcher(`http://127.0.0.1:${c.port}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-CFE-Client':chrome.runtime.id,...(c.token?{Authorization:`Bearer ${c.token}`}:{})},body:JSON.stringify(data),credentials:'omit',signal:AbortSignal.timeout(8000)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'本机连接失败');return result;
 }
 async function tasks(){return (await chrome.storage.local.get('bridgeTasks')).bridgeTasks||{};}
 async function writeTask(t){const all=await tasks();all[t.id]=t;await chrome.storage.local.set({bridgeTasks:all});return t;}
 async function event(t,value){await post('/event',{id:t.id,...value});}
 async function taskForSender(m,sender){const t=(await tasks())[m.id];if(!t||sender.tab?.id!==t.tabId)throw Error('任务与当前标签页不匹配。');const u=new URL(sender.url||sender.tab.url);if(u.hostname!=='codeforces.com')throw Error('不是 CF 页面');return t;}
 async function tick(){
  if(busy||!await config())return;busy=true;
  try{
   const stored=await chrome.storage.local.get(['bridgeContext','trainings','training']);const sessions=readSessions(stored).slice(0,20).map(s=>({id:s.id,name:s.name,problems:s.problems.map(({contestId,index,name})=>({contestId,index,name}))}));
   const data=await post('/poll',{context:{...stored.bridgeContext,sessions,autoSubmit:true}});await state('VS Code 已连接',true);
   const all=await tasks();for(const id of data.cancelled||[]){if(all[id]){all[id].state='cancelled';delete all[id].source;}}
   await chrome.storage.local.set({bridgeTasks:all});
   for(const command of data.commands||[])if(command.type==='open'&&validProblem(command.problem))await chrome.tabs.create({url:`https://codeforces.com/problemset/problem/${command.problem.contestId}/${command.problem.index}`});
   if(data.task){const remote=data.task;
    if(!/^[\da-f-]{36}$/i.test(remote.id)||!validProblem(remote.problem)||typeof remote.source!=='string'||remote.source.length>1024*1024||await hashSource(remote.source)!==remote.hash)throw Error('提交任务数据校验失败');
    const existing=(await tasks())[remote.id];
    if(existing?.state==='opened'){try{await chrome.tabs.get(existing.tabId);}catch{existing.state='error';await event(existing,{type:'state',state:'error',detail:'提交页已关闭，请在 VS Code 重新准备任务'});delete existing.source;await writeTask(existing);}}
    if(!existing){
     const tabs=await chrome.tabs.query({url:'https://codeforces.com/*'});const restored=tabs.find(tab=>{try{return new URL(tab.url).searchParams.get('cfeTask')===remote.id;}catch{return false;}});
     await event(remote,{type:'state',state:'opened',detail:'提交页已打开，等待准备代码'});
     const t={...remote,state:'opened',handle:null,baseline:0,baselineReady:false};
     if(restored)t.tabId=restored.id;else {const tab=await chrome.tabs.create({active:!t.autoSubmit,url:`https://codeforces.com/contest/${t.problem.contestId}/submit?submittedProblemIndex=${t.problem.index}&cfeTask=${t.id}${t.sessionId?'&cfeSession='+encodeURIComponent(t.sessionId):''}`});t.tabId=tab.id;}
     await writeTask(t);
    }
   }
   await monitor();
  }catch(e){await state('联动暂不可用：'+e.message,false);}finally{busy=false;}
 }
 async function monitor(){
  const all=await tasks(),active=Object.values(all).filter(t=>['submitted','judging'].includes(t.state)&&t.handle);const handles=[...new Set(active.map(t=>t.handle))];
  for(const handle of handles.slice(0,2)){
   let submissions;try{submissions=await api('user.status',{handle,from:1,count:100});}catch{continue;}
   for(const t of active.filter(t=>t.handle===handle)){
    if(now()-t.created>86400000){t.state='expired';delete t.source;await writeTask(t);continue;}
    if(!t.submissionId&&t.baselineReady&&now()-(t.verifyAt||0)>=15000){
     t.verifyAt=now();await writeTask(t);
     const candidates=submissions.filter(s=>submissionMatches(t,s)).slice(0,3),matches=[];
     for(const s of candidates){try{const response=await fetcher(`https://codeforces.com/contest/${t.problem.contestId}/submission/${s.id}`,{credentials:'include',signal:AbortSignal.timeout(10000)});if(!response.ok)continue;const source=extractSource(await response.text());if(source!==null&&await hashSource(source)===(t.submittedHash||t.hash))matches.push(s);}catch{}}
     if(matches.length===1&&candidates.length===1){t.submissionId=matches[0].id;t.state='judging';delete t.source;await event(t,{type:'bound',submissionId:t.submissionId,handle:t.handle,detail:'已核对账号、题号和代码快照，开始跟踪'});await writeTask(t);}
    }
    if(t.submissionId){const s=submissions.find(s=>s.id===t.submissionId&&s.problem?.contestId===t.problem.contestId&&s.problem.index===t.problem.index);if(s?.verdict){
      await report(t,{verdict:s.verdict,passedTests:s.passedTestCount,timeMs:s.timeConsumedMillis,memoryBytes:s.memoryConsumedBytes});
    }}
   }
  }
 }
 async function report(t,r){const verdict=r.verdict;if(!/^[A-Z_]{2,50}$/.test(verdict||''))return;await event(t,{type:'verdict',submissionId:t.submissionId,verdict,passedTests:r.passedTests,timeMs:r.timeMs,memoryBytes:r.memoryBytes,detail:verdict==='OK'?'Accepted':`${verdict}${r.passedTests?' · 通过 '+r.passedTests+' 个测试':''}`});t.verdict=verdict;t.state=verdict==='TESTING'?'judging':'finished';delete t.source;await writeTask(t);}
 async function handle(m,sender){
  if(['bridgePair','bridgeDisconnect'].includes(m.type)&&!String(sender.url||'').startsWith(`chrome-extension://${chrome.runtime.id}/popup.html`))throw Error('请在 Chrome 扩展弹窗中操作配对。');
  if(m.type==='bridgePair'){const pairing=parsePairing(m.code),result=await post('/pair',{code:pairing.code,extensionId:chrome.runtime.id},{port:pairing.port});await chrome.storage.local.set({bridgeConnection:{port:pairing.port,token:result.token},bridgeTasks:{}});await chrome.alarms?.create('cfe-bridge',{periodInMinutes:.5});await tick();return true;}
  if(m.type==='bridgeDisconnect'){await chrome.storage.local.remove(['bridgeConnection','bridgeTasks']);await chrome.alarms?.clear('cfe-bridge');await state('未连接 VS Code');return true;}
  if(m.type==='bridgeStatus'){const s=await chrome.storage.local.get(['bridgeConnection','bridgeStatus']);return {paired:!!s.bridgeConnection,...s.bridgeStatus};}
  if(m.type==='bridgeTick'){await tick();return true;}
  if(m.type==='bridgeContext'){if(sender.tab?.active&&validProblem(m.problem))await chrome.storage.local.set({bridgeContext:{problem:m.problem,handle:String(m.handle||'').slice(0,24),samples:Array.isArray(m.samples)?m.samples.slice(0,20).map(s=>({input:String(s.input).slice(0,65536),output:String(s.output).slice(0,65536)})):[]}});return true;}
  if(m.type==='bridgePageTasks'){return Object.values(await tasks()).filter(t=>!finalStates.has(t.state)).map(({source,...meta})=>meta);}
  if(m.type==='bridgeResume'){const u=new URL(sender.url||sender.tab?.url);return Object.values(await tasks()).find(t=>t.tabId===sender.tab?.id&&u.hostname==='codeforces.com'&&u.pathname===`/contest/${t.problem.contestId}/submit`)?.id||null;}
  const t=await taskForSender(m,sender);
  if(m.type==='bridgeTask'){if(!new URL(sender.url||sender.tab.url).pathname.match(new RegExp(`^/contest/${t.problem.contestId}/submit/?$`)))throw Error('不在目标题目提交页');return t;}
  if(m.type==='bridgeFailed'){if(finalStates.has(t.state)||t.state==='judging')return false;t.state='error';await writeTask(t);await event(t,{type:'state',state:'error',detail:String(m.detail||'网页提交受阻').slice(0,300)});return true;}
  if(m.type==='bridgePrepared'){
   if(t.autoAttempt||!['opened','prepared','error'].includes(t.state))throw Error('本任务已发送或结束，不会重新准备');
   if(!/^[A-Za-z0-9_.-]{3,24}$/.test(m.handle||''))throw Error('请先在 CF 登录后刷新提交页。');
   t.handle=m.handle;t.state='prepared';try{const recent=await api('user.status',{handle:m.handle,from:1,count:100});t.baseline=Math.max(0,...recent.map(s=>s.id));t.baselineReady=true;}catch{t.baselineReady=false;}
   await event(t,{type:'state',state:'prepared',detail:'代码已核对，正在提交'});await writeTask(t);return true;
  }
  if(m.type==='bridgeSubmitted'){
   if(t.state!=='prepared')throw Error('请先准备代码并确认 CF 账号。');if(t.autoSubmit)t.autoAttempt=true;t.submittedAt=now();t.submittedHash=typeof m.source==='string'&&m.source.length<=1024*1024?await hashSource(m.source):t.hash;t.state='submitted';
   await writeTask(t);await event(t,{type:'state',state:'submitted',detail:'等待 CF 提交结果；自动核对代码或在结果行点击关联'});return true;
  }
  throw Error('未知联动操作');
 }
 // Verdicts from native result pages require an explicit user-selected row first.
 async function result(m,sender){
  const t=(await tasks())[m.id];if(!t||!sender.tab||!new URL(sender.url||sender.tab.url).pathname.startsWith(`/contest/${t.problem.contestId}/`))throw Error('结果页面与任务不匹配');
  if(m.handle?.toLowerCase()!==t.handle?.toLowerCase()||m.problem?.contestId!==t.problem.contestId||m.problem.index!==t.problem.index||!Number.isSafeInteger(m.submissionId)||m.submissionId<=t.baseline)throw Error('提交账号、题号或编号不匹配');
  if(m.type==='bridgeBind'){
   if(!m.confirmed||t.state!=='submitted')throw Error('请先确认本次提交行');
   if(Object.values(await tasks()).some(other=>other.id!==t.id&&other.submissionId===m.submissionId))throw Error('该提交已属于其他任务');
   t.submissionId=m.submissionId;t.state='judging';delete t.source;await event(t,{type:'bound',handle:t.handle,submissionId:t.submissionId,detail:'用户已确认提交编号'});await writeTask(t);
  }
  if(t.submissionId!==m.submissionId)throw Error('任务已关联其他提交');
  if(m.verdict)await report(t,m);return true;
 }
 return {tick,handle:async(m,s)=>m.type==='bridgeBind'||m.type==='bridgeVerdict'?result(m,s):handle(m,s)};
}

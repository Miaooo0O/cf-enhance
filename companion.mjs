import {request,getLocal,contextActive} from './client.mjs';
export async function fetchProblemSamples(problem,{fetch:fetcher=fetch,Parser=DOMParser}={}){
 if(!Number.isSafeInteger(problem?.contestId)||problem.contestId<=0||!/^[A-Z]\d*$/.test(problem.index))throw Error('目标题目无效');
 const response=await fetcher(`https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`,{credentials:'include',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('CF 题目读取失败（'+response.status+'），请在 Chrome 打开该题后重试。');
 const doc=new Parser().parseFromString(await response.text(),'text/html'),inputs=[...doc.querySelectorAll('.sample-test .input pre')],outputs=[...doc.querySelectorAll('.sample-test .output pre')];
 if(!inputs.length||inputs.length!==outputs.length)throw Error('未找到样例，请在 Chrome 打开目标题目并检查登录或验证页面。');
 const text=pre=>{const copy=pre.cloneNode(true);for(const br of copy.querySelectorAll('br'))br.replaceWith('\n');for(const line of copy.querySelectorAll('.test-example-line'))line.append('\n');return copy.textContent.replace(/\r\n?/g,'\n').replace(/\n$/,'');};
 const samples=inputs.slice(0,20).map((pre,i)=>({input:text(pre),output:text(outputs[i])}));if(samples.some(s=>s.input.length>65536||s.output.length>65536))throw Error('样例过长，请手动添加');return samples;
}
import {hashSource,languageOption} from './bridge-protocol.mjs';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function loggedHandle(doc=document){const a=doc.querySelector('#header .lang-chooser a[href*="/profile/"]');return a?decodeURIComponent(new URL(a.getAttribute('href'),'https://codeforces.com').pathname.split('/').pop()):null;}
export function parseResultRows(doc=document){
 const result=[];for(const row of doc.querySelectorAll('tr[data-submission-id]')){
  const id=Number(row.getAttribute('data-submission-id')),profile=row.querySelector('a[href*="/profile/"]'),problemLink=[...row.querySelectorAll('a[href]')].find(a=>/\/(?:contest\/\d+\/problem\/|problemset\/problem\/)/.test(a.getAttribute('href')));
  const m=problemLink?.getAttribute('href').match(/\/(?:contest\/(\d+)\/problem|problemset\/problem\/(\d+))\/([A-Za-z]\d*)/);
  if(!id||!profile||!m)continue;
  const handle=decodeURIComponent(profile.getAttribute('href').split('/').pop()),node=row.querySelector('[submissionverdict],.submissionVerdictWrapper,.status-cell'),label=node?.textContent||row.textContent,verdict=node?.getAttribute('submissionverdict')|| (row.querySelector('.verdict-accepted')||/Accepted|已通过/i.test(label)?'OK':[['WRONG_ANSWER',/Wrong answer|答案错误/i],['TIME_LIMIT_EXCEEDED',/Time limit|时间超限/i],['MEMORY_LIMIT_EXCEEDED',/Memory limit|内存超限/i],['COMPILATION_ERROR',/Compilation error|编译错误/i],['RUNTIME_ERROR',/Runtime error|运行错误/i],['SKIPPED',/Skipped|跳过/i],['IDLENESS_LIMIT_EXCEEDED',/Idleness limit/i],['CHALLENGED',/Challenged|被挑战/i],['FAILED',/Judgement failed/i]].find(([,p])=>p.test(label))?.[0]);
  const number=selector=>Number((row.querySelector(selector)?.textContent||'').replace(/[^\d]/g,''))||0;
  const failed=Number((node?.textContent||'').match(/(?:test|测试)\s*(\d+)/i)?.[1]);
  result.push({row,submissionId:id,handle,problem:{contestId:Number(m[1]||m[2]),index:m[3].toUpperCase()},verdict:verdict||'TESTING',passedTests:failed?failed-1:0,timeMs:number('.time-consumed-cell'),memoryBytes:number('.memory-consumed-cell')*1024});
 }return result;
}
export async function fillNativeTask(task,doc=document){
 const index=doc.querySelector('[name="submittedProblemIndex"]');
 if(!index)throw Error('CF 提交表单尚未加载，请稍后点击重试。');
 if(index.tagName==='SELECT'&&![...index.options].some(o=>o.value===task.problem.index))throw Error('目标题号不在当前表单中。');
 index.value=task.problem.index;index.dispatchEvent(new Event('change',{bubbles:true}));
 const language=doc.querySelector('[name="programTypeId"]'),value=language&&languageOption(language.options,task.language);
 if(value){language.value=value;language.dispatchEvent(new Event('change',{bubbles:true}));}
 const field=doc.querySelector('textarea[name="source"],textarea#sourceCodeTextarea');if(!field)throw Error('未找到 CF 代码编辑框，请先切换到文本代码输入。');
 doc.dispatchEvent(new CustomEvent('cfe-editor-sync'));
 if(field.value.trim()&&await hashSource(field.value)!==task.hash&&!task.replacePrefill)throw Error('网页中已有不同代码，未覆盖。请先自行保存并清空，再点击准备。');
 const nonce=crypto.randomUUID();let acknowledged=false;
 const listener=e=>{if(e.detail?.nonce===nonce)acknowledged=true;};doc.addEventListener('cfe-editor-filled',listener);
 doc.dispatchEvent(new CustomEvent('cfe-editor-fill',{detail:{nonce,source:task.source}}));doc.removeEventListener('cfe-editor-filled',listener);
 if(!acknowledged){if(doc.querySelector('.CodeMirror,#editor'))throw Error('编辑器适配器尚未就绪，请刷新本页后重试。');field.value=task.source;field.dispatchEvent(new Event('input',{bubbles:true}));}
 if(await hashSource(field.value)!==task.hash)throw Error('代码快照核对失败，请重试。');
 return {languageMatched:!!value||task.language==='manual',form:field.closest('form'),field};
}
export async function submitNativeTask(task,filled,beforeSubmit,doc=document){
 const {form,field}=filled;if(!form)throw Error('未找到提交表单');
 if(!filled.languageMatched||task.language==='manual')throw Error('自动提交需要明确且匹配的语言，请在 VS Code 选择语言。');
 const button=form.querySelector('#singlePageSubmitButton,input[type="submit"],button[type="submit"]');
 if(!button||button.disabled)throw Error('CF 提交按钮不可用，请检查登录或提交限制。');
 const captcha=[...doc.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenges.cloudflare.com"],input[name*="captcha"],.cf-turnstile,.g-recaptcha')].some(n=>n.getClientRects?.().length);
 if(captcha)throw Error('CF 要求验证码，请到网页处理；不会自动重复提交。');
 const upload=form.querySelector('input[type="file"]');if(upload?.files?.length)throw Error('提交页选中了其他代码文件，请清除文件选择后重试。');
 if(form.checkValidity&&!form.checkValidity())throw Error('CF 表单校验未通过，请到网页检查。');
 if(form.dataset.cfeAutoAttempt)throw Error('本任务已经尝试提交，不会再次自动发送。');
 const validate=async()=>{const language=doc.querySelector('[name="programTypeId"]');if(!language||language.value!==languageOption(language.options,task.language)||doc.querySelector('[name="submittedProblemIndex"]')?.value!==task.problem.index||await hashSource(field.value)!==task.hash)throw Error('提交内容已变化，请在 VS Code 重新提交。');};
 await validate();form.dataset.cfeAutoAttempt=task.id;
 await beforeSubmit();await validate();if(button.disabled)throw Error('CF 暂时禁用了提交按钮，请稍后重试。');button.click();
}
export async function readSubmissionBaseline(contestId,handle,{fetch:fetcher=fetch,Parser=DOMParser}={}){
 try{const response=await fetcher('https://codeforces.com/contest/'+contestId+'/my',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(6000)});if(!response.ok)return {baseline:0,baselineReady:false};const doc=new Parser().parseFromString(await response.text(),'text/html');if(loggedHandle(doc)?.toLowerCase()!==handle.toLowerCase()||!doc.querySelector('#pageContent'))return {baseline:0,baselineReady:false};return {baseline:Math.max(0,...[...doc.querySelectorAll('tr[data-submission-id]')].map(r=>Number(r.getAttribute('data-submission-id'))||0)),baselineReady:true};}catch{return {baseline:0,baselineReady:false};}
}
export async function mountCompanion(){
 let stopped=false,timer,running=false;const params=new URL(location.href).searchParams;let taskId=params.get('cfeTask');
 if(!taskId&&/^\/contest\/\d+\/submit\/?$/.test(location.pathname)){try{taskId=await request('bridgeResume');}catch{}}
 const content=document.querySelector('#pageContent')||document.body;
 const panel=el('div');panel.id='cfe-companion';panel.className='roundbox';panel.hidden=true;
 const text=el('p'),actions=el('div');panel.append(text,actions);content.prepend(panel);
 const button=(title,fn)=>{const b=el('button',title);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){text.textContent=e.message;}finally{b.disabled=false;}};return b;};
 function stop(){stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);document.removeEventListener('input',edited,true);window.removeEventListener('cfe-context-invalidated',stop);}
 window.addEventListener('pagehide',stop,{once:true});window.addEventListener('cfe-context-invalidated',stop,{once:true});
 async function publishContext(){const m=location.pathname.match(/^\/(?:problemset\/problem\/(\d+)|contest\/(\d+)\/problem)\/([A-Za-z]\d*)/);if(m){const inputs=[...document.querySelectorAll('.sample-test .input pre')],outputs=[...document.querySelectorAll('.sample-test .output pre')];await request('bridgeContext',{problem:{contestId:Number(m[1]||m[2]),index:m[3].toUpperCase()},handle:loggedHandle(),sessionId:params.get('cfeSession'),mode:params.get('cfeMode'),samples:inputs.slice(0,20).map((p,i)=>({input:(p.innerText||p.textContent).slice(0,65536),output:(outputs[i]?.innerText||outputs[i]?.textContent||'').slice(0,65536)}))});}}
 let task,prepared=false,automatic=false,userEdited=false;
 const edited=e=>{if(e.isTrusted&&e.target.matches?.('textarea[name="source"],textarea#sourceCodeTextarea,[name="submittedProblemIndex"],[name="programTypeId"],.CodeMirror textarea'))userEdited=true;};document.addEventListener('input',edited,true);
 const submitContest=location.pathname.match(/^\/contest\/(\d+)\/submit\/?$/),pageMatch=location.pathname.match(/^\/(?:contest\/(\d+)\/problem|problemset\/problem\/(\d+))\/([A-Za-z]\d*)/);
 const nativeProblem=pageMatch?{contestId:Number(pageMatch[1]||pageMatch[2]),index:pageMatch[3]}:null;
 const submitForm=document.querySelector('[name="submittedProblemIndex"]')?.closest('form');
 const nativeForms=submitContest&&submitForm?[submitForm]:nativeProblem?[...document.querySelectorAll('form')].filter(f=>new URL(f.getAttribute('action')||location.href,location.href).pathname.includes('/submit')):[];
 const currentHandle=loggedHandle(),baselineJob=nativeForms.length&&currentHandle?readSubmissionBaseline(Number(submitContest?.[1]||nativeProblem.contestId),currentHandle):Promise.resolve({baseline:0,baselineReady:false});let nativeBaseline={baseline:0,baselineReady:false};void baselineJob.then(value=>nativeBaseline=value);
 if(!taskId)for(const form of nativeForms)form.addEventListener('submit',()=>{const index=form.querySelector('[name="submittedProblemIndex"]')?.value||nativeProblem?.index;if(currentHandle&&index)void request('bridgeWebSubmit',{problem:{contestId:Number(submitContest?.[1]||nativeProblem.contestId),index},handle:currentHandle,...nativeBaseline,sessionId:params.get('cfeSession'),mode:params.get('cfeMode')}).catch(()=>{});},{capture:true});
 function nativeError(){return [...document.querySelectorAll('.error,.error-message,.error-text')].filter(n=>n.getClientRects?.().length).map(n=>n.textContent.trim()).filter(Boolean).join('；').slice(0,300);}
 async function failed(e){text.textContent=e.message;try{await request('bridgeFailed',{id:taskId,detail:e.message});}catch{}}
 async function prepare(){
  task=await request('bridgeTask',{id:taskId});if(task.autoAttempt||['submitted','judging','finished','cancelled','expired','interrupted'].includes(task.state)){const error=nativeError();if(error&&task.autoAttempt)await failed(Error(error));else text.textContent='本任务已发送或结束，不会重复提交。';return;}if(!task.source)throw Error('该任务的代码快照已释放，请在 VS Code 重新准备。');
  const handle=loggedHandle();if(!handle)throw Error('请先登录 CF，然后刷新提交页。');
  let filled;for(let attempt=0;attempt<20;attempt++){try{if(userEdited)throw Error('你正在编辑网页提交内容，自动提交已暂停。');filled=await fillNativeTask({...task,replacePrefill:task.dedicatedTab&&!userEdited});break;}catch(e){if(attempt===19||!/尚未加载|未找到 CF 代码编辑框|尚未就绪/.test(e.message))throw e;await new Promise(r=>setTimeout(r,250));}}
  let baseline=await baselineJob;if(!baseline.baselineReady&&!nativeForms.length)baseline=await readSubmissionBaseline(task.problem.contestId,handle);if(task.autoSubmit&&!baseline.baselineReady)throw Error('无法读取 CF 我的提交页，未发送代码。请确认登录状态后重新提交。');await request('bridgePrepared',{id:taskId,handle,...baseline});prepared=true;
  text.textContent=task.autoSubmit?'正在自动提交…':`VS Code：${task.sourceName} → ${task.problem.contestId}${task.problem.index}。代码已填入，请检查语言、题号和代码后，用 CF 原生 Submit 确认提交。${filled.languageMatched?'':'未匹配指定语言，请手动选择。'}`;
  if(!filled.form.dataset.cfeTask){filled.form.dataset.cfeTask=taskId;filled.form.addEventListener('submit',()=>{
   if(!prepared||stopped||automatic)return;document.dispatchEvent(new CustomEvent('cfe-editor-sync'));
   // Send before navigation; hashing is async, so capture synchronously first.
   void request('bridgeSubmitted',{id:taskId,source:filled.field.value}).catch(e=>text.textContent=e.message);
  },{capture:true});}
  if(task.autoSubmit){automatic=true;try{await submitNativeTask(task,filled,()=>{if(userEdited)throw Error('网页提交内容被手动修改，自动提交已暂停。');return request('bridgeSubmitted',{id:taskId,source:filled.field.value});});text.textContent='已自动发送，正在等待 CF 评测。';}catch(e){await failed(e);throw e;}}
 }
 if(taskId){panel.hidden=false;text.textContent='正在读取 VS Code 提交任务…';actions.append(button('检查 / 继续任务',async()=>{try{await prepare();}catch(e){await failed(e);}}));}
 async function checkResults(){
  if(!/\/contest\/\d+\/(?:my|status|submission\/\d+)|\/problemset\/(?:status|submission\/\d+)|\/submissions\//.test(location.pathname))return;
  const rows=parseResultRows();const feedback=await request('bridgeRows',{handle:loggedHandle(),rows:rows.map(withoutNode)});if(feedback?.accepted)window.dispatchEvent(new CustomEvent('cfe-accepted',{detail:feedback.accepted}));
  const tasks=await request('bridgePageTasks');
  for(const t of tasks.filter(t=>['submitted','judging'].includes(t.state))){
   const eligible=rows.filter(r=>r.handle.toLowerCase()===t.handle?.toLowerCase()&&r.problem.contestId===t.problem.contestId&&r.problem.index===t.problem.index&&r.submissionId>t.baseline);
   if(eligible.length){panel.hidden=false;text.textContent='VS Code 正在等待 / 跟踪本次提交。未自动关联时，请在你刚提交的那一行点击“关联 VS Code”，不要选择历史提交。';}
   if(t.submissionId){const row=eligible.find(r=>r.submissionId===t.submissionId);if(row)await request('bridgeVerdict',{id:t.id,...withoutNode(row)});continue;}
   for(const r of eligible){const marker=`cfe-bind-${t.id}`;if(r.row.querySelector(`[data-cfe-bind="${marker}"]`))continue;
    const bind=button(`关联 VS Code：${t.sourceName}`,async()=>{await request('bridgeBind',{id:t.id,confirmed:true,...withoutNode(r)});bind.textContent='已关联 VS Code';bind.disabled=true;});bind.dataset.cfeBind=marker;bind.className='cfe-bind';r.row.querySelector('td')?.append(bind);
   }
  }
 }
 const withoutNode=({row,...rest})=>rest;
 async function tick(){
  if(stopped||running||!contextActive())return;running=true;
  try{
   if(taskId&&automatic){const error=nativeError();if(error){automatic=false;await failed(Error(error));}}
   await request('bridgeTick');await checkResults();
  }catch(e){if(taskId)text.textContent=e.message;}finally{running=false;}
 }
 async function visible(){if(!document.hidden){try{await publishContext();}catch{}void tick();}}
 document.addEventListener('visibilitychange',visible);
 await publishContext();if(taskId){try{await prepare();}catch(e){await failed(e);}}
 timer=setInterval(()=>{void tick();},4000);void tick();
}

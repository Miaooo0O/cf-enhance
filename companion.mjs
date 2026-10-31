import {request,getLocal,contextActive} from './client.mjs';
import {hashSource,languageOption} from './bridge-protocol.mjs';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function loggedHandle(doc=document){const a=doc.querySelector('#header .lang-chooser a[href*="/profile/"]');return a?decodeURIComponent(new URL(a.getAttribute('href'),'https://codeforces.com').pathname.split('/').pop()):null;}
export function parseResultRows(doc=document){
 const result=[];for(const row of doc.querySelectorAll('tr[data-submission-id]')){
  const id=Number(row.getAttribute('data-submission-id')),profile=row.querySelector('a[href*="/profile/"]'),problemLink=[...row.querySelectorAll('a[href]')].find(a=>/\/(?:contest\/\d+\/problem\/|problemset\/problem\/)/.test(a.getAttribute('href')));
  const m=problemLink?.getAttribute('href').match(/\/(?:contest\/(\d+)\/problem|problemset\/problem\/(\d+))\/([A-Za-z]\d*)/);
  if(!id||!profile||!m)continue;
  const handle=decodeURIComponent(profile.getAttribute('href').split('/').pop()),node=row.querySelector('[submissionverdict]'),verdict=node?.getAttribute('submissionverdict')|| (row.querySelector('.verdict-accepted')?'OK':null);
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
 if(field.value.trim()&&await hashSource(field.value)!==task.hash)throw Error('网页中已有不同代码，未覆盖。请先自行保存并清空，再点击准备。');
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
 const button=form.querySelector('input[type="submit"],button[type="submit"],button:not([type])');
 if(!button||button.disabled)throw Error('CF 提交按钮不可用，请检查登录或提交限制。');
 const captcha=[...doc.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenges.cloudflare.com"],input[name*="captcha"],.cf-turnstile,.g-recaptcha')].some(n=>n.getClientRects?.().length);
 if(captcha)throw Error('CF 要求验证码，请到网页处理；不会自动重复提交。');
 if(form.checkValidity&&!form.checkValidity())throw Error('CF 表单校验未通过，请到网页检查。');
 if(form.dataset.cfeAutoAttempt)throw Error('本任务已经尝试提交，不会再次自动发送。');
 const validate=async()=>{const language=doc.querySelector('[name="programTypeId"]');if(!language||language.value!==languageOption(language.options,task.language)||doc.querySelector('[name="submittedProblemIndex"]')?.value!==task.problem.index||await hashSource(field.value)!==task.hash)throw Error('提交内容已变化，请在 VS Code 重新提交。');};
 await validate();form.dataset.cfeAutoAttempt=task.id;
 await beforeSubmit();await validate();button.click();
}
export async function mountCompanion(){
 let stopped=false,timer,running=false;const params=new URL(location.href).searchParams;let taskId=params.get('cfeTask');
 if(!taskId&&/^\/contest\/\d+\/submit\/?$/.test(location.pathname)){try{taskId=await request('bridgeResume');}catch{}}
 const content=document.querySelector('#pageContent')||document.body;
 const panel=el('div');panel.id='cfe-companion';panel.className='roundbox';panel.hidden=true;
 const text=el('p'),actions=el('div');panel.append(text,actions);content.prepend(panel);
 const button=(title,fn)=>{const b=el('button',title);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){text.textContent=e.message;}finally{b.disabled=false;}};return b;};
 function stop(){stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('cfe-context-invalidated',stop);}
 window.addEventListener('pagehide',stop,{once:true});window.addEventListener('cfe-context-invalidated',stop,{once:true});
 async function publishContext(){const m=location.pathname.match(/^\/(?:problemset\/problem\/(\d+)|contest\/(\d+)\/problem)\/([A-Za-z]\d*)/);if(m){const inputs=[...document.querySelectorAll('.sample-test .input pre')],outputs=[...document.querySelectorAll('.sample-test .output pre')];await request('bridgeContext',{problem:{contestId:Number(m[1]||m[2]),index:m[3].toUpperCase()},handle:loggedHandle(),samples:inputs.slice(0,20).map((p,i)=>({input:(p.innerText||p.textContent).slice(0,65536),output:(outputs[i]?.innerText||outputs[i]?.textContent||'').slice(0,65536)}))});}}
 let task,prepared=false,automatic=false;
 function nativeError(){return [...document.querySelectorAll('.error,.error-message,.error-text')].filter(n=>n.getClientRects?.().length).map(n=>n.textContent.trim()).filter(Boolean).join('；').slice(0,300);}
 async function failed(e){text.textContent=e.message;try{await request('bridgeFailed',{id:taskId,detail:e.message});}catch{}}
 async function prepare(){
  task=await request('bridgeTask',{id:taskId});if(task.autoAttempt||['submitted','judging','finished','cancelled','expired','interrupted'].includes(task.state)){const error=nativeError();if(error&&task.autoAttempt)await failed(Error(error));else text.textContent='本任务已发送或结束，不会重复提交。';return;}if(!task.source)throw Error('该任务的代码快照已释放，请在 VS Code 重新准备。');
  const handle=loggedHandle();if(!handle)throw Error('请先登录 CF，然后刷新提交页。');
  const filled=await fillNativeTask(task);await request('bridgePrepared',{id:taskId,handle});prepared=true;
  text.textContent=task.autoSubmit?'正在自动提交…':`VS Code：${task.sourceName} → ${task.problem.contestId}${task.problem.index}。代码已填入，请检查语言、题号和代码后，用 CF 原生 Submit 确认提交。${filled.languageMatched?'':'未匹配指定语言，请手动选择。'}`;
  if(!filled.form.dataset.cfeTask){filled.form.dataset.cfeTask=taskId;filled.form.addEventListener('submit',()=>{
   if(!prepared||stopped||automatic)return;document.dispatchEvent(new CustomEvent('cfe-editor-sync'));
   // Send before navigation; hashing is async, so capture synchronously first.
   void request('bridgeSubmitted',{id:taskId,source:filled.field.value}).catch(e=>text.textContent=e.message);
  },{capture:true});}
  if(task.autoSubmit){automatic=true;try{await submitNativeTask(task,filled,()=>request('bridgeSubmitted',{id:taskId,source:filled.field.value}));text.textContent='已自动发送，正在等待 CF 评测。';}catch(e){await failed(e);throw e;}}
 }
 if(taskId){panel.hidden=false;text.textContent='正在读取 VS Code 提交任务…';actions.append(button('检查 / 继续任务',async()=>{try{await prepare();}catch(e){await failed(e);}}));}
 async function checkResults(){
  if(!/\/contest\/\d+\/(?:my|status|submission\/\d+)/.test(location.pathname))return;
  const tasks=await request('bridgePageTasks');const rows=parseResultRows();
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
  if(stopped||running||document.hidden&&!taskId||!contextActive())return;running=true;
  try{const stored=await getLocal('bridgeConnection');if(!stored.bridgeConnection)return;
   if(taskId&&automatic){const error=nativeError();if(error){automatic=false;await failed(Error(error));}}
   await request('bridgeTick');await checkResults();
  }catch(e){if(taskId)text.textContent=e.message;}finally{running=false;}
 }
 async function visible(){if(!document.hidden){try{await publishContext();}catch{}void tick();}}
 document.addEventListener('visibilitychange',visible);
 if((await getLocal('bridgeConnection')).bridgeConnection){await publishContext();if(taskId){try{await prepare();}catch(e){await failed(e);}}}
 timer=setInterval(()=>{void tick();},4000);void tick();
}

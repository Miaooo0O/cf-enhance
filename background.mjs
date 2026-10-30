import {key, choose, problemUrl} from './core.mjs';
import {candidates, summarize, generateTraining} from './model.mjs';
// One queue across all tabs: API requests obey CF's two-second interval,
// storage mutations cannot overwrite another tab's draw or account settings.
let queue=Promise.resolve();
const recentCache=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,params={}){
  const {apiLast=0}=await chrome.storage.local.get('apiLast');
  await sleep(Math.max(0,2200-(Date.now()-apiLast)));
  await chrome.storage.local.set({apiLast:Date.now()});
  const response=await fetch(`https://codeforces.com/api/${method}?${new URLSearchParams(params)}`,{credentials:'omit',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(`CF 接口暂不可用（${response.status}），请稍后重试。`);
  const data=await response.json();if(data.status!=='OK')throw new Error(data.comment||'CF 接口响应异常');return data.result;
}
async function database(force=false){
  let {cache}=await chrome.storage.local.get('cache');
  if(force||!cache||Date.now()-cache.time>86400000){
    try{const data=await api('problemset.problems');if(!Array.isArray(data.problems))throw new Error('题库响应异常');
      cache={time:Date.now(),problems:data.problems.filter(p=>p.contestId&&Array.isArray(p.tags)).map(({contestId,index,name,rating,tags})=>({contestId,index,name,rating,tags}))};await chrome.storage.local.set({cache});
    }catch(e){if(!cache||force)throw e;return {...cache,stale:true};}
  }
  return cache;
}
async function sync(handle,force=false){
  handle=String(handle||'').trim();if(!/^[A-Za-z0-9_.-]{3,24}$/.test(handle))throw new Error('请输入有效的 CF handle。');
  const {account}=await chrome.storage.local.get('account');
  if(!force&&account?.handle.toLowerCase()===handle.toLowerCase()&&Date.now()-account.time<60000)return account;
  // Fetch every page; never mark a partial download as a complete solved set.
  const all=new Map();let from=1;
  let lastTail=null;
  for(;;){const page=await api('user.status',{handle,from,count:1000});if(!Array.isArray(page))throw new Error('提交记录响应异常');
    const tail=page.at(-1)?.id;if(page.length===1000&&tail===lastTail)throw new Error('提交分页未前进，请稍后重试。');lastTail=tail;
    for(const s of page)all.set(s.id,s);
    if(page.length<1000)break;
    from+=1000;
  }
  const next={handle,time:Date.now(),complete:true,states:summarize([...all.values()]),count:all.size};
  await chrome.storage.local.set({account:next});return next;
}
async function record(problems,extra={}){
  const s=await chrome.storage.local.get(['history','drawLog']);
  const history=[...new Set([...(s.history||[]),...problems.map(key)])];
  const old=s.drawLog||[...(s.history||[])].reverse().map(key=>({key,at:null}));
  const drawLog=[...problems.map(p=>({key:key(p),name:p.name,rating:p.rating,at:Date.now()})),...old];
  await chrome.storage.local.set({history,drawLog,...extra});
}
async function handleMessage(m){
  if(m.type==='database')return database(m.force);
  if(m.type==='sync')return sync(m.handle,m.force);
  if(m.type==='recent'){
    if(!/^[A-Za-z0-9_.-]{3,24}$/.test(String(m.handle||'')))throw new Error('请输入有效的 CF handle。');
    const recentKey=m.handle.toLowerCase(),cached=recentCache.get(recentKey);
    if(!m.force&&cached&&Date.now()-cached.time<25000)return cached.submissions;
    const submissions=await api('user.status',{handle:m.handle,from:1,count:100});
    if(!Array.isArray(submissions))throw new Error('提交记录响应异常');
    recentCache.set(recentKey,{time:Date.now(),submissions});
    const {account}=await chrome.storage.local.get('account');
    if(account?.handle.toLowerCase()===m.handle.toLowerCase()){
      for(const [id,s] of Object.entries(summarize(submissions))){const prev=account.states[id];account.states[id]={...s,attempts:Math.max(s.attempts,prev?.attempts||0),solved:s.solved||prev?.solved};}
      account.recentTime=Date.now();await chrome.storage.local.set({account});
    }
    return submissions;
  }
  if(m.type==='save'){
    const allowed=['settings','preferences','history','pendingSubmit'];
    if(!allowed.includes(m.field))throw new Error('不支持的设置');
    await chrome.storage.local.set({[m.field]:m.value});return true;
  }
  if(m.type==='draw'||m.type==='training'){
    const {problems}=await database();
    const s=await chrome.storage.local.get(['settings','history','account']);
    const settings=s.settings||{min:800,max:2000,tags:[],noRepeat:true,exclude:'ac'};
    if(settings.exclude!=='none'&&s.account&&Date.now()-s.account.time>86400000)throw new Error('做题记录已超过一天未全量同步，请先同步后再抽题。');
    if(m.type==='training'){
      const picked=generateTraining(problems,m.groups,settings,s.history||[],s.account);
      const training={id:Date.now(),name:String(m.name||'自组训练').slice(0,80),created:Date.now(),groups:m.groups,problems:picked};
      await record(picked,{training});return training;
    }
    const p=choose(candidates(problems,settings,s.history||[],s.account).filter(p=>key(p)!==m.omitKey));if(!p)throw new Error('没有符合条件的题目，请调整筛选条件或去重设置。');
    await record([p]);
    if(m.open)await chrome.tabs.create({url:problemUrl(p),active:false});return p;
  }
  throw new Error('未知操作');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  const job=queue.then(()=>handleMessage(m));queue=job.catch(()=>{});
  job.then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;
});

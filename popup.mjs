import { key, problemUrl } from './core.mjs';
import {request} from './client.mjs';
import {statusOf,candidates} from './model.mjs';
export async function mountPicker(root=document,options={}) {
const $ = id => root.querySelector('#'+id);
const names = {dp:'动态规划',graphs:'图论',math:'数学',greedy:'贪心','data structures':'数据结构','binary search':'二分',trees:'树',strings:'字符串','number theory':'数论',geometry:'计算几何',implementation:'模拟',combinatorics:'组合数学',constructive:'构造','constructive algorithms':'构造',dfs:'深搜','dfs and similar':'搜索',flows:'网络流',games:'博弈',sortings:'排序',bitmasks:'位运算','two pointers':'双指针','divide and conquer':'分治',dsu:'并查集','shortest paths':'最短路'};
let problems = [], selected = new Set(), history = [], drawLog=[], historyLimit=30, busy = false, cache = null, account=null;
const stateNames={ac:'已通过',tried:'尝试中',new:'未提交'};
function renderHistory(){
  const query=$('historySearch').value.trim().toLowerCase();
  const lookup=new Map(problems.map(p=>[key(p),p]));
  const entries=drawLog.map(entry=>({...lookup.get(entry.key),...entry})).filter(entry=>{
    const state=account?statusOf(account.states,entry.key):'unknown';
    return (entry.key+' '+(entry.name||'')).toLowerCase().includes(query)&&($('historyState').value==='all'||state===$('historyState').value)&&(!$('historyMin').value||entry.rating>=Number($('historyMin').value))&&(!$('historyMax').value||entry.rating<=Number($('historyMax').value))&&(!$('historyTag').value||(entry.tags||[]).some(t=>t.toLowerCase().includes($('historyTag').value.toLowerCase())))&&(!$('historyDate').value||(entry.at&&new Date(entry.at).toLocaleDateString('sv-SE')===$('historyDate').value));
  });
  $('historyCount').textContent=drawLog.length;$('historyList').replaceChildren();
  for(const entry of entries.slice(0,historyLimit)){
    if(!/^\d+\/[A-Za-z]\d*$/.test(entry.key))continue;
    const row=document.createElement('div');row.className='historyRow';
    const link=document.createElement('a');link.href=`https://codeforces.com/problemset/problem/${entry.key}`;link.target='_blank';link.rel='noopener';link.textContent=`${entry.key.replace('/','')} · ${entry.name||'查看题目'}${entry.rating?' · '+entry.rating:''}`;
    const time=document.createElement('small');time.textContent=(account?stateNames[statusOf(account.states,entry.key)]:'状态未知（未同步）')+' · '+(entry.at?new Date(entry.at).toLocaleString('zh-CN'):'旧版记录（无时间）');row.append(link,time);$('historyList').append(row);
  }
  if(!entries.length)$('historyList').textContent='暂无匹配的跳题记录';
  $('moreHistory').hidden=entries.length<=historyLimit;
}
$('historySearch').oninput=()=>{historyLimit=30;renderHistory();};
$('moreHistory').onclick=()=>{historyLimit+=30;renderHistory();};
function settings(){return {min:Number($('min').value),max:Number($('max').value),tags:[...selected],mode:$('mode').value,noRepeat:$('noRepeat').checked,exclude:$('exclude').value};}
async function save(){await request('save',{field:'settings',value:settings()});}
for(const id of ['historyState','historyMin','historyMax','historyTag','historyDate'])$(id).oninput=()=>{historyLimit=30;renderHistory();};
$('exclude').onchange=()=>{save().then(updateCount).catch(showError);};
$('sync').onclick=async()=>{
  $('sync').disabled=true;$('accountInfo').textContent='正在分页同步全部提交，请稍候…';
  try{account=await request('sync',{handle:$('handle').value.trim(),force:true});accountInfo();renderHistory();updateCount();}catch(e){$('accountInfo').textContent=e.message;}finally{$('sync').disabled=false;}
};
function accountInfo(){$('accountInfo').textContent=account?`${account.handle} · ${Object.values(account.states).filter(s=>s.solved).length} 题 AC · ${new Date(account.time).toLocaleString('zh-CN')} 同步`:'未同步：请填写 handle，或选择不排除提交过的题';}
$('handle').oninput=()=>{accountInfo();if(account&&$('handle').value.trim().toLowerCase()!==account.handle.toLowerCase())$('accountInfo').textContent+=` · 当前仍使用 ${account.handle}，更换后请同步。`;};
function render(){
  const query=$('search').value.trim().toLowerCase();
  $('tags').replaceChildren();
  [...new Set(problems.flatMap(p=>p.tags))].sort().filter(t=>(t+' '+(names[t]||'')).toLowerCase().includes(query)).forEach(t=>{
    const button=document.createElement('button');button.type='button';button.className='tag';button.textContent=t;button.title=names[t]||t;button.setAttribute('aria-pressed',String(selected.has(t)));
    button.onclick=()=>{selected.has(t)?selected.delete(t):selected.add(t);render();save().catch(showError);};$('tags').append(button);
  });
  $('tagCount').textContent=selected.size?`已选 ${selected.size} 个`:'不限标签';updateCount();
}
function showError(e){$('status').textContent=e.message||String(e);}
function updateCount(){if(busy)return;try{$('status').textContent=`${candidates(problems,settings(),history,account).length.toLocaleString()} 道可抽取 · 仅包含有评分的题目`;}catch(e){showError(e);}}
function setBusy(value){busy=value;$('draw').disabled=value||!problems.length;$('refresh').disabled=value;}
async function load(force=false){
  setBusy(true);$('status').textContent='正在获取 Codeforces 题库…';
  try{
    cache=await request('database',{force});
    problems=cache.problems;setBusy(false);render();renderHistory();$('cacheInfo').textContent=`${problems.length.toLocaleString()} 题 · ${cache.stale?'离线旧缓存':'本地缓存'}`;
  }catch(e){
    if(cache){problems=cache.problems;setBusy(false);render();$('status').textContent='刷新失败，使用已有缓存。可稍后重试。';}
    else {setBusy(false);showError(new Error('无法加载题库，请检查网络后点击刷新题库。'+e.message));}
  }
}
$('filters').addEventListener('change',()=>{updateCount();save().catch(showError);});
$('search').oninput=render;
$('clearTags').onclick=()=>{selected.clear();render();save().catch(showError);};
root.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{[$('min').value,$('max').value]=b.dataset.range.split(',');updateCount();save().catch(showError);});
$('refresh').onclick=()=>load(true);
$('reset').onclick=async()=>{try{await request('save',{field:'history',value:[]});history=[];updateCount();}catch(e){showError(e);}};
$('filters').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  try{
    if(settings().exclude!=='none'&&account&&$('handle').value.trim().toLowerCase()!==account.handle.toLowerCase())throw new Error('handle 已更改，请先同步新账号的记录。');
    setBusy(true);await save();const problem=await request('draw',{open:true});
    const stored=await chrome.storage.local.get(['history','drawLog']);history=stored.history||[];drawLog=stored.drawLog||[];renderHistory();
    $('last').textContent=`${problem.contestId}${problem.index} · ${problem.name} · ${problem.rating}`;$('last').href=problemUrl(problem);$('last').hidden=false;
    $('status').textContent='已在新标签页打开。点击下方题目可前往。';
  }catch(e){showError(e);}finally{setBusy(false);}
};
async function init(){
  setBusy(true);
  try{const stored=await chrome.storage.local.get(['settings','cache','history','drawLog','account']);cache=stored.cache;history=stored.history||[];account=stored.account;$('handle').value=account?.handle||'';accountInfo();
    drawLog=stored.drawLog||[...history].reverse().map(key=>({key,at:null}));
    renderHistory();
    if(stored.settings){const s=stored.settings;$('min').value=s.min;$('max').value=s.max;$('mode').value=s.mode;selected=new Set(s.tags||[]);$('noRepeat').checked=s.noRepeat;$('exclude').value=s.exclude||'ac';}
    await load();
  }catch(e){setBusy(false);showError(e);}
}
const container=root.querySelector('main').parentElement;
if(options.view==='history'){
  container.classList.add('historyView');$('historyPanel').open=true;root.querySelector('h1').textContent='刷题记录';
}
if(options.embedded)container.classList.add('embedded');
const onStorage=(changes,area)=>{if(area!=='local'||!['account','drawLog','history'].some(k=>changes[k]))return;if(changes.account){account=changes.account.newValue;accountInfo();}if(changes.drawLog)drawLog=changes.drawLog.newValue||[];if(changes.history)history=changes.history.newValue||[];renderHistory();updateCount();};
chrome.storage.onChanged.addListener(onStorage);
await init();
return ()=>chrome.storage.onChanged.removeListener(onStorage);
}

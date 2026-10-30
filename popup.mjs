import { key, filterProblems, choose, problemUrl } from './core.mjs';
const $ = id => document.getElementById(id);
const names = {dp:'动态规划',graphs:'图论',math:'数学',greedy:'贪心','data structures':'数据结构','binary search':'二分',trees:'树',strings:'字符串','number theory':'数论',geometry:'计算几何',implementation:'模拟',combinatorics:'组合数学',constructive:'构造','constructive algorithms':'构造',dfs:'深搜','dfs and similar':'搜索',flows:'网络流',games:'博弈',sortings:'排序',bitmasks:'位运算','two pointers':'双指针','divide and conquer':'分治',dsu:'并查集','shortest paths':'最短路'};
let problems = [], selected = new Set(), history = [], drawLog=[], historyLimit=30, busy = false, cache = null;
function renderHistory(){
  const query=$('historySearch').value.trim().toLowerCase();
  const lookup=new Map(problems.map(p=>[key(p),p]));
  const entries=drawLog.map(entry=>({...lookup.get(entry.key),...entry})).filter(entry=>(entry.key+' '+(entry.name||'')).toLowerCase().includes(query));
  $('historyCount').textContent=drawLog.length;$('historyList').replaceChildren();
  for(const entry of entries.slice(0,historyLimit)){
    if(!/^\d+\/[A-Za-z]\d*$/.test(entry.key))continue;
    const row=document.createElement('div');row.className='historyRow';
    const link=document.createElement('a');link.href=`https://codeforces.com/problemset/problem/${entry.key}`;link.target='_blank';link.rel='noopener';link.textContent=`${entry.key.replace('/','')} · ${entry.name||'查看题目'}${entry.rating?' · '+entry.rating:''}`;
    const time=document.createElement('small');time.textContent=entry.at?new Date(entry.at).toLocaleString('zh-CN'):'旧版记录（无时间）';row.append(link,time);$('historyList').append(row);
  }
  if(!entries.length)$('historyList').textContent='暂无匹配的跳题记录';
  $('moreHistory').hidden=entries.length<=historyLimit;
}
$('historySearch').oninput=()=>{historyLimit=30;renderHistory();};
$('moreHistory').onclick=()=>{historyLimit+=30;renderHistory();};
function settings(){return {min:Number($('min').value),max:Number($('max').value),tags:[...selected],mode:$('mode').value,noRepeat:$('noRepeat').checked};}
async function save(){await chrome.storage.local.set({settings:settings()});}
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
function updateCount(){if(busy)return;try{$('status').textContent=`${filterProblems(problems,settings(),history).length.toLocaleString()} 道可抽取 · 仅包含有评分的题目`;}catch(e){showError(e);}}
function setBusy(value){busy=value;$('draw').disabled=value||!problems.length;$('refresh').disabled=value;}
async function load(force=false){
  setBusy(true);$('status').textContent='正在获取 Codeforces 题库…';
  try{
    if(force||!cache||Date.now()-cache.time>24*3600*1000){
      const response=await fetch('https://codeforces.com/api/problemset.problems',{signal:AbortSignal.timeout(30000),credentials:'omit'});
      if(!response.ok)throw new Error(`接口请求失败（HTTP ${response.status}）`);
      const data=await response.json();if(data.status!=='OK'||!Array.isArray(data.result?.problems))throw new Error(data.comment||'题库响应异常');
      cache={time:Date.now(),problems:data.result.problems.filter(p=>p.contestId&&Array.isArray(p.tags)).map(({contestId,index,name,rating,tags})=>({contestId,index,name,rating,tags}))};
      await chrome.storage.local.set({cache});
    }
    problems=cache.problems;setBusy(false);render();renderHistory();$('cacheInfo').textContent=`${problems.length.toLocaleString()} 题 · 本地缓存`;
  }catch(e){
    if(cache){problems=cache.problems;setBusy(false);render();$('status').textContent='刷新失败，使用已有缓存。可稍后重试。';}
    else {setBusy(false);showError(new Error('无法加载题库，请检查网络后点击刷新题库。'+e.message));}
  }
}
$('filters').addEventListener('change',()=>{updateCount();save().catch(showError);});
$('search').oninput=render;
$('clearTags').onclick=()=>{selected.clear();render();save().catch(showError);};
document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{[$('min').value,$('max').value]=b.dataset.range.split(',');updateCount();save().catch(showError);});
$('refresh').onclick=()=>load(true);
$('reset').onclick=async()=>{try{await chrome.storage.local.set({history:[]});history=[];updateCount();}catch(e){showError(e);}};
$('filters').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  try{
    const problem=choose(filterProblems(problems,settings(),history));
    if(!problem)throw new Error('没有符合条件的题目，请调整筛选条件，或重置抽题记录。');
    setBusy(true);await save();await chrome.tabs.create({url:problemUrl(problem),active:false});
    history=[...new Set([...history,key(problem)])];drawLog.unshift({key:key(problem),name:problem.name,rating:problem.rating,at:Date.now()});await chrome.storage.local.set({history,drawLog});renderHistory();
    $('last').textContent=`${problem.contestId}${problem.index} · ${problem.name} · ${problem.rating}`;$('last').href=problemUrl(problem);$('last').hidden=false;
    $('status').textContent='已在新标签页打开。点击下方题目可前往。';
  }catch(e){showError(e);}finally{setBusy(false);}
};
async function init(){
  setBusy(true);
  try{const stored=await chrome.storage.local.get(['settings','cache','history','drawLog']);cache=stored.cache;history=stored.history||[];
    drawLog=stored.drawLog||[...history].reverse().map(key=>({key,at:null}));
    if(!stored.drawLog)await chrome.storage.local.set({drawLog});
    renderHistory();
    if(stored.settings){const s=stored.settings;$('min').value=s.min;$('max').value=s.max;$('mode').value=s.mode;selected=new Set(s.tags);$('noRepeat').checked=s.noRepeat;}
    await load();
  }catch(e){setBusy(false);showError(e);}
}
init();

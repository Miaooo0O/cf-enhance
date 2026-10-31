import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseHTML,DOMParser} from 'linkedom';
import {mountPicker} from './popup.mjs';
import {mount,pageProblem} from './enhance.mjs';
import {generateTraining} from './model.mjs';
import {createTranslator} from './i18n.mjs';
import {readSessions,markViewed} from './sessions.mjs';
import {mountTrainingPage,mountSessionContext} from './training.mjs';
import {normalizeTag} from './tags.mjs';
import {request,getLocal,setLocal} from './client.mjs';
const popup=await fs.readFile(new URL('./popup.html',import.meta.url),'utf8');
const css=await fs.readFile(new URL('./popup.css',import.meta.url),'utf8');
const sample=[{contestId:10,index:'A',name:'Alpha',rating:1400,tags:['dp']},{contestId:10,index:'B',name:'Beta',rating:1600,tags:['math']}];
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
function environment(html,path,state={}){
  const {window,document}=parseHTML(html);const listeners=new Set(),requests=[],timers=[],cleared=new Set();
  const originals=new Map();function install(k,v){originals.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});}
  // Linkedom models option markup but does not implement the select.value setter.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value||'';},set(value){for(const o of this.options)o.toggleAttribute('selected',o.value===String(value));}});
  const set=async values=>{const changes=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{oldValue:state[k],newValue:v}]));Object.assign(state,structuredClone(values));for(const f of listeners)f(changes,'local');};
  const storage={get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in state).map(k=>[k,structuredClone(state[k])])),set};
  install('document',document);install('window',window);install('Event',window.Event);install('MutationObserver',window.MutationObserver);install('DOMParser',DOMParser);
  install('location',{pathname:new URL(path,'https://codeforces.com').pathname,href:'https://codeforces.com'+path,assign:url=>requests.push({type:'navigate',url})});
  install('matchMedia',()=>({matches:true}));install('setInterval',fn=>{timers.push(fn);return timers.length;});install('clearInterval',id=>cleared.add(id));
  install('fetch',async url=>({ok:true,text:async()=>url.endsWith('.css')?css:popup}));
  install('chrome',{storage:{local:storage,onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}},runtime:{id:'test-extension',getURL:file=>'chrome-extension://test/'+file,sendMessage:async m=>{
    requests.push(m);try{let data;
      if(m.type==='database')data={problems:sample,time:Date.now()};
      if(m.type==='save'){await set({[m.field]:m.value});data=true;}
      if(m.type==='draw')data=sample.find(p=>`${p.contestId}/${p.index}`!==m.omitKey);if(m.type==='recent')data=[];if(m.type==='contestProblems')data=sample;
      if(m.type==='sessions')data=readSessions(state);
      if(m.type==='viewed'){const trainings=markViewed(readSessions(state),m.id,m.key);await set({trainings});data=trainings.find(s=>s.id===m.id);}
      if(m.type==='training'){const problems=generateTraining(sample,m.groups,{...state.settings,...m.options},state.history||[],state.account,()=>.99);data={id:'new-session',name:m.name,created:Date.now(),groups:m.groups,problems,viewed:{}};await set({trainings:[data,...readSessions(state)]});}
      return {ok:true,data};
    }catch(e){return {ok:false,error:e.message};}
  }}});
  return {document,window,state,requests,set,timers,cleared,listeners,restore(){for(const [k,d]of originals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};
}
test('history upgrades old key-only records, filters statuses/tags/rating, and reset keeps the log',async()=>{
  const e=environment(popup,'/problemset',{history:['10/A','10/B'],account:{handle:'sample',time:Date.now(),complete:true,states:{'10/A':{solved:true}}}});
  try{const dispose=await mountPicker(e.document);const $=id=>e.document.getElementById(id);
    assert.equal($('historyList').children.length,2);assert($('historyList').textContent.includes('Alpha'));assert($('historyList').textContent.includes('已通过'));assert($('historyList').textContent.includes('无时间'));
    $('historyState').value='ac';$('historyState').oninput();assert.equal($('historyList').children.length,1);
    $('historyTag').value='math';$('historyTag').oninput();assert.equal($('historyList').textContent,'暂无匹配的跳题记录');
    $('historyState').value='all';$('historyTag').value='';$('historyMin').value='1500';$('historyMin').oninput();assert($('historyList').textContent.includes('Beta'));assert(!$('historyList').textContent.includes('Alpha'));
    await $('reset').onclick();assert.deepEqual(e.state.history,[]);assert($('historyList').textContent.includes('Beta'));dispose();
  }finally{e.restore();}
});
test('native enhancement preserves page nodes, mounts picker without iframe, and toggles original tags',async()=>{
  const e=environment('<html><body><div id="sidebar">original sidebar</div><div id="pageContent"><article id="original">Original statement</article><span class="tag-box">dp</span><span class="tag-box">*1400</span></div></body></html>','/problemset');
  try{const original=e.document.getElementById('original');await mount();const root=e.document.getElementById('cfe-root');const click=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text).click();
    click('隐藏标签');await flush();assert(e.document.documentElement.classList.contains('cfe-hide-tags'));assert(!e.document.documentElement.classList.contains('cfe-hide-rating'));assert(e.document.querySelector('.cfe-rating').textContent.includes('1400'));
    click('随机跳题');await flush();const host=[...root.querySelectorAll('.cfe-panel')].find(p=>!p.hidden).firstChild;
    assert(host.shadowRoot.querySelector('#draw'));assert.equal(root.querySelectorAll('iframe').length,0);assert.equal(e.document.getElementById('original'),original);
    click('刷题记录');await flush();const history=[...root.querySelectorAll('.cfe-panel')].find(p=>!p.hidden).firstChild.shadowRoot;assert(history.querySelector('#historyPanel').open);
    e.window.dispatchEvent(new e.window.Event('pagehide'));
  }finally{e.restore();}
});
test('independent library creates a new mixed session without replacing previous sessions',async()=>{
  const old={id:'old',name:'旧场次',created:1,problems:[sample[0]],viewed:{}};
  const e=environment('<html><body><div id="pageContent"></div></body></html>','/problemset?cfe=training',{settings:{min:800,max:2000,exclude:'none'},trainings:[old]});
  try{await mount();const root=e.document.getElementById('cfe-training-page');assert(root);assert(!e.document.querySelector('#cfe-root .cfe-groups'));
    const rows=root.querySelectorAll('.cfe-group');for(const [i,row]of [...rows].entries()){row.querySelector('[aria-label="最低分"]').value=String(1400+i*200);row.querySelector('[aria-label="最高分"]').value=String(1400+i*200);row.querySelector('[aria-label="题数"]').value='1';}
    root.querySelector('input[placeholder="场次名称"]').value='<img src=x onerror=alert(1)>';
    root.querySelectorAll('[aria-label="本组标签"]')[0].value='动态规划';
    [...root.querySelectorAll('button')].find(b=>b.textContent==='创建场次并进入').click();await flush();assert.equal(e.state.trainings.length,2);assert.equal(e.state.trainings[0].problems.length,2);assert.equal(e.state.trainings[1].id,'old');assert(e.requests.some(r=>r.type==='navigate'&&r.url.endsWith('session=new-session')));assert.equal(root.querySelectorAll('img').length,0);
    e.window.dispatchEvent(new e.window.Event('pagehide'));
  }finally{e.restore();}
});
test('accepted problem shows an AC card and next action omits the current problem',async()=>{
  const e=environment('<html><body><div id="pageContent"></div></body></html>','/contest/10/problem/A',{account:{handle:'sample',complete:true,states:{'10/A':{solved:true}}}});
  try{assert.deepEqual(pageProblem(),{contestId:10,index:'A'});await mount();const card=e.document.getElementById('cfe-ac');assert.equal(card.hidden,false);assert(card.textContent.includes('Accepted'));[...card.querySelectorAll('button')].find(b=>b.textContent==='随机跳一题').click();await flush();assert.equal(e.requests.find(r=>r.type==='draw').omitKey,'10/A');e.window.dispatchEvent(new e.window.Event('pagehide'));}finally{e.restore();}
});

test('ordinary entry offers ordered contest navigation and a separate random action',async()=>{
 const e=environment('<html><body><div id="pageContent"></div></body></html>','/contest/10/problem/A',{account:{handle:'sample',complete:true,states:{'10/A':{solved:true}}}});
 try{await mount();const card=e.document.getElementById('cfe-ac');assert.equal(card.querySelectorAll('button').length,2);assert.equal(card.querySelector('button').textContent,'比赛下一题 →');card.querySelector('button').click();await flush();assert(e.requests.some(r=>r.type==='navigate'&&r.url==='https://codeforces.com/contest/10/problem/B'));assert(!e.requests.some(r=>r.type==='draw'));e.window.dispatchEvent(new e.window.Event('pagehide'));}finally{e.restore();}
});

test('training completion follows its own mixed order, skips AC, and preserves the session URL',async()=>{
 const session={id:'s',name:'Mixed',problems:[sample[0],{contestId:99,index:'D',name:'Done'},sample[1]],viewed:{}};
 const e=environment('<html><body><div id="pageContent"></div></body></html>','/problemset/problem/10/A?cfeSession=s',{trainings:[session],account:{handle:'sample',complete:true,states:{'10/A':{solved:true},'99/D':{solved:true}}}});
 try{await mount();const card=e.document.getElementById('cfe-ac');assert.equal(card.querySelector('button').textContent,'本场下一题 →');card.querySelector('button').click();await flush();assert(e.requests.some(r=>r.type==='navigate'&&r.url==='https://codeforces.com/problemset/problem/10/B?cfeSession=s'));assert(!e.requests.some(r=>r.type==='draw'));e.window.dispatchEvent(new e.window.Event('pagehide'));}finally{e.restore();}
});

test('random entry prefers random while a native result-page AC restores the ordered context',async()=>{
 const e=environment('<html><body><div id="pageContent"></div></body></html>','/problemset/problem/10/A?cfeMode=random',{account:{handle:'sample',complete:true,states:{'10/A':{solved:true}}}});
 try{await mount();const card=e.document.getElementById('cfe-ac');assert.equal(card.querySelector('button').textContent,'随机跳一题');card.querySelector('button').click();await flush();assert(e.requests.some(r=>r.type==='navigate'&&r.url==='https://codeforces.com/problemset/problem/10/B?cfeMode=random'));e.window.dispatchEvent(new e.window.Event('pagehide'));}finally{e.restore();}
 const r=environment('<html><body><div id="pageContent"></div></body></html>','/problemset/status?my=on');try{await mount();r.window.dispatchEvent(new r.window.CustomEvent('cfe-accepted',{detail:{key:'10/A',mode:'contest'}}));const card=r.document.getElementById('cfe-ac');assert.equal(card.hidden,false);assert.equal(card.querySelector('button').textContent,'比赛下一题 →');assert(card.textContent.includes('10A'));r.window.dispatchEvent(new r.window.Event('pagehide'));}finally{r.restore();}
});
test('training entry follows Help; Chinese interface is reversible without translating statements',async()=>{
  const e=environment('<html><body><div class="menu-box"><ul><li><a href="/">Home</a></li><li id="help"><a href="/help">Help</a></li></ul></div><div id="pageContent"><div class="problem-statement"><p>Submit</p><button>Run</button><pre>Input</pre></div><form action="/contest/10/submit"><label>Language:</label><input type="submit" value="Submit"><input name="action" type="submit" value="Submit"></form></div></body></html>','/problemset');
  try{await mount();const doc=e.document;assert.equal(doc.querySelector('#help').nextElementSibling.id,'cfe-training-nav');assert.equal(doc.querySelector('#cfe-training-nav a').textContent,'题单');
    doc.querySelector('#cfe-language-nav a').click();await flush();assert.equal(doc.querySelector('#help a').textContent,'帮助');assert.equal(doc.querySelector('.menu-box a').textContent,'首页');
    assert.equal(doc.querySelector('form label').textContent,'语言:');assert.equal(doc.querySelector('input[type=submit]:not([name])').getAttribute('value'),'提交');assert.equal(doc.querySelector('input[name=action]').getAttribute('value'),'Submit');assert.equal(doc.querySelector('.problem-statement').textContent,'SubmitRunInput');
    doc.querySelector('#cfe-language-nav a').click();await flush();assert.equal(doc.querySelector('#help a').textContent,'Help');assert.equal(doc.querySelector('form label').textContent,'Language:');assert.equal(doc.querySelector('.problem-statement').textContent,'SubmitRunInput');
    assert.equal(doc.querySelector('#cfe-training-nav a').getAttribute('href'),'https://codeforces.com/problemset?cfe=training');assert(!doc.querySelector('#cfe-root .cfe-groups'));
    e.window.dispatchEvent(new e.window.Event('pagehide'));
  }finally{e.restore();}
});
test('session detail allows choosing any problem, distinguishes viewed from AC, filters, and escapes titles',async()=>{
  const s={id:'one',name:'<img src=x>',created:1,problems:sample,viewed:{'10/A':{first:1,last:2}}};
  const e=environment('<html><body><div id="sidebar"></div><div id="pageContent"></div></body></html>','/problemset?cfe=training&session=one',{trainings:[s],account:{handle:'sample',states:{'10/B':{solved:true}}},preferences:{chinese:true}});
  try{await mount();const view=e.document.getElementById('cfe-training-page');assert.equal(view.querySelector('h1').textContent,'<img src=x>');assert.equal(view.querySelectorAll('img').length,0);const rows=view.querySelectorAll('tbody tr');assert.equal(rows.length,2);assert(rows[0].textContent.includes('已看'));assert(rows[1].textContent.includes('未看'));assert(rows[1].textContent.includes('已通过'));assert(rows[0].textContent.includes('动态规划'));
    assert(rows[1].querySelector('a').href.includes('/10/B?cfeSession=one'));
    const select=view.querySelector('[aria-label="筛选本场状态"]');select.value='unviewed';select.onchange();assert.equal(view.querySelectorAll('tbody tr').length,1);assert(view.querySelector('tbody').textContent.includes('Beta'));
    e.window.dispatchEvent(new e.window.Event('pagehide'));
  }finally{e.restore();}
});
test('opening a session problem marks only that session viewed and offers all original CF problem links',async()=>{
  const sessions=[{id:'one',name:'第一场',created:1,problems:sample,viewed:{}},{id:'two',name:'第二场',created:2,problems:sample,viewed:{}}];
  const e=environment('<html><body><div id="sidebar"></div><div id="pageContent"></div></body></html>','/problemset/problem/10/A?cfeSession=one',{trainings:sessions});
  try{await mount();await flush();const sidebar=e.document.getElementById('cfe-session-sidebar');assert(sidebar);assert.equal(sidebar.querySelectorAll('ol a').length,2);assert(e.state.trainings[0].viewed['10/A']);assert.deepEqual(e.state.trainings[1].viewed,{});assert(sidebar.querySelector('ol a').href.includes('cfeSession=one'));e.window.dispatchEvent(new e.window.Event('pagehide'));}finally{e.restore();}
});
test('Chinese picker labels keep the stored English tags used for filtering',async()=>{
 const e=environment(popup,'/problemset',{preferences:{chinese:true},settings:{min:800,max:2000,tags:[],exclude:'none',noRepeat:false}});
 try{const dispose=await mountPicker(e.document);const dp=[...e.document.querySelectorAll('.tag')].find(b=>b.textContent.includes('动态规划'));assert(dp);dp.click();await flush();assert.deepEqual(e.state.settings.tags,['dp']);assert(e.document.getElementById('status').textContent.includes('1 道'));dispose();}finally{e.restore();}
});
test('Chinese and bilingual tag inputs resolve to actual CF keys',()=>{
 assert.equal(normalizeTag('三分查找'),'ternary search');assert.equal(normalizeTag('动态规划'),'dp');assert.equal(normalizeTag('数学（math）'),'math');assert.equal(normalizeTag('DP'),'dp');assert.equal(normalizeTag('特殊题'),'*special');
});
test('translation handles newly inserted UI and does not overwrite subsequent site changes when disabled',()=>{
  const {document}=parseHTML('<html><body><div class="menu-box"><a href="/help">Help</a></div><div class="problem-statement">Help</div></body></html>');
  const translator=createTranslator(document);translator.setEnabled(true);const menu=document.querySelector('.menu-box');const b=document.createElement('button');b.textContent='Submit';menu.append(b);translator.scan(b);assert.equal(b.textContent,'提交');b.textContent='Changed by site';translator.setEnabled(false);assert.equal(b.textContent,'Changed by site');assert.equal(document.querySelector('a').textContent,'Help');assert.equal(document.querySelector('.problem-statement').textContent,'Help');
});
test('a synchronous storage exception after extension reload stops polling without an unhandled rejection',async()=>{
 const e=environment('<html><body><div id="pageContent"></div></body></html>','/problemset/problem/10/A',{account:{handle:'sample',complete:true,states:{}}});
 try{await mount();await flush();let gets=0;chrome.storage.local.get=()=>{gets++;throw new Error('Extension context invalidated.');};e.timers[0]();await flush();assert(e.document.getElementById('cfe-notice').textContent.includes('刷新'));assert(e.cleared.has(1));assert.equal(e.listeners.size,0);assert(e.document.querySelector('#cfe-root button').disabled);e.timers[0]();await flush();assert.equal(gets,1);}finally{e.restore();}
});
test('an asynchronously invalidated message channel is caught and stops subsequent checks',async()=>{
 const e=environment('<html><body><div id="pageContent"></div></body></html>','/problemset/problem/10/A',{account:{handle:'sample',complete:true,states:{}}});
 try{await mount();await flush();let sends=0;chrome.runtime.sendMessage=async()=>{sends++;throw new Error('Extension context invalidated.');};e.timers[0]();await flush();e.timers[0]();await flush();assert.equal(sends,1);assert(e.cleared.has(1));assert(e.document.getElementById('cfe-notice').textContent.includes('刷新'));}finally{e.restore();}
});
test('missing runtime identity makes all shared storage and messaging APIs reject with a refresh instruction',async()=>{
 const e=environment(popup,'/problemset');try{chrome.runtime.id=undefined;for(const action of [()=>request('recent'),()=>getLocal('account'),()=>setLocal({history:[]})])await assert.rejects(action(),e=>e.code==='CFE_CONTEXT_INVALIDATED'&&e.message.includes('刷新'));}finally{e.restore();}
});

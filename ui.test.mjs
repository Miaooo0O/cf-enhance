import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseHTML,DOMParser} from 'linkedom';
import {mountPicker} from './popup.mjs';
import {mount,pageProblem} from './enhance.mjs';
import {generateTraining} from './model.mjs';
import {createTranslator} from './i18n.mjs';
const popup=await fs.readFile(new URL('./popup.html',import.meta.url),'utf8');
const css=await fs.readFile(new URL('./popup.css',import.meta.url),'utf8');
const sample=[{contestId:10,index:'A',name:'Alpha',rating:1400,tags:['dp']},{contestId:10,index:'B',name:'Beta',rating:1600,tags:['math']}];
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
function environment(html,path,state={}){
  const {window,document}=parseHTML(html);const listeners=new Set(),requests=[];
  const originals=new Map();function install(k,v){originals.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});}
  // Linkedom models option markup but does not implement the select.value setter.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value||'';},set(value){for(const o of this.options)o.toggleAttribute('selected',o.value===String(value));}});
  const set=async values=>{const changes=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{oldValue:state[k],newValue:v}]));Object.assign(state,structuredClone(values));for(const f of listeners)f(changes,'local');};
  const storage={get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in state).map(k=>[k,structuredClone(state[k])])),set};
  install('document',document);install('window',window);install('Event',window.Event);install('MutationObserver',window.MutationObserver);install('DOMParser',DOMParser);
  install('location',{pathname:path,href:'https://codeforces.com'+path,assign:url=>requests.push({type:'navigate',url})});
  install('matchMedia',()=>({matches:true}));install('setInterval',()=>1);install('clearInterval',()=>{});
  install('fetch',async url=>({ok:true,text:async()=>url.endsWith('.css')?css:popup}));
  install('chrome',{storage:{local:storage,onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}},runtime:{getURL:file=>'chrome-extension://test/'+file,sendMessage:async m=>{
    requests.push(m);try{let data;
      if(m.type==='database')data={problems:sample,time:Date.now()};
      if(m.type==='save'){await set({[m.field]:m.value});data=true;}
      if(m.type==='recent')data=[];
      if(m.type==='training'){const problems=generateTraining(sample,m.groups,state.settings||{exclude:'none'},state.history||[],state.account,()=>.99);data={id:1,name:m.name,created:Date.now(),groups:m.groups,problems};await set({training:data});}
      return {ok:true,data};
    }catch(e){return {ok:false,error:e.message};}
  }}});
  return {document,window,state,requests,set,restore(){for(const [k,d]of originals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};
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
test('mixed training is generated in the original page and title text cannot create HTML',async()=>{
  const e=environment('<html><body><div id="pageContent"></div></body></html>','/problemset',{settings:{min:800,max:2000,exclude:'none'}});
  try{await mount();const root=e.document.getElementById('cfe-root');[...root.querySelectorAll('button')].find(b=>b.textContent==='自组训练').click();await flush();
    const rows=root.querySelectorAll('.cfe-group');for(const [i,row]of [...rows].entries()){row.querySelector('[aria-label="最低分"]').value=String(1400+i*200);row.querySelector('[aria-label="最高分"]').value=String(1400+i*200);row.querySelector('[aria-label="题数"]').value='1';}
    root.querySelector('input[placeholder="训练名称"]').value='<img src=x onerror=alert(1)>';
    [...root.querySelectorAll('button')].find(b=>b.textContent==='生成训练').click();await flush();assert.equal(e.state.training.problems.length,2);assert.equal(root.querySelectorAll('tbody tr').length,2);assert.equal(root.querySelectorAll('img').length,0);assert(root.textContent.includes('<img src=x'));
    e.window.dispatchEvent(new e.window.Event('pagehide'));
  }finally{e.restore();}
});
test('accepted problem shows an AC card and next action omits the current problem',async()=>{
  const e=environment('<html><body><div id="pageContent"></div></body></html>','/contest/10/problem/A',{account:{handle:'sample',complete:true,states:{'10/A':{solved:true}}}});
  try{assert.deepEqual(pageProblem(),{contestId:10,index:'A'});await mount();const card=e.document.getElementById('cfe-ac');assert.equal(card.hidden,false);assert(card.textContent.includes('Accepted'));card.querySelector('button').click();await flush();assert.equal(e.requests.find(r=>r.type==='draw').omitKey,'10/A');e.window.dispatchEvent(new e.window.Event('pagehide'));}finally{e.restore();}
});
test('training entry follows Help; Chinese interface is reversible without translating statements',async()=>{
  const e=environment('<html><body><div class="menu-box"><ul><li><a href="/">Home</a></li><li id="help"><a href="/help">Help</a></li></ul></div><div id="pageContent"><div class="problem-statement"><p>Submit</p><button>Run</button><pre>Input</pre></div><form action="/contest/10/submit"><label>Language:</label><input type="submit" value="Submit"><input name="action" type="submit" value="Submit"></form></div></body></html>','/problemset');
  try{await mount();const doc=e.document;assert.equal(doc.querySelector('#help').nextElementSibling.id,'cfe-training-nav');assert.equal(doc.querySelector('#cfe-training-nav a').textContent,'题单');
    doc.querySelector('#cfe-language-nav a').click();await flush();assert.equal(doc.querySelector('#help a').textContent,'帮助');assert.equal(doc.querySelector('.menu-box a').textContent,'首页');
    assert.equal(doc.querySelector('form label').textContent,'语言:');assert.equal(doc.querySelector('input[type=submit]:not([name])').getAttribute('value'),'提交');assert.equal(doc.querySelector('input[name=action]').getAttribute('value'),'Submit');assert.equal(doc.querySelector('.problem-statement').textContent,'SubmitRunInput');
    doc.querySelector('#cfe-language-nav a').click();await flush();assert.equal(doc.querySelector('#help a').textContent,'Help');assert.equal(doc.querySelector('form label').textContent,'Language:');assert.equal(doc.querySelector('.problem-statement').textContent,'SubmitRunInput');
    doc.querySelector('#cfe-training-nav a').click();await flush();assert.equal(doc.querySelector('#cfe-training-nav a').getAttribute('aria-expanded'),'true');
    e.window.dispatchEvent(new e.window.Event('pagehide'));
  }finally{e.restore();}
});
test('translation handles newly inserted UI and does not overwrite subsequent site changes when disabled',()=>{
  const {document}=parseHTML('<html><body><div class="menu-box"><a href="/help">Help</a></div><div class="problem-statement">Help</div></body></html>');
  const translator=createTranslator(document);translator.setEnabled(true);const menu=document.querySelector('.menu-box');const b=document.createElement('button');b.textContent='Submit';menu.append(b);translator.scan(b);assert.equal(b.textContent,'提交');b.textContent='Changed by site';translator.setEnabled(false);assert.equal(b.textContent,'Changed by site');assert.equal(document.querySelector('a').textContent,'Help');assert.equal(document.querySelector('.problem-statement').textContent,'Help');
});

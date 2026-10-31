window.mountJudge=({document,send,selection,getState,loadUI=()=>({}),saveUI=()=>{}})=>{
 const $=id=>document.getElementById(id),root=$('cases'),cards=new Map(),pending=new Map();let currentKey='',editTimer,focusFor='';
 const ui=loadUI(),folded=ui.folded||{};
 const labels={passed:'AC',wrongAnswer:'WA',runtimeError:'RE',timeout:'TLE',outputLimit:'OLE',cancelled:'停止',output:'✓'};
 const elem=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const pkey=p=>p?`${p.contestId}/${p.index}`:'';
 const suite=()=>{const choice=selection();if(choice.targetKey==='manual'&&choice.problem.trim()&&!choice.viewProblem)return null;const state=getState(),s=state.judge?.[selection().sourceMode==='file'?'file':'editor'];return 'selectedProblem' in state&&pkey(s?.problem)!==pkey(selection().viewProblem)?null:s;};
 function flush(){clearTimeout(editTimer);for(const m of pending.values())send('editCase',m);pending.clear();}
 const action=(name,extra={})=>{flush();const s=suite();if(s)send(name,{...selection(),suiteKey:s.key,...extra});};
 $('runAll').onclick=()=>action('runTests');$('stopTests').onclick=()=>send('stopTests');$('addCase').onclick=()=>{focusFor=currentKey;action('addCase');};$('undoCase').onclick=()=>action('restoreCase');$('syncSamples').onclick=()=>action('syncSamples');
 function saveFold(){saveUI({folded});}
 function setOpen(card,open){card.body.hidden=!open;card.toggle.textContent=open?'▾':'▸';card.toggle.append(card.heading);card.toggle.setAttribute('aria-expanded',String(open));folded[card.id]=!open;}
 $('foldCases').onclick=()=>{const collapse=[...cards.values()].some(c=>!c.body.hidden);for(const card of cards.values())setOpen(card,!collapse);saveFold();renderFold();};
 function renderFold(){const collapse=[...cards.values()].some(c=>!c.body.hidden),title=collapse?'折叠全部':'展开全部';$('foldCases').title=title;$('foldCases').setAttribute('aria-label',title);$('foldCases').textContent=collapse?'⊟':'⊞';}
 function build(c,index){
  const details=elem('article',undefined,'judgeCase'),summary=elem('div',undefined,'caseHeader'),toggle=elem('button',undefined,'caseToggle'),heading=elem('span'),resultLabel=elem('span',undefined,'caseVerdict');toggle.type='button';toggle.append(heading);summary.append(toggle,resultLabel);details.append(summary);
  const enabled=elem('input');enabled.type='checkbox';enabled.title='参与全部运行';enabled.setAttribute('aria-label',`启用用例 ${index+1}`);
  const run=elem('button','▶','iconButton'),remove=elem('button','×','iconButton');run.title='运行此用例';remove.title='删除此用例';run.setAttribute('aria-label',`运行用例 ${index+1}`);remove.setAttribute('aria-label',`删除用例 ${index+1}`);run.type=remove.type='button';summary.append(enabled,run,remove);
  const body=elem('div',undefined,'caseBody'),fields=elem('div',undefined,'caseFields'),input=elem('textarea'),expected=elem('textarea');
  for(const [field,label]of [[input,'输入'],[expected,'答案（可选）']]){field.rows=2;field.maxLength=65536;field.spellcheck=false;field.placeholder=label;field.setAttribute('aria-label',`用例 ${index+1} ${label}`);fields.append(field);}
  const output=elem('pre',undefined,'caseOutput');output.hidden=true;output.tabIndex=0;output.setAttribute('aria-label','程序输出');const copy=elem('button','⧉','iconButton');copy.type='button';copy.title='复制输出';copy.setAttribute('aria-label',`复制用例 ${index+1} 输出`);copy.hidden=true;copy.onclick=()=>action('copyOutput',{id:c.id});summary.append(copy);body.append(fields,output);details.append(body);
  const suiteKey=currentKey;
  const edit=patch=>{const key=suiteKey+'\0'+c.id,prior=pending.get(key);pending.set(key,{suiteKey,id:c.id,patch:{...prior?.patch,...patch}});clearTimeout(editTimer);editTimer=setTimeout(flush,180);};
  input.oninput=()=>edit({input:input.value});expected.oninput=()=>edit({expected:expected.value,compare:expected.value.length>0});input.onkeydown=expected.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();action('runTests',e.shiftKey?{}:{id:c.id});}};input.onblur=expected.onblur=flush;enabled.onchange=()=>{edit({enabled:enabled.checked});flush();};
  run.onclick=()=>action('runTests',{id:c.id});remove.onclick=()=>{pending.delete(suiteKey+'\0'+c.id);action('deleteCase',{id:c.id});};
  const card={id:c.id,details,body,toggle,heading,resultLabel,enabled,input,expected,run,remove,output,copy};cards.set(c.id,card);
  setOpen(card,!folded[c.id]);toggle.onclick=()=>{setOpen(card,card.body.hidden);saveFold();renderFold();};return card;
 }
 function render(){
  const state=getState(),s=suite(),running=!!state.judge?.running,available=!!s&&!!(selection().sourceMode==='file'?state.file:state.editor);
  $('runAll').disabled=!state.trusted||!available||state.busy||running||!s?.cases?.some(c=>c.enabled);$('runAll').textContent=running?'运行中…':'▶ 运行';$('stopTests').disabled=!running;$('stopTests').hidden=!running;
  $('addCase').disabled=!state.trusted||!available||state.busy||running;$('syncSamples').disabled=!state.trusted||!available||state.busy||running||!selection().viewProblem||!state.connected;
  const problem=selection().viewProblem;$('syncSamples').title=problem?`重新同步 ${problem.contestId}${problem.index} 样例`:'先选择题目';$('undoCase').hidden=!(s?.trashCount||s?.trash?.length);const loading=pkey(state.selectedProblem)===pkey(problem)?state.sampleStatus||{}:{};$('sampleState').textContent=loading.pending?'正在同步样例…':loading.error||'';$('sampleState').classList.toggle('failed',!!loading.error);
  $('judgeInfo').textContent=s?`${s.cases.length} 个用例`:'打开代码文件';
  $('judgeStale').hidden=!s?.stale;$('compileError').hidden=!s?.compileError;$('compileError').textContent=s?.compileError||'';
  if(!s){flush();root.replaceChildren();cards.clear();currentKey='';return;}
  if(currentKey!==s.key){flush();root.replaceChildren();cards.clear();currentKey=s.key;}
  const ids=new Set(s.cases.map(c=>c.id));for(const [id,card]of cards)if(!ids.has(id)){card.details.remove();cards.delete(id);}
  const results=new Map((s.results||[]).map(r=>[r.id,r]));s.cases.forEach((c,i)=>{
   const fresh=!cards.has(c.id),card=cards.get(c.id)||build(c,i);if(card.details.parentNode!==root)root.append(card.details);if(fresh&&focusFor===currentKey&&i===s.cases.length-1){setOpen(card,true);card.input.focus?.();focusFor='';}
   const title=`${c.origin==='web'?'样例':'用例'} ${i+1}`;if(card.heading.textContent!==title)card.heading.textContent=title;card.toggle.setAttribute('aria-label',title);card.enabled.checked=c.enabled;card.input.setAttribute('aria-label',`用例 ${i+1} 输入`);card.expected.setAttribute('aria-label',`用例 ${i+1} 答案（可选）`);card.enabled.setAttribute('aria-label',`启用用例 ${i+1}`);card.run.setAttribute('aria-label',`运行用例 ${i+1}`);card.remove.setAttribute('aria-label',`删除用例 ${i+1}`);
   const patch=pending.get(s.key+'\0'+c.id)?.patch;
   if(document.activeElement!==card.input&&card.input.value!==(patch?.input??c.input))card.input.value=patch?.input??c.input;
   if(document.activeElement!==card.expected&&card.expected.value!==(patch?.expected??c.expected))card.expected.value=patch?.expected??c.expected;
   card.input.disabled=card.expected.disabled=card.enabled.disabled=!state.trusted;card.run.disabled=card.remove.disabled=!state.trusted||state.busy||running;
   const r=results.get(c.id);card.resultLabel.textContent=r?`${labels[r.status]||r.status} · ${r.timeMs||0}ms`:s.running?'…':'';card.resultLabel.className='caseVerdict '+(r?.status==='passed'?'passed':r&&r.status!=='output'?'failed':'');
   card.copy.hidden=!r;card.copy.setAttribute('aria-label',`复制用例 ${i+1} 输出`);card.output.hidden=!r;if(r){const text=(r.stdout||'')+(r.stderr?(r.stdout?'\n':'')+r.stderr:'');if(card.output.textContent!==text)card.output.textContent=text;}
  });renderFold();
 }
 return {render,flush};
};

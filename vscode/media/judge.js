window.mountJudge=({document,send,selection,getState})=>{
 const $=id=>document.getElementById(id),root=$('cases'),cards=new Map();let currentKey='';
 const labels={passed:'通过',wrongAnswer:'输出不符',runtimeError:'运行错误',timeout:'超时',outputLimit:'输出过多',cancelled:'已停止',output:'已运行'};
 const elem=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const suite=()=>getState().judge?.[selection().sourceMode==='file'?'file':'editor'];
 const action=(name,extra={})=>{const s=suite();if(s)send(name,{...selection(),suiteKey:s.key,...extra});};
 $('runAll').onclick=()=>action('runTests');$('stopTests').onclick=()=>send('stopTests');$('addCase').onclick=()=>action('addCase');$('syncSamples').onclick=()=>action('syncSamples');
 function build(c,index){
  const details=elem('details',undefined,'judgeCase'),summary=elem('summary'),heading=elem('span'),resultLabel=elem('span',undefined,'caseVerdict');summary.append(heading,resultLabel);details.append(summary);details.open=index===0;
  const controls=elem('div',undefined,'row caseControls'),enabled=elem('input');enabled.type='checkbox';const enabledLabel=elem('label');enabledLabel.append(enabled,document.createTextNode('启用'));
  const run=elem('button','运行','textButton'),remove=elem('button','删除','textButton');run.type=remove.type='button';controls.append(enabledLabel,run,remove);
  const fields=elem('div',undefined,'caseFields'),inputLabel=elem('label','输入'),input=elem('textarea');input.rows=3;input.maxLength=65536;input.spellcheck=false;input.setAttribute('aria-label',`用例 ${index+1} 输入`);inputLabel.append(input);
  const compareLabel=elem('label',undefined,'compareLabel'),compare=elem('input');compare.type='checkbox';compareLabel.append(compare,document.createTextNode('校验期望输出'));
  const expected=elem('textarea');expected.rows=3;expected.maxLength=65536;expected.spellcheck=false;expected.setAttribute('aria-label',`用例 ${index+1} 期望输出`);fields.append(inputLabel,compareLabel,expected);
  const output=elem('pre',undefined,'caseOutput');output.hidden=true;details.append(controls,fields,output);
  const edit=patch=>action('editCase',{id:c.id,patch});input.oninput=()=>edit({input:input.value});expected.oninput=()=>edit({expected:expected.value});compare.onchange=()=>{expected.hidden=!compare.checked;edit({compare:compare.checked});};enabled.onchange=()=>edit({enabled:enabled.checked});run.onclick=()=>action('runTests',{id:c.id});remove.onclick=()=>action('deleteCase',{id:c.id});
  const card={details,heading,resultLabel,enabled,compare,input,expected,run,remove,output};cards.set(c.id,card);return card;
 }
 function render(){
  const state=getState(),s=suite(),running=!!state.judge?.running,available=!!s&&!!(selection().sourceMode==='file'?state.file:state.editor);
  $('runAll').disabled=!state.trusted||!available||state.busy||running||!s?.cases?.some(c=>c.enabled);$('runAll').textContent=running?'运行中…':'运行全部';$('stopTests').disabled=!running;
  $('addCase').disabled=!state.trusted||!available||state.busy||running;$('syncSamples').disabled=!state.trusted||!available||state.busy||running;
  $('syncSamples').textContent=state.currentProblem?`同步样例 · ${state.currentProblem.contestId}${state.currentProblem.index}`:'同步网页样例';
  $('judgeInfo').textContent=s?`${s.problem?s.problem.contestId+s.problem.index+' · ':''}${s.cases.length} 个用例${s.running?' · 正在测试':''}`:'打开代码文件即可本地测试，无需连接网页。';
  $('judgeStale').hidden=!s?.stale;$('compileError').hidden=!s?.compileError;$('compileError').textContent=s?.compileError||'';
  if(!s){root.replaceChildren();cards.clear();currentKey='';return;}
  if(currentKey!==s.key){root.replaceChildren();cards.clear();currentKey=s.key;}
  for(const [id,card]of cards)if(!s.cases.some(c=>c.id===id)){card.details.remove();cards.delete(id);}
  const results=new Map((s.results||[]).map(r=>[r.id,r]));s.cases.forEach((c,i)=>{
   const card=cards.get(c.id)||build(c,i);if(card.details.parentNode!==root)root.append(card.details);
   card.heading.textContent=`${c.origin==='web'?'样例':'用例'} ${i+1}`;card.enabled.checked=c.enabled;card.compare.checked=c.compare;card.expected.hidden=!c.compare;
   if(document.activeElement!==card.input&&card.input.value!==c.input)card.input.value=c.input;if(document.activeElement!==card.expected&&card.expected.value!==c.expected)card.expected.value=c.expected;
   card.input.disabled=card.expected.disabled=card.compare.disabled=card.enabled.disabled=!state.trusted;card.run.disabled=card.remove.disabled=!state.trusted||state.busy||running;
   const r=results.get(c.id);card.resultLabel.textContent=r?`${labels[r.status]||r.status} · ${r.timeMs||0} ms`:s.running?'等待':'未运行';card.resultLabel.className='caseVerdict '+(r?.status==='passed'?'passed':r&&r.status!=='output'?'failed':'');
   card.output.hidden=!r;if(r){const text=`实际输出\n${r.stdout||'（空）'}${c.compare?'\n期望输出\n'+(r.expected||'（空）'):''}${r.stderr?'\n错误输出\n'+r.stderr:''}`;if(card.output.textContent!==text)card.output.textContent=text;}
  });
 }
 return {render};
};

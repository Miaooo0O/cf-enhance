(() => {
 const vscode=acquireVsCodeApi(),$=id=>document.getElementById(id);let state={},lastEditor=null,busy=false,pickingFile=false,firstState=true,lastSelection='';
 const saved=vscode.getState()||{};let targetsJSON='',tasksJSON='',pinned=saved.pinned||null,followWeb=saved.followWeb??(!saved.target||saved.target.startsWith('current:')),languageTouched=!!saved.language;
 for(const id of ['source','problem','language'])if(saved[id])$(id).value=saved[id];
 const elem=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 function problemForSelection(){
  if($('target').value!=='manual'){const t=(state.targets||[]).find(t=>t.key===$('target').value)||pinned;if(t?.problem)return t.problem;const m=$('target').value.match(/(\d+)\/([A-Za-z]\d*)$/);return m?{contestId:Number(m[1]),index:m[2].toUpperCase()}:null;}
  const text=$('problem').value.trim(),m=text.match(/^(\d+)\s*[/ -]?\s*([A-Za-z]\d*)$/)||text.match(/^https:\/\/codeforces\.com\/(?:problemset\/problem\/(\d+)|contest\/(\d+)\/problem)\/([A-Za-z]\d*)\/?(?:[?#].*)?$/);if(!m)return null;return {contestId:Number(m[1]||m[2]),index:(m[3]||m[2]).toUpperCase()};
 }
 const pkey=p=>p?`${p.contestId}/${p.index}`:'';
 function save(){vscode.setState({...vscode.getState(),followWeb,pinned,source:$('source').value,target:$('target').value,problem:$('problem').value,language:$('language').value});}
 function send(action,extra={}){vscode.postMessage({action,...extra});}
 function selection(){return {sourceMode:$('source').value,targetKey:$('target').value,problem:$('problem').value,language:$('language').value,viewProblem:problemForSelection(),followWeb};}
 function syncSelection(){const s=selection(),key=JSON.stringify([s.targetKey,s.problem,followWeb]);if(key===lastSelection)return;lastSelection=key;send('selectTarget',s);}
 for(const id of ['pair','disconnect','browse','refresh','showOutput'])$(id).onclick=()=>send(id);
 $('browse').onclick=()=>{pickingFile=true;send('browse');};
 $('connection').onclick=()=>{const d=$('connectionDetails');d.hidden=!d.hidden;d.open=!d.hidden;};$('judgeSettings').onclick=()=>send('openSettings');
 const judge=window.mountJudge({document,send,selection,getState:()=>state,loadUI:()=>vscode.getState()?.judgeUI||{},saveUI:judgeUI=>vscode.setState({...vscode.getState(),judgeUI})});
 $('interactive').onclick=()=>{judge.flush();send('interactive',selection());};
 $('submit').onclick=()=>{judge.flush();save();send('submit',selection());};$('openProblem').onclick=()=>send('openProblem',selection());
 $('followWeb').onclick=()=>{judge.flush();followWeb=!followWeb;if(followWeb){pinned=null;const p=state.currentProblem;if(p)$('target').value=`current:${p.contestId}/${p.index}`;}save();syncSelection();render();};
 for(const id of ['source','target','problem','language'])$(id).addEventListener('input',()=>{
  judge.flush();if(id==='target'||id==='problem'){followWeb=false;const p=problemForSelection();pinned=$('target').value==='manual'?null:{key:$('target').value,label:(state.targets||[]).find(t=>t.key===$('target').value)?.label||`${p?.contestId||''}${p?.index||''}`,problem:p};}
  if(id==='language')languageTouched=true;save();autoLanguage();syncSelection();render();
 });
 function autoLanguage(){const source=$('source').value==='file'?state.file:state.editor;if(!languageTouched&&source?.languageId&&lastEditor!==source.uri){$('language').value=({cpp:'cpp23',c:'cpp23',python:'python3',java:'java21',rust:'rust'})[source.languageId]||'cpp23';lastEditor=source.uri;}}
 function updateControls(){
  $('manualLabel').hidden=$('target').value!=='manual';
  const source=$('source').value==='file'?state.file:state.editor,available=!!source&&($('source').value!=='selection'||source.selectionCharacters>0);
  $('sourceName').textContent=(source?.name||'未打开代码文件')+(source?.dirty?' •':'');$('sourceName').hidden=true;$('sourceInfo').textContent=source?.description||'';
  $('source').querySelector('option[value=editor]').textContent=state.editor?.name||'当前文件';$('source').querySelector('option[value=file]').textContent=state.file?.name?'文件 · '+state.file.name:'选定文件';$('source').title=source?.description||'';document.querySelector('.fileLine').hidden=!state.editor?.selectionCharacters;$('selectionInfo').textContent=state.editor?.selectionCharacters?`${state.editor.selectionCharacters} 字符已选中`:'';
  $('submit').disabled=busy||!state.trusted||!state.connected||!available||!problemForSelection();
  for(const id of ['pair','browse','disconnect','openProblem'])$(id).disabled=busy||!state.trusted;
  $('submit').textContent=busy?'发送中…':'↑ 提交';$('followWeb').setAttribute('aria-pressed',String(followWeb));$('followWeb').textContent=followWeb?'⇄':'⌖';$('followWeb').title=followWeb?'跟随网页题目；点击固定':'已固定题目；点击跟随网页';
 }
 function actionButton(title,action,id){const b=elem('button',title);b.type='button';b.className='textButton';b.onclick=()=>send(action,{id});return b;}
 function taskRow(task,current=false){const row=elem('article');row.className='task';const top=elem('div');top.className='taskTop';const result=elem('span',task.result);result.className='result'+(task.verdict==='OK'?' ac':'');top.append(elem('strong',`${task.problem.contestId}${task.problem.index}`),result);row.append(top);row.title=task.sourceName+' · '+task.detail;
  if(task.state==='error'||task.attention)row.append(elem('p',task.detail));if(task.submissionId)row.append(elem('p',`#${task.submissionId} · ${task.timeMs||0} ms · ${Math.round((task.memoryBytes||0)/1024)} KB`));
  const actions=elem('div');actions.className='taskActions';actions.append(actionButton('查看网页 ↗','viewTask',task.id));if(!task.terminal)actions.append(actionButton('停止跟踪','cancelTask',task.id));if(current&&['error','expired','interrupted'].includes(task.state)){const retry=elem('button','重试提交');retry.className='textButton';retry.onclick=()=>{judge.flush();send('submit',selection());};actions.append(retry);}row.append(actions);return row;
 }
 function renderTasks(){const key=pkey(problemForSelection()),tasks=state.tasks||[],json=JSON.stringify([key,tasks]);if(json===tasksJSON)return;tasksJSON=json;
  const root=$('tasks');root.replaceChildren();const current=key?tasks.find(t=>pkey(t.problem)===key):null;if(current)root.append(taskRow(current,true));
  const history=$('historyTasks');history.replaceChildren();$('taskHistory').hidden=!tasks.length;$('historyTitle').textContent=`提交历史 · ${tasks.length}`;if($('taskHistory').open)for(const t of tasks.slice(0,20))history.append(taskRow(t));
 }
 $('taskHistory').ontoggle=()=>{tasksJSON='';renderTasks();};
 function render(){updateControls();renderTasks();judge.render();}
 window.addEventListener('message',event=>{if(event.data?.type!=='state')return;state=event.data.state||{};busy=!!state.busy;
  $('connection').textContent=state.connected?'网页已连接':'本地模式';$('connection').className='badge'+(state.connected?' connected':'');$('connectionTitle').textContent='连接设置';$('connectionHint').textContent=state.paired?'保持 Chrome 的 CF 页面打开。':'复制配对码，到 Chrome 插件弹窗粘贴连接。';$('pair').textContent=state.paired?'重新配对':'复制配对码';$('portInfo').textContent=state.port?`本机端口 ${state.port}`:'连接初始化中';$('notice').textContent=state.notice||(!state.trusted?'请先信任当前工作区。':'');
  let prior=firstState&&saved.target?saved.target:$('target').value;const options=[...(state.targets||[])];if(!followWeb&&pinned?.problem&&!options.some(t=>t.key===pinned.key))options.push(pinned);
  const nextTargets=JSON.stringify(options);if(nextTargets!==targetsJSON){targetsJSON=nextTargets;$('target').replaceChildren();for(const t of options){const option=elem('option',t.label);option.value=t.key;$('target').append(option);}}
  if(options.some(t=>t.key===prior))$('target').value=prior;else $('target').value='manual';
  if(followWeb&&state.currentProblem){const key=`current:${pkey(state.currentProblem)}`;if(options.some(t=>t.key===key))$('target').value=key;}
  if(pickingFile&&!busy){pickingFile=false;if(state.file){$('source').value='file';save();}}
  firstState=false;autoLanguage();syncSelection();render();
 });
 send('ready');
})();

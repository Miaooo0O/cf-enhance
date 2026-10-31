(() => {
 const vscode=acquireVsCodeApi(),$=id=>document.getElementById(id);let state={},lastEditor=null,busy=false,pickingFile=false;
 const saved=vscode.getState()||{};let targetTouched=!!saved.target,languageTouched=!!saved.language;
 for(const id of ['source','problem','language'])if(saved[id])$(id).value=saved[id];
 function save(){vscode.setState({pane,source:$('source').value,target:$('target').value,problem:$('problem').value,language:$('language').value});}
 function send(action,extra={}){vscode.postMessage({action,...extra});}
 function selection(){return {sourceMode:$('source').value,targetKey:$('target').value,problem:$('problem').value,language:$('language').value};}
 for(const id of ['pair','disconnect','browse','refresh','showOutput'])$(id).onclick=()=>send(id);
 $('browse').onclick=()=>{pickingFile=true;send('browse');};
 let pane=saved.pane||'judge';function showPane(value){pane=value;$('judgePane').hidden=value!=='judge';$('submitPane').hidden=value!=='submit';$('judgeTab').setAttribute('aria-selected',String(value==='judge'));$('submitTab').setAttribute('aria-selected',String(value==='submit'));save();}$('judgeTab').onclick=()=>showPane('judge');$('submitTab').onclick=()=>showPane('submit');$('connection').onclick=()=>{$('connectionDetails').open=!$('connectionDetails').open;};$('judgeSettings').onclick=()=>send('openSettings');
 const judge=window.mountJudge({document,send,selection,getState:()=>state});
 $('submit').onclick=()=>{save();send('submit',selection());};$('openProblem').onclick=()=>send('openProblem',selection());
 for(const id of ['source','target','problem','language'])$(id).addEventListener('input',()=>{if(id==='target'||id==='problem')targetTouched=true;if(id==='language')languageTouched=true;save();autoLanguage();updateControls();judge.render();});
 function autoLanguage(){const source=$('source').value==='file'?state.file:state.editor;if(!languageTouched&&source?.languageId&&lastEditor!==source.uri){$('language').value=({cpp:'cpp23',c:'cpp23',python:'python3',java:'java21',rust:'rust'})[source.languageId]||'cpp23';lastEditor=source.uri;}}
 function updateControls(){
  $('manualLabel').hidden=$('target').value!=='manual';
  const source=$('source').value==='file'?state.file:state.editor,available=!!source&&($('source').value!=='selection'||source.selectionCharacters>0);
  $('sourceName').textContent=(source?.name||'未打开代码文件')+(source?.dirty?' •':'');$('sourceInfo').textContent=source?`${source.description||''} · ${$('source').value==='selection'?source.selectionCharacters:source.characters} 字符${source.dirty?' · 未保存':''}`:'打开代码文件，或点“选择其他文件”。';
  $('sourceName').title=source?.description||'';
  $('selectionInfo').textContent=state.editor?.selectionCharacters?`${state.editor.selectionCharacters} 字符已选中`:'';
  $('submit').disabled=busy||!state.connected||!available||($('target').value==='manual'&&!$('problem').value.trim());
  $('targetHint').textContent=state.currentProblem?`网页：${state.currentProblem.contestId}${state.currentProblem.index}`:'在 Chrome 打开题目后会自动识别';
  for(const id of ['pair','browse','disconnect','openProblem'])$(id).disabled=busy||!state.trusted;
  $('submit').textContent=busy?'发送中…':'提交';
 }
 const elem=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 function actionButton(title,action,id){const b=elem('button',title);b.type='button';b.className='textButton';b.onclick=()=>send(action,{id});return b;}
 function renderTasks(){const root=$('tasks');root.replaceChildren();if(!state.tasks?.length){root.append(elem('p','这里会显示本次提交的进度和结果。'));return;}
  for(const task of state.tasks.slice(0,3)){const row=elem('article');row.className='task';const top=elem('div');top.className='taskTop';const result=elem('span',task.result);result.className='result'+(task.verdict==='OK'?' ac':'');top.append(elem('strong',`${task.problem.contestId}${task.problem.index}`),result);row.append(top);row.title=task.sourceName+' · '+task.detail;if(task.state==='error'||task.attention)row.append(elem('p',task.detail));if(task.submissionId)row.append(elem('p',`#${task.submissionId} · ${task.timeMs||0} ms · ${Math.round((task.memoryBytes||0)/1024)} KB`));const actions=elem('div');actions.className='taskActions';actions.append(actionButton('查看网页 ↗','viewTask',task.id));if(!task.terminal)actions.append(actionButton('停止跟踪','cancelTask',task.id));row.append(actions);root.append(row);}
 }
 window.addEventListener('message',event=>{if(event.data?.type!=='state')return;state=event.data.state||{};busy=!!state.busy;
  $('connection').textContent=state.connected?'网页已连接':'本地模式';$('connection').className='badge'+(state.connected?' connected':'');$('connectionTitle').textContent='连接设置';$('connectionHint').textContent=state.paired?'保持 Chrome 的 CF 页面打开。':'复制配对码，到 Chrome 插件弹窗粘贴连接。';$('pair').textContent=state.paired?'重新配对':'复制配对码';$('portInfo').textContent=state.port?`系统分配的本机端口：${state.port}，仅本机可访问。`:'等待初始化本机连接';$('notice').textContent=state.notice||(!state.trusted?'请先信任当前工作区。':'');
  const prior=$('target').value||saved.target;$('target').replaceChildren();for(const t of state.targets||[]){const option=elem('option',t.label);option.value=t.key;$('target').append(option);}
  if((state.targets||[]).some(t=>t.key===prior))$('target').value=prior;else $('target').value='manual';
  if(!targetTouched&&state.currentProblem){const key=`current:${state.currentProblem.contestId}/${state.currentProblem.index}`;if((state.targets||[]).some(t=>t.key===key))$('target').value=key;}
  if(pickingFile&&!busy){pickingFile=false;if(state.file){$('source').value='file';save();}}
  autoLanguage();
  updateControls();renderTasks();judge.render();
 });
 showPane(pane);send('ready');
})();

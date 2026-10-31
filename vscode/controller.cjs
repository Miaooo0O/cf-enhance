const vscode=require('vscode');const path=require('node:path');const {randomUUID}=require('node:crypto');
const {JudgeStore}=require('./judge-store.cjs');const {runCases}=require('./judge-runner.cjs');
const {Bridge,parseProblem,terminal}=require('./bridge.cjs');const {startAvailable}=require('./ports.cjs');const {PanelProvider}=require('./panel.cjs');
const labels={queued:'等待浏览器',opened:'网页已打开',prepared:'正在提交',submitted:'等待 CF 返回编号',judging:'评测中',finished:'已完成',cancelled:'已取消',expired:'已过期',interrupted:'需要重新准备',error:'需要处理'};
const verdicts={OK:'AC',WRONG_ANSWER:'WA',TIME_LIMIT_EXCEEDED:'TLE',MEMORY_LIMIT_EXCEEDED:'MLE',RUNTIME_ERROR:'RE',COMPILATION_ERROR:'CE',TESTING:'评测中'};
const languages=[{label:'GNU G++23',id:'cpp23'},{label:'GNU G++20',id:'cpp20'},{label:'GNU G++17',id:'cpp17'},{label:'Python 3',id:'python3'},{label:'PyPy 3',id:'pypy3'},{label:'Java 21',id:'java21'},{label:'Rust',id:'rust'},{label:'在网页手动选择',id:'manual'}];
let deactivateCurrent=async()=>{};
async function activate(context){
 const output=vscode.window.createOutputChannel('CF Enhance'),changed=new vscode.EventEmitter();
 let bridge=null,starting=null,lastEditor=vscode.window.activeTextEditor,fileDocument=null,sampleResults=null,sampleProblem='',persisted=Promise.resolve(),closed=false,closing;
 const seen=new Map(),judgeStore=new JudgeStore(context.workspaceState||context.globalState),judgeResults=new Map();let judgeJob=null;
 function judgeSuite(document){if(!document||document.isClosed)return null;const key=document.uri?.toString()||document.fileName,suite=judgeStore.suite(key,path.basename(document.fileName)),run=judgeResults.get(key);return {...suite,results:(run?.results||[]).filter(r=>suite.cases.some(c=>c.id===r.id&&c.revision===r.revision)),compileError:run?.compileError,stale:run&&run.version!==(document.version||0),running:judgeJob?.key===key};}

 const status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,30);status.command='cfEnhance.show';status.text='$(beaker) CF Enhance';status.tooltip='离线本地测试与网页提交；点击打开面板';status.show();
 function editor(){return lastEditor&&!lastEditor.document.isClosed?lastEditor:vscode.window.activeTextEditor;}
 function description(document,selection){if(!document||document.isClosed)return null;return {name:document.isUntitled?'未保存的编辑器':path.basename(document.fileName),description:document.isUntitled?'未保存缓冲区':document.fileName,uri:document.uri?.toString()||document.fileName,languageId:document.languageId||'',characters:document.getText().length,selectionCharacters:selection&&!selection.isEmpty?document.getText(selection).length:0,dirty:!!document.isDirty};}
 function targets(){return [{key:'manual',label:'输入题号或链接'},...(bridge?.context.problem?[{key:`current:${bridge.context.problem.contestId}/${bridge.context.problem.index}`,label:`网页当前题 · ${bridge.context.problem.contestId}${bridge.context.problem.index}`,problem:bridge.context.problem,sessionId:bridge.context.sessionId,mode:bridge.context.mode}]:[]),...(bridge?.context.sessions||[]).flatMap(s=>(s.problems||[]).map(p=>({key:`session:${s.id}:${p.contestId}/${p.index}`,label:`${s.name} · ${p.contestId}${p.index} ${p.name||''}`,problem:{contestId:p.contestId,index:p.index},sessionId:s.id})))];}
 function getState(){const e=editor();return {judge:{editor:judgeSuite(e?.document),file:judgeSuite(fileDocument),running:!!judgeJob},trusted:!!vscode.workspace.isTrusted,paired:!!bridge?.credentials,connected:!!bridge?.credentials&&Date.now()-bridge.lastSeen<90000,port:bridge?.port||null,editor:description(e?.document,e?.selection),file:description(fileDocument),currentProblem:bridge?.context.problem||null,targets:targets().map(({key,label})=>({key,label})),autoSubmit:bridge?.context.autoSubmit===true,sampleCount:bridge?.context.samples?.length||0,sampleResults,sampleProblem,tasks:(bridge?.tasks||context.globalState.get('cfEnhance.tasks',[])).map(t=>({id:t.id,problem:t.problem,sourceName:t.sourceName,language:t.language,state:t.state,result:verdicts[t.verdict]||labels[t.state]||t.state,detail:t.detail,attention:t.attention,verdict:t.verdict,submissionId:t.submissionId,timeMs:t.timeMs,memoryBytes:t.memoryBytes,terminal:terminal.has(t.state)}))};}
 const panel=new PanelProvider(context.extensionUri,getState,act);
 function publish(){panel.publish();changed.fire();}
 const provider={onDidChangeTreeData:changed.event,getTreeItem:t=>{const item=new vscode.TreeItem(`${t.problem.contestId}${t.problem.index} · ${verdicts[t.verdict]||labels[t.state]||t.state}`);item.description=t.sourceName;item.tooltip=`${t.detail}\n${t.submissionId?'提交 #'+t.submissionId:''}\n${t.timeMs||0} ms`;item.command={command:'cfEnhance.tasks',title:'查看任务',arguments:[t.id]};item.iconPath=new vscode.ThemeIcon(t.verdict==='OK'?'pass':t.state==='finished'?'error':'clock');return item;},getChildren:()=>bridge?.tasks||[]};
 context.subscriptions.push(output,status,changed,vscode.window.registerTreeDataProvider('cfEnhance.tasks',provider),vscode.window.registerWebviewViewProvider('cfEnhance.control',panel,{webviewOptions:{retainContextWhenHidden:true}}));
 async function ensure(){
  if(!vscode.workspace.isTrusted)throw Error('请先信任工作区，再启用连接或提交。');if(starting)return starting;if(bridge?.port)return bridge;
  starting=(async()=>{
   let credentials=null;try{credentials=JSON.parse(await context.secrets.get('cfEnhance.connection')||'null');}catch{}
   const candidate=new Bridge({tasks:context.globalState.get('cfEnhance.tasks',[]),credentials,saveCredentials:c=>c?context.secrets.store('cfEnhance.connection',JSON.stringify(c)):context.secrets.delete('cfEnhance.connection'),onChange:tasks=>{
    persisted=persisted.then(()=>context.globalState.update('cfEnhance.tasks',tasks.slice(0,200))).catch(e=>output.appendLine('保存记录失败：'+e.message));
    for(const task of tasks){if(task.state==='finished'&&seen.get(task.id)!=='finished')vscode.window.showInformationMessage(`CF ${task.problem.contestId}${task.problem.index}：${verdicts[task.verdict]||task.verdict} · #${task.submissionId}`);seen.set(task.id,task.state);}publish();
   }});
   for(const t of candidate.tasks)seen.set(t.id,t.state);
   const configured=vscode.workspace.getConfiguration('cfEnhance').get('port',0),preferred=context.workspaceState?.get('cfEnhance.lastPort',0)||0;
   try{await startAvailable(candidate,{configured,preferred});}catch(e){await candidate.close();throw Error('本机连接启动失败：'+e.message);}
   if(closed){await candidate.close();throw Error('插件已关闭');}bridge=candidate;await context.workspaceState?.update('cfEnhance.lastPort',bridge.port);bridge.notify();return bridge;
  })();try{return await starting;}finally{starting=null;}
 }
 function connected(b){if(!b.credentials||Date.now()-b.lastSeen>90000)throw Error('请先点“复制配对码”连接 Chrome，并保持一个 CF 页面打开。');}
 async function chooseFile(){const files=await vscode.window.showOpenDialog({canSelectMany:false,openLabel:'选择代码文件'});if(!files)return null;fileDocument=await vscode.workspace.openTextDocument(files[0]);publish();return fileDocument;}
 async function code(mode){let document,source;const e=editor();if(mode==='file'){document=fileDocument;if(!document||document.isClosed)document=await chooseFile();if(!document)throw Error('尚未选择代码文件');source=document.getText();}else{if(!e)throw Error('请先打开代码文件，或点击“选择其他文件”。');document=e.document;if(mode==='selection'){if(e.selection.isEmpty)throw Error('当前没有选中的代码');source=document.getText(e.selection);}else if(mode==='editor')source=document.getText();else throw Error('代码来源无效');}
  return {source,uri:document.uri?.toString()||document.fileName,fileName:document.isUntitled?null:document.fileName,version:document.version||0,sourceName:document.isUntitled?'未保存的编辑器':path.basename(document.fileName),languageId:document.languageId};
 }
 function target(m){if(m.targetKey==='manual')return {problem:parseProblem(m.problem)};const chosen=targets().find(t=>t.key===m.targetKey&&t.problem);if(!chosen)throw Error('网页当前题或场次已变化，请重新选择目标题目。');return chosen;}
 function taskUrl(t){return t.submissionId?`https://codeforces.com/contest/${t.problem.contestId}/submission/${t.submissionId}`:t.state==='submitted'||t.state==='judging'?`https://codeforces.com/contest/${t.problem.contestId}/my`:`https://codeforces.com/problemset/problem/${t.problem.contestId}/${t.problem.index}`;}
 async function pair(){const b=await ensure();await vscode.env.clipboard.writeText(b.issuePairing());return '配对码已复制。到 Chrome 插件弹窗粘贴并连接，5 分钟内有效。';}
 async function samples(snapshot){const b=await ensure();if(!b.context.problem||!b.context.samples?.length)throw Error('请在 Chrome 打开目标题目页，等待网页样例同步。');
  const problem={...b.context.problem},inputs=structuredClone(b.context.samples);sampleResults=[];sampleProblem=`${problem.contestId}${problem.index}`;output.show(true);publish();
  const results=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`CF ${sampleProblem} 样例测试`},async()=>require('./samples.cjs').runSamples(snapshot.source,inputs,{compiler:vscode.workspace.getConfiguration('cfEnhance').get('compiler','g++'),onResult:r=>{output.appendLine(`样例 ${r.sample}：${r.passed?'通过':r.reason||'未通过'}\n实际输出：\n${r.stdout}\n期望输出：\n${r.expected}\n${r.stderr}`);sampleResults.push({sample:r.sample,passed:r.passed,reason:r.reason,stdout:r.stdout.slice(0,16000),expected:r.expected.slice(0,16000),stderr:r.stderr.slice(0,16000)});publish();}}));return `本地样例通过 ${results.filter(r=>r.passed).length}/${results.length}；这不是 CF 判题结果。`;
 }
 async function judgeAction(m){
  if(!vscode.workspace.isTrusted)throw Error('请先信任工作区，再运行或保存用例。');
  if(m.action==='stopTests'){judgeJob?.controller.abort();return '已请求停止测试。';}
  if(!judgeStore.suites[m.suiteKey])throw Error('代码文件已切换，请重试。');
  if(m.action==='addCase'){await judgeStore.add(m.suiteKey);return '';}
  if(m.action==='editCase'){await judgeStore.edit(m.suiteKey,m.id,m.patch||{});return '';}
  if(m.action==='deleteCase'){await judgeStore.remove(m.suiteKey,m.id);return '';}
  if(m.action==='syncSamples'){
   if(!bridge?.context.problem||!bridge.context.samples?.length)throw Error('先连接 Chrome 并打开 CF 题目，再同步样例。');
   if(m.targetKey&&((m.targetKey!=='manual')||String(m.problem||'').trim())){const selected=target(m).problem;if(selected.contestId!==bridge.context.problem.contestId||selected.index!==bridge.context.problem.index)throw Error('网页当前题与目标题目不同，请先打开目标题目。');}
   const added=await judgeStore.import(m.suiteKey,bridge.context.problem,bridge.context.samples);publish();return '已同步 '+added+' 个新样例，保留手写用例。';
  }
  if(judgeJob)throw Error('已有测试在运行，请先停止。');
  const snapshot=await code(m.sourceMode);if(snapshot.uri!==m.suiteKey)throw Error('代码文件已切换，请确认后重新运行。');
  const suite=judgeStore.suites[m.suiteKey],cases=structuredClone(suite.cases.filter(c=>m.id?c.id===m.id:c.enabled));
  if(!cases.length)throw Error('请先添加或启用用例。');
  const controller=new AbortController(),ticket={key:m.suiteKey,controller};judgeJob=ticket;
  const old=judgeResults.get(m.suiteKey),record={version:snapshot.version,results:m.id&&old?.version===snapshot.version?(old.results||[]).filter(r=>r.id!==m.id):[],compileError:null};judgeResults.set(m.suiteKey,record);publish();
  ticket.promise=(async()=>{
   const config=vscode.workspace.getConfiguration('cfEnhance');
   const result=await runCases(snapshot,cases,{compiler:config.get('compiler','g++'),cCompiler:config.get('cCompiler','gcc'),python:config.get('python','python'),timeout:config.get('testTimeout',3000),comparison:config.get('outputComparison','tokens'),signal:controller.signal,onResult:r=>{output.appendLine('本地用例 '+r.id+'：'+r.status+' · '+r.timeMs+' ms\n'+r.stdout+'\n'+r.stderr);record.results.push({...r,stdout:r.stdout.slice(0,16000),stderr:r.stderr.slice(0,16000)});publish();}});
   record.compileError=result.compileError?.slice(0,16000);if(result.compileError)output.appendLine(result.compileError);return result.cancelled?'测试已停止。':result.compileError?'编译失败，请查看诊断。':'本地测试完成。';
  })();try{return await ticket.promise;}finally{if(judgeJob===ticket)judgeJob=null;publish();}
 }
 async function act(m){
  if(['addCase','editCase','deleteCase','syncSamples','runTests','stopTests'].includes(m.action))return judgeAction(m);
  if(m.action==='pair')return pair();
  if(m.action==='openSettings'){await vscode.commands.executeCommand('workbench.action.openSettings','@ext:Miaooo0O.cf-enhance-companion');return '';}
  if(m.action==='showOutput'){output.show(true);return '';}
  const b=await ensure();
  if(m.action==='disconnect'){await b.revoke();publish();return '已撤销浏览器配对。';}
  if(m.action==='browse'){const d=await chooseFile();return d?'已选文件；提交时读取它的最新编辑内容。':'';}
  if(m.action==='submit'){
   connected(b);if(!b.context.autoSubmit||b.context.protocolVersion<2)throw Error('请将 Chrome 插件更新到 3.2.0，刷新 CF 页面并等待连接。');if(m.language==='manual')throw Error('请选择明确的提交语言。');const chosen=target(m),snapshot=await code(m.sourceMode);if(!languages.some(l=>l.id===m.language))throw Error('提交语言无效');
   const t=b.createTask({...snapshot,problem:chosen.problem,sessionId:chosen.sessionId,language:m.language,autoSubmit:true,mode:chosen.mode});output.appendLine(`准备任务 ${t.id}：${t.sourceName} → ${t.problem.contestId}${t.problem.index}`);publish();return `${t.sourceName} → ${t.problem.contestId}${t.problem.index} 已发送，浏览器将自动提交。`;
  }
  if(m.action==='samples')return samples(await code(m.sourceMode));
  if(m.action==='openProblem'){connected(b);b.commands.push({id:randomUUID(),type:'open',problem:target(m).problem});return '已请求 Chrome 打开题目。';}
  const t=b.tasks.find(t=>t.id===m.id);if(!t)throw Error('提交任务不存在');
  if(m.action==='viewTask'){await vscode.env.openExternal(vscode.Uri.parse(taskUrl(t)));return '';}
  if(m.action==='cancelTask'){b.cancel(t.id);publish();return '已停止跟踪，已发送给 CF 的提交不会撤回。';}
 }
 function command(id,fn){context.subscriptions.push(vscode.commands.registerCommand(id,async(...args)=>{try{await fn(...args);}catch(e){vscode.window.showErrorMessage('CF Enhance：'+e.message);}}));}
 command('cfEnhance.show',async()=>{await vscode.commands.executeCommand('workbench.view.extension.cfEnhance');await vscode.commands.executeCommand('cfEnhance.control.focus');panel.reveal();publish();});
 command('cfEnhance.pair',async()=>{const notice=await pair();panel.notice=notice;publish();vscode.window.showInformationMessage(notice);});
 command('cfEnhance.disconnect',async()=>{panel.notice=await act({action:'disconnect'});publish();});
 command('cfEnhance.submit',async()=>{
  const b=await ensure();connected(b);if(!b.context.autoSubmit||b.context.protocolVersion<2)throw Error('请更新 Chrome 插件至 3.2.0 并刷新 CF 页面。');const active=editor(),choices=[...(active?[{label:'当前编辑器全文',kind:'editor'},...(!active.selection.isEmpty?[{label:'当前选中的代码',kind:'selection'}]:[])]:[]),{label:'选择其他文件',kind:'file'}];
  const choice=await vscode.window.showQuickPick(choices,{placeHolder:'选择代码来源，不要求固定文件名'});if(!choice)return;if(choice.kind==='file'&&!await chooseFile())return;const snapshot=await code(choice.kind);
  const list=targets().map(t=>({...t,kind:t.key==='manual'?'manual':undefined}));const chosen=await vscode.window.showQuickPick(list,{placeHolder:'独立选择目标题目'});if(!chosen)return;let problem=chosen.problem;
  if(!problem){const input=await vscode.window.showInputBox({prompt:'目标题号或 CF 链接，例如 2246A',validateInput:s=>{try{parseProblem(s);}catch(e){return e.message;}}});if(!input)return;problem=parseProblem(input);}
  const language=await vscode.window.showQuickPick(languages,{placeHolder:'选择提交语言'});if(!language)return;if(language.id==='manual')throw Error('请选择明确的提交语言');const ok=await vscode.window.showInformationMessage(`${snapshot.sourceName} → ${problem.contestId}${problem.index} · ${language.label}。浏览器将直接提交。`,{modal:true},'准备提交');if(ok!=='准备提交')return;
  b.createTask({...snapshot,problem,language:language.id,sessionId:chosen.sessionId,autoSubmit:true});panel.notice='任务已准备。';publish();
 });
 command('cfEnhance.tasks',async id=>{const b=await ensure();let task=b.tasks.find(t=>t.id===id);if(!task){const picked=await vscode.window.showQuickPick(b.tasks.map(t=>({label:`${t.problem.contestId}${t.problem.index} · ${verdicts[t.verdict]||labels[t.state]}`,description:t.sourceName,detail:t.detail,task:t})),{placeHolder:'提交任务记录'});task=picked?.task;}if(!task)return;
  const action=await vscode.window.showInformationMessage(`${task.sourceName} → ${task.problem.contestId}${task.problem.index}：${task.detail}`,'查看网页','取消跟踪',...(task.source?['复制代码快照']:[]));if(action==='查看网页')await vscode.env.openExternal(vscode.Uri.parse(taskUrl(task)));if(action==='取消跟踪')b.cancel(task.id);if(action==='复制代码快照')await vscode.env.clipboard.writeText(task.source);});
 command('cfEnhance.cancel',async()=>{const b=await ensure(),t=await vscode.window.showQuickPick(b.tasks.filter(t=>!terminal.has(t.state)).map(task=>({label:`${task.problem.contestId}${task.problem.index} · ${task.sourceName}`,task})));if(t)b.cancel(t.task.id);});
 command('cfEnhance.openProblem',async()=>{const input=await vscode.window.showInputBox({prompt:'输入 CF 题号或链接'});if(input)await act({action:'openProblem',targetKey:'manual',problem:input});});
 command('cfEnhance.copyCode',async()=>vscode.commands.executeCommand('cfEnhance.tasks'));
 command('cfEnhance.runSamples',async()=>{const snapshot=await code('editor');const ok=await vscode.window.showInformationMessage('使用当前代码运行网页当前题的 C++ 样例？',{modal:true},'运行样例');if(ok==='运行样例'){panel.notice=await samples(snapshot);publish();}});
 for(const [event,fn]of [[vscode.window.onDidChangeActiveTextEditor,e=>{if(e?.document){lastEditor=e;}publish();}],[vscode.window.onDidChangeTextEditorSelection,()=>publish()],[vscode.workspace.onDidChangeTextDocument,()=>publish()],[vscode.workspace.onDidCloseTextDocument,()=>publish()]])if(event)context.subscriptions.push(event(fn));
 if(vscode.workspace.isTrusted){try{await ensure();}catch(e){panel.notice=e.message;output.appendLine(e.message);}}
 const ticker=setInterval(()=>{const s=getState();status.text=s.connected?'$(link) CF 已连接':'$(beaker) 本地测试';publish();},2000);
 async function dispose(){if(closing)return closing;closed=true;clearInterval(ticker);closing=(async()=>{if(starting)await starting.catch(()=>{});if(judgeJob){judgeJob.controller.abort();await judgeJob.promise?.catch(()=>{});}await judgeStore.flush();if(bridge)await bridge.close();bridge=null;await persisted;})();return closing;}
 deactivateCurrent=dispose;context.subscriptions.push({dispose:()=>{void dispose();}});
}
async function deactivate(){await deactivateCurrent();}
module.exports={activate,deactivate};

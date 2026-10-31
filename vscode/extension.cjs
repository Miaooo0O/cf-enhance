const vscode=require('vscode');
const path=require('node:path');
const {Bridge,parseProblem,terminal}=require('./bridge.cjs');
const labels={queued:'等待浏览器',opened:'网页已打开',prepared:'等待你确认提交',submitted:'已提交，核对提交编号',judging:'评测中',finished:'已完成',cancelled:'已取消',expired:'已过期',interrupted:'需要重新准备',error:'需要处理'};
const verdicts={OK:'AC',WRONG_ANSWER:'WA',TIME_LIMIT_EXCEEDED:'TLE',MEMORY_LIMIT_EXCEEDED:'MLE',RUNTIME_ERROR:'RE',COMPILATION_ERROR:'CE',TESTING:'评测中'};
let bridge;
async function activate(context){
 const output=vscode.window.createOutputChannel('CF Enhance');const changed=new vscode.EventEmitter();
 const status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,30);status.command='cfEnhance.tasks';status.text='$(link) CF Enhance';status.show();
 const seen=new Map();let persisted=Promise.resolve();
 const provider={onDidChangeTreeData:changed.event,getTreeItem:t=>{const item=new vscode.TreeItem(`${t.problem.contestId}${t.problem.index} · ${verdicts[t.verdict]||labels[t.state]||t.state}`);item.description=t.sourceName;item.tooltip=`${t.detail}\n${t.submissionId?'提交 #'+t.submissionId:''}\n${t.passedTests||0} tests · ${t.timeMs||0} ms`;item.command={command:'cfEnhance.tasks',title:'查看任务',arguments:[t.id]};item.iconPath=new vscode.ThemeIcon(t.verdict==='OK'?'pass':t.state==='finished'?'error':'clock');return item;},getChildren:()=>bridge?.tasks||[]};
 context.subscriptions.push(output,status,changed,vscode.window.registerTreeDataProvider('cfEnhance.tasks',provider));
 async function ensure(){
  if(!vscode.workspace.isTrusted)throw Error('请先信任当前工作区，再启用代码提交联动。');
  if(bridge)return bridge;
  let credentials=null;try{credentials=JSON.parse(await context.secrets.get('cfEnhance.connection')||'null');}catch{}
  bridge=new Bridge({tasks:context.globalState.get('cfEnhance.tasks',[]),credentials,saveCredentials:c=>c?context.secrets.store('cfEnhance.connection',JSON.stringify(c)):context.secrets.delete('cfEnhance.connection'),onChange:tasks=>{
   persisted=persisted.then(()=>context.globalState.update('cfEnhance.tasks',tasks.slice(0,200))).catch(e=>output.appendLine('保存记录失败：'+e.message));changed.fire();
   for(const task of tasks){if(task.state==='finished'&&seen.get(task.id)!=='finished'){vscode.window.showInformationMessage(`CF ${task.problem.contestId}${task.problem.index}：${verdicts[task.verdict]||task.verdict} · #${task.submissionId}`);}seen.set(task.id,task.state);}
  }});
  for(const t of bridge.tasks)seen.set(t.id,t.state);
  try{await bridge.start(vscode.workspace.getConfiguration('cfEnhance').get('port',27121));bridge.notify();}catch(e){bridge=null;throw Error('本机连接启动失败（端口可能被另一 VS Code 窗口占用）。请修改 cfEnhance.port 后重试。');}
  return bridge;
 }
 function command(id,fn){context.subscriptions.push(vscode.commands.registerCommand(id,async(...args)=>{try{await fn(...args);}catch(e){vscode.window.showErrorMessage('CF Enhance：'+e.message);}}));}
 command('cfEnhance.pair',async()=>{const b=await ensure();const code=b.issuePairing();await vscode.env.clipboard.writeText(code);await vscode.window.showInformationMessage('配对码已复制，5 分钟内打开 Chrome 扩展的“VS Code 联动”，粘贴并连接。每个 VS Code 窗口可设置不同端口。');});
 command('cfEnhance.disconnect',async()=>{const b=await ensure();await b.revoke();vscode.window.showInformationMessage('浏览器配对已撤销。');});
 command('cfEnhance.submit',async()=>{
  const b=await ensure();if(!b.credentials||Date.now()-b.lastSeen>90000){vscode.window.showWarningMessage('请先配对浏览器，并保持 Chrome 中有一个 CF 页面打开。');return;}
  const active=vscode.window.activeTextEditor;
  const choices=[...(active?[{label:'当前编辑器全文',kind:'editor'},...(!active.selection.isEmpty?[{label:'当前选中的代码',kind:'selection'}]:[])]:[]),{label:'选择其他文件',kind:'file'}];
  const choice=await vscode.window.showQuickPick(choices,{placeHolder:'选择代码来源，不要求固定文件名'});if(!choice)return;
  let document=active?.document,source;if(choice.kind==='file'){const files=await vscode.window.showOpenDialog({canSelectMany:false,openLabel:'选择代码文件'});if(!files)return;document=await vscode.workspace.openTextDocument(files[0]);source=document.getText();}else source=choice.kind==='selection'?document.getText(active.selection):document.getText();
  const targets=[{label:'输入题号或链接',kind:'manual'},...(b.context.problem?[{label:`网页当前题：${b.context.problem.contestId}${b.context.problem.index}`,problem:b.context.problem}]:[]),...(b.context.sessions||[]).flatMap(s=>(s.problems||[]).map(p=>({label:`${p.contestId}${p.index} · ${p.name||''}`,description:s.name,problem:{contestId:p.contestId,index:p.index},sessionId:s.id})))];
  const target=await vscode.window.showQuickPick(targets,{placeHolder:'独立选择目标题目'});if(!target)return;
  let problem=target.problem;if(!problem){const input=await vscode.window.showInputBox({prompt:'目标题号或 CF 链接，例如 2246A',validateInput:s=>{try{parseProblem(s);}catch(e){return e.message;}}});if(!input)return;problem=parseProblem(input);}
  const language=await vscode.window.showQuickPick([{label:'GNU G++23',id:'cpp23'},{label:'GNU G++20',id:'cpp20'},{label:'GNU G++17',id:'cpp17'},{label:'Python 3',id:'python3'},{label:'PyPy 3',id:'pypy3'},{label:'Java 21',id:'java21'},{label:'Rust',id:'rust'},{label:'在网页手动选择',id:'manual'}],{placeHolder:'选择提交语言'});if(!language)return;
  const sourceName=document.isUntitled?'未保存的编辑器':path.basename(document.fileName);
  const ok=await vscode.window.showInformationMessage(`${sourceName} → ${problem.contestId}${problem.index} · ${language.label}。使用当前代码快照，打开 CF 提交页后由你确认提交。`,{modal:true},'准备提交');if(ok!=='准备提交')return;
  const task=b.createTask({source,sourceName,problem,language:language.id,sessionId:target.sessionId});output.appendLine(`准备任务 ${task.id}：${sourceName} → ${problem.contestId}${problem.index}`);vscode.window.showInformationMessage('任务已建立，等待浏览器打开提交页。');
 });
 command('cfEnhance.tasks',async id=>{
  const b=await ensure();let task=b.tasks.find(t=>t.id===id);if(!task){const picked=await vscode.window.showQuickPick(b.tasks.map(t=>({label:`${t.problem.contestId}${t.problem.index} · ${verdicts[t.verdict]||labels[t.state]}`,description:t.sourceName,detail:t.detail,task:t})),{placeHolder:'提交任务记录'});task=picked?.task;}if(!task)return;
  const action=await vscode.window.showInformationMessage(`${task.sourceName} → ${task.problem.contestId}${task.problem.index}：${task.detail}${task.submissionId?' · #'+task.submissionId:''}`, '查看网页','取消跟踪',...(task.source?['复制代码快照']:[]));
  if(action==='查看网页')vscode.env.openExternal(vscode.Uri.parse(task.submissionId?`https://codeforces.com/contest/${task.problem.contestId}/submission/${task.submissionId}`:`https://codeforces.com/problemset/problem/${task.problem.contestId}/${task.problem.index}`));if(action==='取消跟踪')b.cancel(task.id);if(action==='复制代码快照')await vscode.env.clipboard.writeText(task.source);
 });
 command('cfEnhance.cancel',async()=>{const b=await ensure();const t=await vscode.window.showQuickPick(b.tasks.filter(t=>!terminal.has(t.state)).map(task=>({label:`${task.problem.contestId}${task.problem.index} · ${task.sourceName}`,task})));if(t)b.cancel(t.task.id);});
 command('cfEnhance.openProblem',async()=>{const b=await ensure();const input=await vscode.window.showInputBox({prompt:'输入要在 Chrome 打开的 CF 题号或链接'});if(input)b.commands.push({id:require('node:crypto').randomUUID(),type:'open',problem:parseProblem(input)});});
 command('cfEnhance.copyCode',async()=>vscode.commands.executeCommand('cfEnhance.tasks'));
 command('cfEnhance.runSamples',async()=>{
  const b=await ensure(),editor=vscode.window.activeTextEditor;if(!editor)throw Error('请先打开要运行的 C++ 编辑器。');if(!b.context.problem||!b.context.samples?.length)throw Error('请保持 Chrome 打开目标题目页，等待样例同步。');
  const source=editor.document.getText(),problem=b.context.problem;
  const ok=await vscode.window.showInformationMessage(`运行当前编辑器代码，使用网页 ${problem.contestId}${problem.index} 的样例。`,{modal:true},'运行样例');if(ok!=='运行样例')return;
  output.show(true);await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'CF Enhance 样例测试'},async()=>{const results=await require('./samples.cjs').runSamples(source,b.context.samples,{compiler:vscode.workspace.getConfiguration('cfEnhance').get('compiler','g++'),onResult:r=>output.appendLine(`样例 ${r.sample}：${r.passed?'通过':r.reason||'未通过'}\n实际输出：\n${r.stdout}\n期望输出：\n${r.expected}\n${r.stderr}`)});vscode.window.showInformationMessage(`样例通过 ${results.filter(r=>r.passed).length}/${results.length}`);});
 });
 if(vscode.workspace.isTrusted){try{await ensure();}catch(e){output.appendLine(e.message);}}
 const ticker=setInterval(()=>{status.text=bridge?.lastSeen&&Date.now()-bridge.lastSeen<90000?'$(link) CF 已连接':'$(debug-disconnect) CF 未连接';},5000);context.subscriptions.push({dispose(){clearInterval(ticker);bridge?.close();bridge=null;}});
}
async function deactivate(){if(bridge)await bridge.close();bridge=null;}
module.exports={activate,deactivate};
